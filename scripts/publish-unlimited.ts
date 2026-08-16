/**
 * Seed the unlimited-generation path: the useapi provider, the connected
 * PixVerse accounts, the models they serve, and who is entitled to them.
 *
 * The shape this seeds is deliberately not "a discount on Nano Banana". KIE
 * bills per image; a PixVerse Pro+ subscription reached through useapi.net
 * bills a flat monthly fee and then nothing per image, throttling into a
 * slower queue past a daily per-account threshold instead. So the two are
 * different billing models for the same picture, and the second one has no
 * per-generation price to discount.
 *
 * Which is why the serving rows carry no `capabilities.variant`: they are a
 * way to run Nano Banana, not a second Nano Banana to put in the shop.
 * PostgresCatalogRepository skips rows without one, so the customer still sees
 * exactly one Nano Banana Pro and never has to know which pipe served it.
 *
 * Idempotent by content, like the catalogue and the plan ladder.
 *
 * Run: pnpm unlimited:publish   (needs DATABASE_URL)
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to publish unlimited access");

/**
 * The gateway, not the service behind it.
 *
 * useapi.net is what we hold a token for, what we call, and what returns the
 * 429 — so it is the provider: the unit health and the circuit breaker are
 * measured against it. The PixVerse subscriptions are accounts *at* that
 * gateway, which is exactly what provider_credentials rows are.
 */
const PROVIDER = {
  code: "useapi",
  name: "useapi.net",
  baseUrl: "https://api.useapi.net/v2",
  // Their unit is a request, not a credit — nothing is metered per generation.
  creditUnitName: "request",
} as const;

/**
 * The connected PixVerse accounts.
 *
 * secret_ref is a pointer into the environment, never the token itself: the
 * table's own comment asks for this, and a leaked database dump must not be a
 * leaked PixVerse account.
 *
 * concurrency_limit is 2 on useapi.net's own guidance — past roughly two
 * simultaneous creates the upstream starts answering 429. Three accounts is
 * therefore about six concurrent generations for the whole customer base,
 * which is the number that makes the queue matter.
 *
 * daily_request_cap is the Relax Mode threshold, recorded rather than
 * enforced: past it the upstream slows instead of failing, and slow is what
 * the queue is for. The pool picker uses it to prefer an account with
 * headroom.
 */
const ACCOUNTS = [
  { label: "pixverse-1", secretRef: "USEAPI_PIXVERSE_ACCOUNT_1", concurrencyLimit: 2, dailyRequestCap: 300 },
  { label: "pixverse-2", secretRef: "USEAPI_PIXVERSE_ACCOUNT_2", concurrencyLimit: 2, dailyRequestCap: 300 },
  { label: "pixverse-3", secretRef: "USEAPI_PIXVERSE_ACCOUNT_3", concurrencyLimit: 2, dailyRequestCap: 300 },
] as const;

/**
 * What is free, to whom, and how often.
 *
 * `variantId` names the catalogue entry the customer picks — the KIE row that
 * has a real price. `externalModelId` is the string useapi expects for the
 * same model on the PixVerse image endpoint.
 *
 * NOTE: those external ids are taken from useapi's published model list and
 * have not been exercised against the live API — there is no token in this
 * environment to exercise them with. Phase G verifies them the way
 * scripts/spike-kie.ts verified KIE's, against the real endpoint rather than
 * the docs, and that is the phase that would find a rename.
 *
 * minTier 3 = Studio and Creator.
 *
 * Deliberately one tier above Nano Banana's own minTier of 2, which is what
 * keeps it a perk rather than a write-off. Setting the two equal would mean
 * nobody who can reach the model pays for it — tier 1 locked out, tier 2 and
 * up free — so the grant would not add a reason to upgrade, it would delete
 * the revenue line. At 3, Pro pays the normal price and the top two plans stop
 * paying, which is a reason to move up rather than a discount for everyone
 * already past the door.
 *
 * dailyCap 50 is per account per day, and it is what keeps the word
 * "unlimited" survivable rather than what walks it back: the upstream
 * allowance is a pool shared by every customer, so one scripted account
 * without a ceiling drains the day for everybody else.
 */
const GRANTS = [
  { variantId: "nano-banana-pro", externalModelId: "nano-banana-pro", featureCode: "image_generate", minTier: 3, dailyCap: 50 },
  { variantId: "nano-banana-2", externalModelId: "nano-banana-2", featureCode: "image_generate", minTier: 3, dailyCap: 50 },
] as const;

const sql = postgres(databaseUrl, { max: 1 });

