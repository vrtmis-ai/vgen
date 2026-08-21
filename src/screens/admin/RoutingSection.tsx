import { useEffect, useMemo, useState, type FormEvent } from "react";
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

  if (models.isPending) return <Muted>در حال خواندن کاتالوگ…</Muted>;
  if (models.error) return <Muted>کاتالوگ خوانده نشد.</Muted>;

  const open = models.data.models.find((model) => model.id === openId) ?? null;

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
      <p className="mb-3 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
        «اجرا روی» یعنی اگر همین حالا جابی ثبت شود، کجا می‌رود. سرور همان‌طور حسابش می‌کند که هنگام اجرا حساب می‌کند.
      </p>
      <Table head={["مدل", "خانه", "اجرا روی", "مسیرها", "انتقال به"]}>
        {models.data.models.map((model) => {
          const moved = model.servingProviderCode !== model.homeProviderCode;
          return (
            <tr key={model.id} className="border-t" style={{ borderColor: "var(--vg-border-subtle)" }}>
              <Cell>
                <button onClick={() => setOpenId(model.id)} className="text-start underline-offset-2 hover:underline">
                  {model.name}
                </button>
                <span className="ms-2 text-[11px]" style={{ color: "var(--vg-text-faint)" }} dir="ltr">
                  {model.variantId}
                </span>
              </Cell>
              <Cell dim>{model.homeProviderCode}</Cell>
              <Cell>
                <span style={{ color: moved ? "var(--vg-primary-soft)" : "var(--vg-text-muted)" }} dir="ltr">
                  {model.servingProviderCode}
                </span>
                {moved ? <span className="ms-1 text-[11px]">↩</span> : null}
              </Cell>
              <Cell dim>
                {model.activeRouteCount} / {model.routeCount}
              </Cell>
              <Cell>
                <MoveTo api={api} model={model} servingModels={models.data.servingModels} canWrite={canWrite} />
              </Cell>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

/**
 * Move one variant somewhere else, in one choice.
 *
 * Only destinations of the same modality are offered. Routing an image variant
 * at a video endpoint is not a preference anyone holds; it is a typo that would
 * be found by every job failing until somebody noticed.
 *
 * Selecting the blank option clears every route, which sends the variant back
 * to the provider that owns its catalogue row. That is a return, not a
 * deletion — nothing a customer can see changes either way.
 */
function MoveTo({
  api,
  model,
  servingModels,
  canWrite,
}: {
  api: AdminApi;
  model: AdminCatalogModel;
  servingModels: AdminServingModel[];
  canWrite: boolean;
}) {
  const routeTo = useRouteTo(api);
  const clear = useClearRoutes(api);
  const busy = routeTo.isPending || clear.isPending;

  const options = useMemo(() => servingModels.filter((serving) => serving.modality === model.modality), [servingModels, model.modality]);

  // The select shows where it is going, not what was last picked: an active
  // route's target, or blank for "home".
  const current =
    model.activeRouteCount > 0 ? (options.find((serving) => serving.externalModelId === model.servingExternalModelId)?.id ?? "") : "";

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
        <ProviderOptions servingModels={options} />
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
function ProviderOptions({ servingModels }: { servingModels: AdminServingModel[] }) {
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
        <optgroup key={group[0]!.providerId} label={group[0]!.providerName}>
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

  const sameModality = useMemo(
    () => servingModels.filter((serving) => serving.modality === model.modality),
    [servingModels, model.modality],
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
                  <ProviderOptions servingModels={sameModality} />
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

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr style={{ color: "var(--vg-text-faint)" }}>
            {head.map((label) => (
              <th key={label} className="pb-2 text-start font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({ children, dim = false }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <td className="py-2 align-top" style={{ color: dim ? "var(--vg-text-faint)" : "var(--vg-text)" }}>
      {children}
    </td>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-[12.5px]" style={{ color: "var(--vg-text-faint)" }}>
      {children}
    </p>
  );
}
