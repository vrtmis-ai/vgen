import type { AdminApi } from "../../features/admin/adminApi";
import { useProviderPatch, useProviders } from "../../features/admin/useAdmin";
import { Cell, Muted, Table } from "./RoutingSection";

/**
 * The upstream accounts, and whether each one can actually be called.
 *
 * Three columns here answer the three separate ways a provider can be unusable,
 * and they are worth keeping apart because the fix for each is different:
 *
 *   • **آداپتور** — whether `createGenerationProvider` knows how to call it at
 *     all. No adapter means every job routed here refuses and refunds. Fixed by
 *     writing code.
 *   • **کلید** — whether the environment variable named by `secretRef` is set
 *     in the process answering this. Fixed by a deploy, not a deploy of code.
 *   • **فعال** — whether we have chosen to use it. Fixed here.
 *
 * `secretRef` is a variable NAME. The value has never left the server and this
 * page could not show it if it tried — the column has only ever stored the name.
 */
export function ProvidersSection({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const providers = useProviders(api, true);
  const patch = useProviderPatch(api);

  if (providers.isPending) return <Muted>در حال خواندن ارائه‌دهنده‌ها…</Muted>;
  if (providers.error) return <Muted>ارائه‌دهنده‌ها خوانده نشدند.</Muted>;

  return (
    <div>
      <Table head={["ارائه‌دهنده", "آداپتور", "نرخ واحد", "کلیدها", "فعال"]}>
        {providers.data.providers.map((provider) => (
          <tr key={provider.id} className="border-t align-top" style={{ borderColor: "var(--vg-border-subtle)" }}>
            <Cell>
              <span dir="ltr">{provider.code}</span>
              <div className="text-[11px]" style={{ color: "var(--vg-text-faint)" }} dir="ltr">
                {provider.baseUrl ?? "—"}
              </div>
            </Cell>
            <Cell dim={!provider.hasAdapter}>{provider.hasAdapter ? "دارد" : "ندارد — هر جاب رد می‌شود"}</Cell>
            <Cell dim>{provider.unitCostUsd === null ? "ثبت نشده" : `$${provider.unitCostUsd}`}</Cell>
            <Cell>
              {provider.credentials.length === 0 ? (
                <span style={{ color: "var(--vg-text-faint)" }}>—</span>
              ) : (
                provider.credentials.map((credential) => (
                  <div key={credential.id} className="text-[11.5px]" dir="ltr">
                    <span style={{ color: "var(--vg-text-muted)" }}>{credential.secretRef}</span>{" "}
                    <span style={{ color: credential.configured ? "var(--vg-text-faint)" : "var(--vg-danger, #ff6c52)" }}>
                      {credential.configured ? "set" : "not set"}
                    </span>
                  </div>
                ))
              )}
            </Cell>
            <Cell>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={provider.isActive}
                  disabled={!canWrite || patch.isPending}
                  onChange={(event) => patch.mutate({ id: provider.id, patch: { isActive: event.target.checked } })}
                />
                <span className="sr-only">فعال بودن {provider.code}</span>
              </label>
            </Cell>
          </tr>
        ))}
      </Table>

      {!canWrite ? <Muted>برای تغییر ارائه‌دهنده‌ها اجازه‌ی catalog.write لازم است.</Muted> : null}
      {patch.error ? <Muted>تغییر ذخیره نشد.</Muted> : null}
      <Muted>
        غیرفعال‌کردن یک ارائه‌دهنده، هر مدلی را که مسیر فعالی به آن دارد به ارائه‌دهنده‌ی خانه‌اش برمی‌گرداند. ستون «اجرا روی» در بخش مسیرها
        همان را نشان می‌دهد.
      </Muted>
    </div>
  );
}
