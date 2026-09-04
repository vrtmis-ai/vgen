import type { Sql } from "postgres";
import { COIN_USD } from "@vgen/core";
import { PostgresEntitlementsRepository, type Tier, type UnlimitedGrant } from "./entitlementsRepository";
import { PostgresPricingRepository, PriceUnavailableError } from "./pricingRepository";
import { hashGenerationParams, type GenerationParams } from "./generationRepository";

/**
 * What a generation costs this account, decided by the server.
 *
 * Three questions are answered here, in this order, because each only makes
 * sense once the one before it has an answer:
 *
 *   1. does this variant exist, and what feature does it serve
 *   2. does this account's plan reach it at all          <- the tier gate
 *   3. is it free for them today, and if not, what is the price
 *
 * Every one of those used to be answered in the browser. `src/lib/access.tsx`
 * draws a padlock and `src/data/pricing.ts` computes a number, and both were
 * advisory: curl has never seen a padlock, and a price the client computes is
 * a price the client can edit. This file is where they stop being advice.
 */

/** How long a quote is good for. Long enough to fill in a prompt, short
 *  enough that a price change reaches customers within the minute. */
const QUOTE_TTL_MS = 5 * 60 * 1000;

export interface QuoteRequest {
  userId: string;
  variantId: string;
  params: GenerationParams;
  prompt?: string | undefined;
  clipSeconds?: number | undefined;
  /**
   * "I would rather wait than spend." Absent means true — see the contract.
   *
   * Only ever narrows: a false here declines a grant the account already holds
   * and pays the ordinary price. It can never open one it does not hold.
   */
  preferUnlimited?: boolean | undefined;
  /**
   * Uploaded files per reference slot, as `slot key -> ordered asset ids`.
   *
   * Ids, never URLs and never bytes. The browser uploads through
   * `POST /assets` first and names what it stored; anything else would let a
   * request point the provider at a URL of its choosing.
   */
  referenceAssetIds?: Record<string, string[]> | undefined;
}

export interface QuotedGeneration {
  id: string;
  coins: number;
  expiresAt: number;
  /** Present only when the price is zero because of a grant. */
  unlimited?: { remainingToday: number | null; dailyCap: number | null };
  /** What the account has in flight against what its plan allows. */
  concurrency: { running: number; limit: number };
}

export type QuoteResult =
  | { outcome: "quoted"; quote: QuotedGeneration }
  | { outcome: "unknown_account" }
  | { outcome: "unknown_variant" }
  | { outcome: "tier_too_low"; requiredTier: Tier; currentTier: Tier }
  | { outcome: "not_offered" }
  | { outcome: "no_price" }
  /**
   * A reference id that is not this account's usable upload.
   *
   * One outcome for "does not exist", "belongs to somebody else" and "was
   * deleted", on purpose: telling them apart would turn this route into an
   * oracle for whether a given asset id exists, which is the whole reason a
   * uuid is not an authorisation.
   */
  | { outcome: "unknown_reference" };

interface CatalogRow {
  id: string;
  provider_unit_cost_usd: string | null;
  capabilities: {
    family?: { minTier?: number };
    variant?: { featureCode?: string; controls?: unknown };
  };
}

/**
 * Billable seconds, taken from the settings rather than from the client.
 *
 * `duration` is a control on the variant, so it arrives inside params and is
 * already bounded by the catalogue. `clipSeconds` describes an attached asset
 * and is the one quantity the server cannot yet check — see the contract.
 */
function billableSeconds(params: GenerationParams, clipSeconds: number | undefined): number | undefined {
  const duration = params.duration;
  if (typeof duration === "number") return duration;
  if (typeof duration === "string" && duration.trim() !== "" && Number.isFinite(Number(duration))) return Number(duration);
  return clipSeconds;
}

/**
 * Whether a grant reaches the settings actually being asked for.
 *
 * `covers` names the settings the subscription serves, as
 * `control key -> allowed values`. Only the keys it names are narrowed —
 * anything absent is unconstrained, so adding a control to a variant does not
 * silently withdraw a grant that was written before it existed.
 *
 * Compared as strings on purpose. Control values arrive as `unknown` from a
 * JSON body and the catalogue writes them as strings (`"1K"`, `"2K"`), but a
 * number that round-trips through a client could arrive as `1024` or `"1024"`
 * for the same setting. `String(value)` makes the two agree; a `===` against a
 * raw `unknown` would silently fail to match and quietly bill someone.
 *
 * A missing param does not match a constrained key. If the pipe covers
 * `resolution: ["1K","2K"]` and the request names no resolution, the model's
 * own default decides what runs — and we do not know here what that is, so the
 * safe answer is to price it. Missing configuration costs a sale, never the
 * margin, which is how the tier gate above already resolves the same tension.
 */
