import { useEffect, useMemo, useState } from "react";
import type { AdminApi } from "../../features/admin/adminApi";
import { useModels, useReplaceRoutes, useRoutes } from "../../features/admin/useAdmin";
import { ParamOverridesSchema, type AdminCatalogModel, type AdminRouteInput, type AdminServingModel } from "../../runtime/contracts/admin";

/**
 * Which provider actually runs each thing we sell.
 *
 * The one number on this screen that matters is **"running on"**. It is the
 * lowest-priority active route, or the catalogue row itself when there is none,
 * and the server computes it the same way `claim()` does — so what this column
 * says and what a submitted job does cannot disagree. Everything else here is
 * how you change it.
 *
 * Saving replaces the whole list rather than patching a row. That is not a
 * simplification: the partial unique index on `(catalog_model_id, priority)
 * where is_active` means swapping two priorities one statement at a time
 * collides on the value that is only transiently taken, and a variant would be
 * left routed somewhere nobody chose.
 */
export function RoutingSection({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const models = useModels(api, true);
  const [openId, setOpenId] = useState<string | null>(null);

  if (models.isPending) return <Muted>در حال خواندن کاتالوگ…</Muted>;
  if (models.error) return <Muted>کاتالوگ خوانده نشد.</Muted>;

  const open = models.data.models.find((model) => model.id === openId) ?? null;

  if (open) {
    return (
      <RouteEditor api={api} model={open} servingModels={models.data.servingModels} canWrite={canWrite} onClose={() => setOpenId(null)} />
    );
  }

  return (
    <div>
      <p className="mb-3 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
        «اجرا روی» یعنی اگر همین حالا جابی ثبت شود، کجا می‌رود. سرور همان‌طور حسابش می‌کند که هنگام اجرا حساب می‌کند.
      </p>
      <Table head={["مدل", "خانه", "اجرا روی", "مسیرها"]}>
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
            </tr>
          );
        })}
      </Table>
    </div>
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
  canWrite,
  onClose,
}: {
  api: AdminApi;
  model: AdminCatalogModel;
  servingModels: AdminServingModel[];
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
                  {servingModels.map((serving) => (
                    <option key={serving.id} value={serving.id}>
                      {serving.providerCode} · {serving.externalModelId}
                    </option>
                  ))}
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
        </div>
      )}
    </div>
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