try {
  const summary = await sql.begin(async (tx) => {
    let written = 0;

    const [provider] = await tx<{ id: string }[]>`
      insert into providers (code, name, base_url, credit_unit_name, is_active)
      values (${PROVIDER.code}, ${PROVIDER.name}, ${PROVIDER.baseUrl}, ${PROVIDER.creditUnitName}, true)
      on conflict (code) do update set
        name = excluded.name,
        base_url = excluded.base_url,
        credit_unit_name = excluded.credit_unit_name,
        is_active = true
      returning id
    `;
    // A suppressed upsert returns no row, so re-read rather than assuming.
    const providerId = provider?.id ?? (await tx<{ id: string }[]>`select id from providers where code = ${PROVIDER.code}`)[0]?.id;
    if (!providerId) throw new Error("provider upsert returned no row and no row exists");

    for (const account of ACCOUNTS) {
      const [changed] = await tx<{ id: string }[]>`
        insert into provider_credentials (provider_id, label, secret_ref, concurrency_limit, daily_request_cap, is_active)
        values (${providerId}, ${account.label}, ${account.secretRef}, ${account.concurrencyLimit}, ${account.dailyRequestCap}, true)
        on conflict (provider_id, label) do update set
          secret_ref = excluded.secret_ref,
          concurrency_limit = excluded.concurrency_limit,
          daily_request_cap = excluded.daily_request_cap,
          is_active = true
        where
          provider_credentials.secret_ref is distinct from excluded.secret_ref
          or provider_credentials.concurrency_limit is distinct from excluded.concurrency_limit
          or provider_credentials.daily_request_cap is distinct from excluded.daily_request_cap
          or provider_credentials.is_active is distinct from true
        returning id
      `;
      if (changed) written += 1;
    }

    const featureRows = await tx<{ id: string; code: string }[]>`select id, code from features`;
    const featureIdByCode = new Map(featureRows.map((row) => [row.code, row.id]));

    for (const grant of GRANTS) {
      const featureId = featureIdByCode.get(grant.featureCode);
      if (!featureId) throw new Error(`no feature row for "${grant.featureCode}" — run the migrations first`);

      // The catalogue row the customer actually picks. Identified by its
      // variant id inside capabilities rather than by external_model_id,
      // because the two providers may well name the same model differently
      // and the variant id is ours.
      const [catalogModel] = await tx<{ id: string; name: string; modality: string; family: string }[]>`
        select id, name, modality, family from provider_models
        where capabilities -> 'variant' ->> 'id' = ${grant.variantId} and capabilities ? 'variant'
        limit 1
      `;
      if (!catalogModel) {
        throw new Error(`no catalogue model for variant "${grant.variantId}" — run pnpm catalog:publish first`);
      }

      // The serving row. No `variant` in capabilities, on purpose — that is
      // the flag keeping it out of the shop. What it does carry is a pointer
      // back at what it serves, so this row is readable on its own.
      const capabilities = { serves: grant.variantId, billing: "subscription" as const };
      const [servingModel] = await tx<{ id: string }[]>`
        insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities, is_active)
        values (
          ${providerId}, ${grant.externalModelId}, ${`${catalogModel.name} (unlimited)`},
          ${catalogModel.modality}, ${catalogModel.family}, ${tx.json(capabilities)}, true
        )
        on conflict (provider_id, external_model_id) do update set
          name = excluded.name,
          modality = excluded.modality,
          family = excluded.family,
          capabilities = excluded.capabilities,
          is_active = true,
          deprecated_at = null
        returning id
      `;
      const servingModelId =
        servingModel?.id ??
        (
          await tx<{ id: string }[]>`
            select id from provider_models
            where provider_id = ${providerId} and external_model_id = ${grant.externalModelId}
          `
        )[0]?.id;
      if (!servingModelId) throw new Error(`serving model upsert returned no row for "${grant.externalModelId}"`);

      const [changed] = await tx<{ id: string }[]>`
        insert into unlimited_entitlements (catalog_model_id, serving_model_id, feature_id, min_tier, daily_cap, is_active)
        values (${catalogModel.id}, ${servingModelId}, ${featureId}, ${grant.minTier}, ${grant.dailyCap}, true)
        on conflict (catalog_model_id) do update set
          serving_model_id = excluded.serving_model_id,
          feature_id = excluded.feature_id,
          min_tier = excluded.min_tier,
          daily_cap = excluded.daily_cap,
          is_active = true
        where
          unlimited_entitlements.serving_model_id is distinct from excluded.serving_model_id
          or unlimited_entitlements.feature_id is distinct from excluded.feature_id
          or unlimited_entitlements.min_tier is distinct from excluded.min_tier
          or unlimited_entitlements.daily_cap is distinct from excluded.daily_cap
          or unlimited_entitlements.is_active is distinct from true
        returning id
      `;
      if (changed) written += 1;
    }

    // A grant pulled from the list stops being free. Deactivated rather than
    // deleted: quotes and jobs point at these rows, and "this job was free
    // because of that grant" has to stay answerable after the grant ends.
    const retired = await tx<{ id: string }[]>`
      update unlimited_entitlements set is_active = false
      where is_active and catalog_model_id not in (
        select id from provider_models
        where capabilities -> 'variant' ->> 'id' = any(${GRANTS.map((g) => g.variantId)}::text[])
      )
      returning id
    `;

    return { written, retired: retired.length, grants: GRANTS.length, accounts: ACCOUNTS.length };
  });

  if (summary.written === 0 && summary.retired === 0) {
    console.log(`unlimited access already current: ${summary.grants} grants, ${summary.accounts} accounts, nothing written`);
  } else {
    console.log(
      `published ${summary.grants} grants and ${summary.accounts} accounts ` + `(${summary.written} written, ${summary.retired} retired)`,
    );
  }
} finally {
  await sql.end();
}