export function coversSettings(covers: Record<string, string[]> | null, params: GenerationParams): boolean {
  if (!covers) return true;
  return Object.entries(covers).every(([key, allowed]) => {
    const value = (params as Record<string, unknown>)[key];
    if (value === undefined || value === null) return false;
    return allowed.includes(String(value));
  });
}

/**
 * The reference ids this account may actually use, checked against the store.
 *
 * An asset id is a uuid in a URL-shaped hole, not a capability. Without this a
 * caller could name somebody else's private upload and have it drawn from — the
 * bytes never come back to them directly, but the picture made from them does,
 * which is the same leak wearing a hat.
 *
 * Four conditions, and each excludes a real row that exists:
 *
 *   - `account_id` is the caller's, which is the actual authorisation
 *   - `origin in ('upload','generated')` — the deliberate feature this comment
 *     used to hold the door open for. "To video" on a finished image hands that
 *     image to a video model, and the file is already here, already this
 *     account's, and already checked; making the browser download and re-upload
 *     it would store a second copy of the same bytes to arrive at the same row.
 *     `system` and `derived` stay out: nobody picked those, and a system asset
 *     has a null `account_id` so it could never have passed the line above
 *   - `deleted_at is null`, because deleting an upload has to mean something
 *   - the id parses as a uuid at all, which is checked by the contract before
 *     this ever runs
 *
 * Returns the count of distinct ids that passed, so the caller can compare it
 * against what was asked for rather than trusting a boolean.
 */
async function usableReferenceCount(sql: Sql, accountId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const [row] = await sql<{ n: string }[]>`
    select count(distinct id)::text as n from assets
    where id = any(${ids}::uuid[])
      and account_id = ${accountId}
      and origin in ('upload', 'generated')
      and deleted_at is null
  `;
  return Number(row?.n ?? 0);
}

/** Every id named across every slot, deduplicated. */
function referenceIdsOf(map: Record<string, string[]> | undefined): string[] {
  return [...new Set(Object.values(map ?? {}).flat())];
}

export class PostgresQuotesRepository {
  private readonly entitlements: PostgresEntitlementsRepository;
  private readonly pricing: PostgresPricingRepository;

  constructor(private readonly sql: Sql) {
    this.entitlements = new PostgresEntitlementsRepository(sql);
    this.pricing = new PostgresPricingRepository(sql);
  }

