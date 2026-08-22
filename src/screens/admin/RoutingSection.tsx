import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import type { AdminApi } from "../../features/admin/adminApi";
import {
  useClearRoutes,
  useModels,
  useProviders,
  useReplaceRoutes,
  useRouteTo,
  useRoutes,
  useServingModelCreate,
} from "../../features/admin/useAdmin";
import { Cell, Muted, Row, Table } from "./primitives";
import {
  ParamOverridesSchema,
  type AdminCatalogModel,
  type AdminProvider,
  type AdminRouteInput,
  type AdminServingModel,
} from "../../runtime/contracts/admin";

/**
 * Which provider actually runs each thing we sell.
 *
 * The one number on this screen that matters is **"running on"**. It is the
 * lowest-priority active route, or the catalogue row itself when there is none,
 * and the server computes it the same way `claim()` does — so what this column
 * says and what a submitted job does cannot disagree. Everything else here is
 * how you change it.
 *
 * There are two ways to change it, for two different situations. The dropdown
 * in the list is for "a provider is failing, move this now": one choice, and
 * the server works out the priority. The editor behind a model's name is for
 * deciding an order in advance — several destinations, ranked, most of them
 * switched off until they are needed.
 */
export function RoutingSection({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const models = useModels(api, true);
  // Cached — the providers section has usually fetched this already. Needed
  // here because a provider with no serving models yet appears in no other
  // list, and adding the first destination for one is the common case.
  const providers = useProviders(api, true);
  const [openId, setOpenId] = useState<string | null>(null);
  // Collapsed ids, not open ones, so the default with no state is "everything
  // showing" — the behaviour this screen had before it was grouped. A console
  // that opens folded hides the outage somebody came here to find.
  //
  // Above the `open` branch below on purpose: that branch unmounts the whole
  // list, so state held inside it would reset every time somebody opened a
  // model's route editor and came back.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Before the early returns: hooks cannot be conditional, and the list is
  // already ordered by family from the server, so this is a fold, not a sort.
  const groups = useMemo(() => groupByFamily(models.data?.models ?? []), [models.data]);

  if (models.isPending) return <Muted>در حال خواندن کاتالوگ…</Muted>;
  if (models.error) return <Muted>کاتالوگ خوانده نشد.</Muted>;

  const open = models.data.models.find((model) => model.id === openId) ?? null;

  // Which providers `createGenerationProvider` has no way to call. Routing to
  // one is a legitimate choice — it is how you stage a move before the adapter
  // lands — but it must be a choice made knowingly, not a dropdown entry that
  // looks exactly like a working one and refuses every job.
  const withoutAdapter = new Set((providers.data?.providers ?? []).filter((provider) => !provider.hasAdapter).map((p) => p.id));

  if (open) {
    return (
      <RouteEditor
        api={api}
        model={open}
        servingModels={models.data.servingModels}
        providers={providers.data?.providers ?? []}
        canWrite={canWrite}
        onClose={() => setOpenId(null)}
      />
    );
  }

  return (
    <div>
      <p className="mb-3 text-[12px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
        «اجرا روی» یعنی اگر همین حالا جابی ثبت شود، کجا می‌رود. سرور همان‌طور حسابش می‌کند که هنگام اجرا حساب می‌کند.
        <br />
        «انتقال به» فقط مقصدهایی را نشان می‌دهد که برای همین مدل تعریف شده‌اند — نه هر نقطه‌پایانی هم‌نوع. برای افزودن مقصد تازه، روی نام
        مدل بزن.
      </p>
      <Table head={["مدل", "اجرا روی", "مسیرها و اولویت‌ها", "انتقال به"]}>
        {groups.map((group) => {
          const modelRows = group.models.map((model) => (
            <ModelRow
              key={model.id}
              api={api}
              model={model}
              servingModels={models.data.servingModels}
              withoutAdapter={withoutAdapter}
              canWrite={canWrite}
              onOpen={() => setOpenId(model.id)}
            />
          ));

          // Every family gets a heading, including the six that sell a single
          // variant. Leaving a lone model unheaded looked tidier and was wrong:
          // rendered flat under the family above it, "MiniMax H3" read as a
          // seventh Kling and "Gemini Omni" as a third Flux. A heading over one
          // row is a fold with nothing to fold; a row under the wrong heading is
          // a person routing the wrong model during an incident.
          const shut = collapsed[group.id] ?? false;
          return (
            <Fragment key={group.id}>
              <FamilyHeader group={group} collapsed={shut} onToggle={() => setCollapsed((state) => ({ ...state, [group.id]: !shut }))} />
              {shut ? null : modelRows}
            </Fragment>
          );
        })}
      </Table>
    </div>
  );
}

interface FamilyGroup {
  id: string;
  models: AdminCatalogModel[];
  /** How many are not running on the provider that owns their catalogue row. */
  moved: number;
  /** How many have somewhere else declared they could go. */
  withAlternate: number;
}

/**
 * The flat model list, cut into families.
 *
 * A fold rather than a group-by, because `listCatalogModels` already ends
 * `order by model.family nulls last, model.name` — so a family's rows arrive
 * adjacent and in the order the shop presents them. Re-sorting here would be a
 * second opinion about catalogue order that could disagree with the first.
 *
 * Models with no family land in one group under their own key. That is a
 * seeding mistake rather than a category, and burying them inside a section
 * called "—" is how it stays unnoticed.
 */
function groupByFamily(models: AdminCatalogModel[]): FamilyGroup[] {
  const groups: FamilyGroup[] = [];
  for (const model of models) {
    const id = model.familyId ?? "بدون خانواده";
    let group = groups.at(-1);
    if (!group || group.id !== id) {
      group = { id, models: [], moved: 0, withAlternate: 0 };
      groups.push(group);
    }
    group.models.push(model);
    if (model.servingProviderCode !== model.homeProviderCode) group.moved += 1;
    if (model.routeTargets.length > 0) group.withAlternate += 1;
  }
  return groups;
}

/**
 * The line a family's variants sit under.
 *
 * It carries the two counts worth knowing before opening the section, and the
 * ordering of them is the point: **how many are running somewhere other than
 * home** comes first, because that is the fact somebody opens this screen
 * during an incident to find. How many merely *could* move is preparedness, and
 * only interesting once nothing is on fire.
 *
 * The family's own name is not available here. `AdminCatalogModel.familyId` is
 * the slug the database groups by, and the Persian display names live in
 * `src/data/models.ts` — a 44-variant catalogue with every control and price
 * attached, which the staff console does not import and should not start
 * importing for one string per section.
 */
function FamilyHeader({ group, collapsed, onToggle }: { group: FamilyGroup; collapsed: boolean; onToggle: () => void }) {
  return (
    <tr className="border-t" style={{ borderColor: "var(--vg-border-subtle)" }}>
      <td colSpan={4} className="pb-1 pt-4">
        <button
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-2 text-start"
          style={{ color: "var(--vg-text)" }}
        >
          <span
            aria-hidden="true"
            className="inline-block text-[10px] transition-transform"
            style={{ transform: collapsed ? "none" : "rotate(-90deg)" }}
          >
            ◀
          </span>
          <span className="text-[13px] font-bold" dir="ltr">
            {group.id}
          </span>
          <span className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
            {group.models.length} مدل
            {group.moved > 0 ? ` · ${group.moved} جابه‌جا شده` : ""}
            {group.withAlternate > 0 ? ` · ${group.withAlternate} با مقصد جایگزین` : ""}
          </span>
        </button>
      </td>
    </tr>
  );
}

function ModelRow({
  api,
  model,
  servingModels,
  withoutAdapter,
  canWrite,
  onOpen,
}: {
  api: AdminApi;
  model: AdminCatalogModel;
  servingModels: AdminServingModel[];
  withoutAdapter: Set<string>;
  canWrite: boolean;
  onOpen: () => void;
}) {
  const moved = model.servingProviderCode !== model.homeProviderCode;
  return (
    <Row>
      <Cell>
        <button onClick={onOpen} className="text-start underline-offset-2 hover:underline">
          {model.name}
        </button>
        <span className="ms-2 text-[11px]" style={{ color: "var(--vg-text-faint)" }} dir="ltr">
          {model.variantId}
        </span>
      </Cell>
      <Cell>
        <span style={{ color: moved ? "var(--vg-primary-soft)" : "var(--vg-text-muted)" }} dir="ltr">
          {model.servingProviderCode}
        </span>
        {moved ? <span className="ms-1 text-[11px]">↩</span> : null}
      </Cell>
      <Cell>
        <Paths model={model} />
      </Cell>
      <Cell>
        <MoveTo
          api={api}
          model={model}
          servingModels={servingModels}
          withoutAdapter={withoutAdapter}
          canWrite={canWrite}
          onDeclare={onOpen}
        />
      </Cell>
    </Row>
  );
}

/**
 * Every path this model runs on, and the rank of each.
 *
 * This replaced a cell that read `0 / 1`. A count answers "are there routes"
 * and nothing else — not which provider, not which endpoint, and not which one
 * wins, which are the three things anybody looking at this column wants.
 *
 * **Home is listed first and always**, because it is a real destination and it
 * is where the job goes when nothing outranks it. Leaving it out made the
 * common case — a model with no routes at all — render as an empty cell that
 * looked like missing data rather than the complete answer it was.
 *
 * The winner is marked rather than inferred. It is the first active route in a
 * list the server already ordered by priority, falling back to home, which is
 * how `claim()` resolves it — so the mark and the job agree by construction
 * instead of by two places doing the same arithmetic.
 */
function Paths({ model }: { model: AdminCatalogModel }) {
  const winner = model.routeTargets.find((target) => target.isActive && target.source === "route");

  return (
    <div className="flex flex-col gap-1">
      <PathLine
        provider={model.homeProviderCode}
        path={model.homeExternalModelId}
        rank="خانه"
        winning={winner === undefined}
        dim={winner !== undefined}
      />
      {model.routeTargets.map((target) => (
        <PathLine
          key={`${target.source}-${target.servingModelId}`}
          provider={target.providerCode}
          path={target.externalModelId}
          rank={
            target.source === "entitlement"
              ? // No priority, and none missing: an entitlement is not ranked
                // against routes, it is the free lane for a different audience.
                "رایگانِ اشتراک"
              : `اولویت ${target.priority} · ${target.isActive ? "فعال" : "خاموش"}`
          }
          winning={target === winner}
          dim={!target.isActive}
        />
      ))}
    </div>
  );
}

function PathLine({
  provider,
  path,
  rank,
  winning,
  dim,
}: {
  provider: string;
  path: string;
  rank: string;
  winning: boolean;
  dim: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5 leading-5">
      {/* A filled mark on the one that would serve a job submitted now, and an
          empty slot rather than nothing on the others, so the lines stay
          aligned and the mark is the only thing that varies. */}
      <span
        aria-hidden
        className="inline-block w-1.5 shrink-0 text-[9px]"
        style={{ color: winning ? "var(--vg-primary-soft)" : "transparent" }}
      >
        ●
      </span>
      <span
        dir="ltr"
        className="font-mono text-[11px]"
        style={{ color: dim ? "var(--vg-text-faint)" : "var(--vg-text)" }}
        title={`${provider} · ${path}`}
      >
        <span style={{ color: "var(--vg-text-faint)" }}>{provider}</span> {path}
      </span>
      <span className="shrink-0 text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
        {rank}
      </span>
    </div>
  );
}

/**
 * Move one variant somewhere else, in one choice.
 *
 * **Only destinations declared for this model are offered** — its own routes,
 * active or not, plus its unlimited-entitlement pairing. Not every endpoint of
 * the same modality, which is what this used to do and was the bug: it put
 * `wavespeed-ai/qwen-image/text-to-image` on Nano Banana Pro's menu. Both make
 * images, and that is the entire extent of what the two have in common. Picking
 * it would not have failed; it would have quietly sold a Qwen picture at Nano
 * Banana Pro's price, and the only way to find out is a customer noticing.
 *
 * Whether another provider hosts *this* model is a fact about that provider
 * that no column in the schema knows. Somebody has to assert it, and the place
 * to assert it is the route editor behind the model's name, where the
 * assertion arrives switched off and carries a note saying what it is based on.
 * This dropdown is for the outage, not the decision: it offers the alternatives
 * that were worked out in advance, which is the only kind you want at 3am.
 *
 * Selecting the blank option clears every route, which sends the variant back
 * to the provider that owns its catalogue row. That is a return, not a
 * deletion — nothing a customer can see changes either way.
 */
function MoveTo({
  api,
  model,
  servingModels,
  withoutAdapter,
  canWrite,
  onDeclare,
}: {
  api: AdminApi;
  model: AdminCatalogModel;
  servingModels: AdminServingModel[];
  withoutAdapter: Set<string>;
  canWrite: boolean;
  onDeclare: () => void;
}) {
  const routeTo = useRouteTo(api);
  const clear = useClearRoutes(api);
  const busy = routeTo.isPending || clear.isPending;

  const options = useMemo(() => {
    const declared = new Set(model.routeTargets.map((target) => target.servingModelId));
    return servingModels.filter((serving) => declared.has(serving.id));
  }, [servingModels, model.routeTargets]);

  // The select shows where it is going, not what was last picked: an active
  // route's target, or blank for "home".
  const current =
    model.activeRouteCount > 0 ? (options.find((serving) => serving.externalModelId === model.servingExternalModelId)?.id ?? "") : "";

  // Nowhere to go is a real answer, and a select holding only "home" would hide
  // it behind a control that looks operable. The link goes where the missing
  // thing is actually created.
  if (options.length === 0) {
    return (
      <button onClick={onDeclare} className="text-[11.5px] underline-offset-2 hover:underline" style={{ color: "var(--vg-text-faint)" }}>
        مقصدی تعریف نشده
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={current}
        disabled={!canWrite || busy}
        aria-label={`انتقال ${model.name}`}
        dir="ltr"
        onChange={(event) =>
          event.target.value === "" ? clear.mutate(model.id) : routeTo.mutate({ modelId: model.id, servingModelId: event.target.value })
        }
        className="h-8 max-w-[220px] rounded-lg px-2 text-[11.5px]"
        style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
      >
        <option value="">— خانه —</option>
        <ProviderOptions servingModels={options} withoutAdapter={withoutAdapter} />
      </select>
      {busy ? <span className="text-[11px]">…</span> : null}
      {routeTo.error || clear.error ? (
        <span role="alert" className="text-[11px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
          نشد
        </span>
      ) : null}
    </div>
  );
}

/**
 * Destinations grouped under the provider that runs them.
 *
 * The grouping is the whole point. Flat, this list reads as a pile of model
 * slugs and an admin has to already know that `bytedance/seedance-2.0-fast` is
 * a WaveSpeed path — which is exactly what made the old picker unusable. The
 * group header carries the provider's real name; the options carry the id the
 * provider actually expects, because inside one provider that string is the
 * only thing that distinguishes two entries.
 */
function ProviderOptions({ servingModels, withoutAdapter }: { servingModels: AdminServingModel[]; withoutAdapter?: Set<string> }) {
  const grouped = useMemo(() => {
    const byProvider = new Map<string, AdminServingModel[]>();
    for (const serving of servingModels) {
      const bucket = byProvider.get(serving.providerId);
      if (bucket) bucket.push(serving);
      else byProvider.set(serving.providerId, [serving]);
    }
    return [...byProvider.values()].sort((a, b) => a[0]!.providerName.localeCompare(b[0]!.providerName));
  }, [servingModels]);

  return (
    <>
      {grouped.map((group) => (
        <optgroup
          key={group[0]!.providerId}
          // Said on the group, because having an adapter is a property of the
          // provider rather than of any one endpoint under it.
          label={withoutAdapter?.has(group[0]!.providerId) ? `${group[0]!.providerName} — بدون آداپتور` : group[0]!.providerName}
        >
          {group.map((serving) => (
            <option key={serving.id} value={serving.id}>
              {serving.externalModelId}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

interface DraftRoute extends AdminRouteInput {
  /** Local only, so a row keeps its identity while its serving model changes. */
  key: string;
  overridesText: string;
}

function RouteEditor({
  api,
  model,
  servingModels,
  providers,
  canWrite,
  onClose,
}: {
  api: AdminApi;
  model: AdminCatalogModel;
  servingModels: AdminServingModel[];
  providers: AdminProvider[];
  canWrite: boolean;
  onClose: () => void;
}) {
  const routes = useRoutes(api, model.id);
  const replace = useReplaceRoutes(api);
  const [draft, setDraft] = useState<DraftRoute[] | null>(null);

  useEffect(() => {
    if (!routes.data) return;
    setDraft(
      routes.data.routes.map((route) => ({
        key: route.id,
        servingModelId: route.servingModelId,
        priority: route.priority,
        isActive: route.isActive,
        paramOverrides: route.paramOverrides,
        overridesText: JSON.stringify(route.paramOverrides, null, 2),
        ...(route.note === null ? {} : { note: route.note }),
      })),
    );
  }, [routes.data]);

  /**
   * Here — and only here — every endpoint of the right modality is offered.
   *
   * This screen is where a pairing is *asserted*: "WaveSpeed's Kling v3 runs
   * the same model our Kling 3.0 does". Nothing in the database can check that
   * claim, so the list cannot be narrowed for you; what it can do is make the
   * claim deliberate. A row added here starts switched off, carries a note
   * saying what it is based on, and only then shows up in the one-click
   * dropdown on the list.
   */
  const sameModality = useMemo(
    () => servingModels.filter((serving) => serving.modality === model.modality),
    [servingModels, model.modality],
  );

  const withoutAdapter = useMemo(
    () => new Set(providers.filter((provider) => !provider.hasAdapter).map((provider) => provider.id)),
    [providers],
  );

  /**
   * The same two rules the server refuses on, checked here so the message says
   * what is wrong instead of surfacing a constraint name — and so a save that
   * cannot succeed is not sent at all.
   */
  const problem = useMemo(() => {
    if (!draft) return null;
    const targets = draft.map((route) => route.servingModelId);
    if (targets.some((id) => !id)) return "یک ردیف هنوز مقصدی ندارد.";
    if (new Set(targets).size !== targets.length) return "یک مدل مقصد فقط می‌تواند یک بار بیاید.";
    const activePriorities = draft.filter((route) => route.isActive).map((route) => route.priority);
    if (new Set(activePriorities).size !== activePriorities.length) return "دو مسیر فعال نمی‌توانند اولویت یکسان داشته باشند.";
    for (const route of draft) {
      try {
        ParamOverridesSchema.parse(JSON.parse(route.overridesText || "{}"));
      } catch {
        return "بازنویسی پارامترها JSON معتبر نیست.";
      }
    }
    return null;
  }, [draft]);

  const update = (key: string, patch: Partial<DraftRoute>) =>
    setDraft((rows) => (rows ?? []).map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const save = () => {
    if (!draft || problem) return;
    replace.mutate({
      modelId: model.id,
      routes: draft.map((route) => ({
        servingModelId: route.servingModelId,
        priority: route.priority,
        isActive: route.isActive,
        paramOverrides: ParamOverridesSchema.parse(JSON.parse(route.overridesText || "{}")),
        ...(route.note ? { note: route.note } : {}),
      })),
    });
  };

  return (
    <div>
      <button onClick={onClose} className="text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
        ← برگشت به فهرست
      </button>
      <h3 className="mt-2 text-[15px] font-bold" style={{ color: "var(--vg-text)" }}>
        {model.name}
      </h3>
      <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--vg-text-faint)" }} dir="ltr">
        {model.homeProviderCode} · {model.homeExternalModelId}
      </p>
      <p className="mt-2 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
        بدون هیچ مسیر فعالی، این مدل روی همان ارائه‌دهنده‌ی خانه‌اش اجرا می‌شود. کم‌ترین اولویت برنده است.
      </p>
      <p className="mt-1.5 text-[11.5px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
        فهرست مقصدها اینجا فیلتر نشده — هر نقطه‌پایانی با همین نوع خروجی می‌آید. اینکه فلان ارائه‌دهنده واقعاً همین مدل را اجرا می‌کند چیزی
        است که فقط آدم می‌تواند تأییدش کند، نه دیتابیس. هر ردیفی که اینجا اضافه کنی، خاموش می‌ماند و در دکمه‌ی «انتقال به» فهرست مدل‌ها دیده
        می‌شود؛ پیش از فعال‌کردن، یک جاب واقعی رویش امتحان کن.
      </p>

      {routes.isPending || !draft ? (
        <Muted>در حال خواندن مسیرها…</Muted>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {draft.map((route) => (
            <div
              key={route.key}
              className="rounded-xl p-3"
              style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={route.servingModelId}
                  disabled={!canWrite}
                  onChange={(event) => update(route.key, { servingModelId: event.target.value })}
                  aria-label="مدل مقصد"
                  dir="ltr"
                  className="h-8 rounded-lg px-2 text-[12px]"
                  style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
                >
                  <option value="">— انتخاب مقصد —</option>
                  <ProviderOptions servingModels={sameModality} withoutAdapter={withoutAdapter} />
                </select>

                <label className="flex items-center gap-1 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
                  اولویت
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={route.priority}
                    disabled={!canWrite}
                    onChange={(event) => update(route.key, { priority: Number(event.target.value) })}
                    className="h-8 w-16 rounded-lg px-2 text-[12px]"
                    style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
                  />
                </label>

                <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
                  <input
                    type="checkbox"
                    checked={route.isActive}
                    disabled={!canWrite}
                    onChange={(event) => update(route.key, { isActive: event.target.checked })}
                  />
                  فعال
                </label>

                {canWrite ? (
                  <button
                    onClick={() => setDraft((rows) => (rows ?? []).filter((row) => row.key !== route.key))}
                    className="ms-auto text-[12px]"
                    style={{ color: "var(--vg-text-faint)" }}
                  >
                    حذف ردیف
                  </button>
                ) : null}
              </div>

              <input
                value={route.note ?? ""}
                disabled={!canWrite}
                onChange={(event) => update(route.key, { note: event.target.value })}
                placeholder="یادداشت — چرا این مسیر"
                className="mt-2 h-8 w-full rounded-lg px-2 text-[12px]"
                style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
              />

              {/* A JSON field rather than a builder, on purpose: four operations
                  with an order that matters, edited by four people. A form that
                  hid the order would hide the only thing that is easy to get
                  wrong. */}
              <textarea
                value={route.overridesText}
                disabled={!canWrite}
                onChange={(event) => update(route.key, { overridesText: event.target.value })}
                rows={4}
                spellCheck={false}
                dir="ltr"
                aria-label="بازنویسی پارامترها"
                className="mt-2 w-full rounded-lg p-2 font-mono text-[11.5px]"
                style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
              />
              <p className="mt-1 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                به ترتیب اجرا می‌شود: rename ← map ← set ← drop
              </p>
            </div>
          ))}

          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() =>
                  setDraft((rows) => [
                    ...(rows ?? []),
                    {
                      key: `new-${Date.now()}-${(rows ?? []).length}`,
                      servingModelId: "",
                      // Off, and one past the last: a route nobody has proved
                      // must never arrive switched on.
                      priority: ((rows ?? []).at(-1)?.priority ?? 0) + 10,
                      isActive: false,
                      paramOverrides: {},
                      overridesText: "{}",
                    },
                  ])
                }
                className="h-9 rounded-lg px-3 text-[12.5px]"
                style={{ background: "var(--vg-surface)", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
              >
                افزودن مسیر
              </button>
              <button
                onClick={save}
                disabled={problem !== null || replace.isPending}
                className="h-9 rounded-lg px-3 text-[12.5px] font-bold disabled:opacity-50"
                style={{
                  background: "var(--vg-primary-a18)",
                  color: "var(--vg-primary-soft)",
                  border: "1px solid var(--vg-border-subtle)",
                }}
              >
                {replace.isPending ? "…" : "ذخیره"}
              </button>
              {problem ? (
                <span role="alert" className="text-[12px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
                  {problem}
                </span>
              ) : null}
              {replace.error ? (
                <span role="alert" className="text-[12px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
                  ذخیره نشد.
                </span>
              ) : null}
              {replace.isSuccess && !replace.isPending ? (
                <span className="text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
                  ذخیره شد.
                </span>
              ) : null}
            </div>
          ) : (
            <Muted>برای تغییر مسیرها اجازه‌ی catalog.write لازم است.</Muted>
          )}

          {canWrite ? <NewDestination api={api} providers={providers} modality={model.modality} /> : null}
        </div>
      )}
    </div>
  );
}

/**
 * Add a destination that does not exist yet.
 *
 * Before this, the list of places a model could be sent was whatever
 * `pnpm providers:publish` had seeded — four rows — and a fifth meant editing
 * `routes.wavespeed.json` and re-running a script against production. The
 * routing table was admin-editable; the set of things it could point at was
 * not.
 *
 * The model id is the provider's exact string and there is no validating it
 * from here: WaveSpeed's `bytedance/seedance-2.0-fast/text-to-video` either
 * exists or answers 404 at submit time. That is why a new destination is worth
 * proving on one job before anything is routed to it.
 */
function NewDestination({
  api,
  providers,
  modality,
}: {
  api: AdminApi;
  providers: AdminProvider[];
  modality: AdminCatalogModel["modality"];
}) {
  const create = useServingModelCreate(api);
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [externalModelId, setExternalModelId] = useState("");
  const [name, setName] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="self-start text-[12px] underline-offset-2 hover:underline"
        style={{ color: "var(--vg-text-faint)" }}
      >
        + مقصد تازه
      </button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { providerId, externalModelId: externalModelId.trim(), name: name.trim(), modality },
      {
        onSuccess: () => {
          setExternalModelId("");
          setName("");
        },
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-xl p-3"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
    >
      <p className="text-[12px] font-semibold" style={{ color: "var(--vg-text)" }}>
        مقصد تازه ({modality})
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
          aria-label="ارائه‌دهنده"
          dir="ltr"
          className="h-8 rounded-lg px-2 text-[12px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        >
          <option value="">— ارائه‌دهنده —</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <input
          value={externalModelId}
          onChange={(event) => setExternalModelId(event.target.value)}
          placeholder="شناسه‌ی مدل نزد ارائه‌دهنده"
          aria-label="شناسه‌ی مدل نزد ارائه‌دهنده"
          dir="ltr"
          className="h-8 min-w-[240px] flex-1 rounded-lg px-2 font-mono text-[11.5px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="نام خوانا"
          aria-label="نام خوانا"
          className="h-8 min-w-[140px] rounded-lg px-2 text-[12px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        />
        <button
          type="submit"
          disabled={!providerId || !externalModelId.trim() || !name.trim() || create.isPending}
          className="h-8 rounded-lg px-3 text-[12px] font-bold disabled:opacity-50"
          style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)", border: "1px solid var(--vg-border-subtle)" }}
        >
          {create.isPending ? "…" : "افزودن"}
        </button>
      </div>
      {create.error ? (
        <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
          افزوده نشد — شاید همین شناسه از قبل برای این ارائه‌دهنده ثبت شده باشد.
        </p>
      ) : null}
      <p className="mt-1.5 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
        این مقصد در فروشگاه دیده نمی‌شود؛ فقط جایی است که می‌شود جابی را به آن فرستاد.
      </p>
    </form>
  );
}