  async create(request: QuoteRequest): Promise<QuoteResult> {
    // The session carries a user; credits, subscriptions and quotes are all
    // scoped by account. Personal account for now — a team member quoting
    // against their team's balance is what account_members is for, and no
    // route creates a team yet.
    const [user] = await this.sql<{ personal_account_id: string | null }[]>`
      select personal_account_id from users where id = ${request.userId} limit 1
    `;
    const accountId = user?.personal_account_id;
    if (!accountId) return { outcome: "unknown_account" };

    // The catalogue row the customer picked. Matched on the variant id inside
    // capabilities — ours — rather than on external_model_id, which belongs to
    // whichever provider happens to serve it.
    const [model] = await this.sql<CatalogRow[]>`
      select model.id, model.capabilities, rate.provider_unit_cost_usd
      from provider_models model
      join providers provider on provider.id = model.provider_id
      -- What a unit of this provider's currency costs us, effective now. Read
      -- here rather than taken from a constant because the constant named KIE,
      -- and a second provider made every quote it priced quietly wrong.
      left join lateral (
        select pcr.provider_unit_cost_usd
        from provider_credit_rates pcr
        where pcr.provider_id = provider.id
          and pcr.valid_from <= now()
          and (pcr.valid_to is null or pcr.valid_to > now())
        order by pcr.valid_from desc
        limit 1
      ) rate on true
      where model.capabilities -> 'variant' ->> 'id' = ${request.variantId}
        and model.capabilities ? 'variant'
        and model.is_active and provider.is_active
      limit 1
    `;
    if (!model) return { outcome: "unknown_variant" };

    const featureCode = model.capabilities.variant?.featureCode;
    if (!featureCode) return { outcome: "unknown_variant" };

    const [feature] = await this.sql<{ id: string }[]>`
      select id from features where code = ${featureCode} and is_active limit 1
    `;
    if (!feature) return { outcome: "unknown_variant" };

    // ---- the tier gate -------------------------------------------------
    // An unknown minTier locks rather than unlocks. Missing configuration
    // should cost a sale, never the margin: the four families that were once
    // missing from the hand-kept tier map were all expensive ones.
    const requiredTier = (model.capabilities.family?.minTier ?? 3) as Tier;
    const currentTier = await this.entitlements.tierForAccount(accountId);
    if (currentTier < requiredTier) return { outcome: "tier_too_low", requiredTier, currentTier };

    // ---- the references -------------------------------------------------
    // Before anything is priced, because a quote that names a file the caller
    // may not use should not exist at all — not as a row, and not as a price
    // they could then spend on a job.
    const referenceIds = referenceIdsOf(request.referenceAssetIds);
    if (referenceIds.length > 0) {
      const usable = await usableReferenceCount(this.sql, accountId, referenceIds);
      if (usable !== referenceIds.length) return { outcome: "unknown_reference" };
    }

    // ---- free, or priced ------------------------------------------------
    // Four things have to hold before a generation is free, and the order is
    // cheapest-question-first: did the customer ask for it, is there a grant
    // this tier reaches, does the grant cover these settings, is there any of
    // today's allowance left.
    //
    // `preferUnlimited` defaults to true because the grant has always applied
    // automatically. Reading an absent field as false would start charging
    // every client that has not been taught to send it — and only the
    // customers on the plans that were sold the perk, which is the worst
    // possible set of people to start billing by accident.
    const wantsUnlimited = request.preferUnlimited ?? true;
    const available = wantsUnlimited ? await this.entitlements.availability(model.id, feature.id, accountId, currentTier) : null;
    const covered = available === null || coversSettings(available.grant.covers, request.params);
    const granted = available !== null && covered && (available.remaining === null || available.remaining > 0);

    let priceId: string | null = null;
    let coins = 0;
    let microCredits = 0;
    let providerUnits = 0;
    let grant: UnlimitedGrant | null = null;

    if (granted) {
      grant = available.grant;
    } else {
      try {
        const price = await this.pricing.priceFor({
          providerModelId: model.id,
          featureId: feature.id,
          params: request.params,
          seconds: billableSeconds(request.params, request.clipSeconds),
          characters: request.prompt?.length,
        });
        priceId = price.priceId;
        coins = price.coins;
        microCredits = price.microCredits;
        providerUnits = price.providerUnits;
      } catch (error) {
        if (error instanceof PriceUnavailableError) return { outcome: error.code === "not_offered" ? "not_offered" : "no_price" };
        throw error;
      }
    }

    // The rate a customer was shown, recorded on the quote so it stays
    // answerable after the rate moves. NOT NULL on the column, so a database
    // without one cannot quote at all — which is the loud failure it should be.
    const [fx] = await this.sql<{ rate: string }[]>`
      select rate from fx_rates
      where base_currency = 'USD' and quote_currency = 'IRR' and valid_to is null
      limit 1
    `;
    if (!fx) throw new Error("no live USD/IRR rate in fx_rates; run pnpm plans:publish");

    // What this generation costs us and what it earns, both in USD micros.
    //
    // A granted generation records a cost of zero, which is the honest number:
    // the PixVerse subscriptions are a fixed monthly bill that one more image
    // does not move. The cost is real, it simply is not attributable per job —
    // provider_statements is where that reconciles.
    const unitCostUsd = model.provider_unit_cost_usd === null ? 0 : Number(model.provider_unit_cost_usd);
    const costUsdMicros = Math.round(providerUnits * unitCostUsd * 1_000_000);
    const sellUsdMicros = Math.round(coins * COIN_USD * 1_000_000);

    const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
    const [quote] = await this.sql<{ id: string; expires_at: Date }[]>`
      insert into quotes (
        account_id, created_by, params_hash,
        provider_model_id, feature_id, price_id, entitlement_id,
        provider_cost_usd_micros, sell_price_micro_credits,
        exchange_rate_irr_per_usd, margin_usd_micros, expires_at,
        reference_asset_ids
      ) values (
        ${accountId}, ${request.userId}, ${Buffer.from(hashGenerationParams(request.params))},
        ${model.id}, ${feature.id}, ${priceId}, ${grant?.id ?? null},
        ${costUsdMicros}, ${microCredits},
        ${Math.round(Number(fx.rate))}, ${sellUsdMicros - costUsdMicros}, ${expiresAt},
        ${referenceIds.length === 0 ? null : this.sql.json(request.referenceAssetIds ?? {})}
      )
      returning id, expires_at
    `;
    if (!quote) throw new Error("quote insert returned no row");

    const concurrency = await this.entitlements.concurrencyFor(accountId);

    return {
      outcome: "quoted",
      quote: {
        id: quote.id,
        coins,
        expiresAt: quote.expires_at.getTime(),
        concurrency,
        ...(grant ? { unlimited: { remainingToday: available!.remaining, dailyCap: grant.dailyCap } } : {}),
      },
    };
  }
}
