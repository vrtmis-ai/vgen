import { useState, type FormEvent } from "react";
import type { AdminApi } from "../../features/admin/adminApi";
import { useProviderCreate, useProviderPatch, useProviders } from "../../features/admin/useAdmin";
import { AdminProviderCreateSchema } from "../../runtime/contracts/admin";
import { Cell, Muted, Table } from "./primitives";

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

      {canWrite ? <NewProvider api={api} /> : null}
    </div>
  );
}

/**
 * Add a provider.
 *
 * It will arrive unable to run anything, and the table above says so in two
 * red columns: no adapter until somebody writes one, no key until a deploy
 * sets the variable named here. Both are real work, and the point of creating
 * the row first is that the routing table can be arranged before either lands
 * rather than after.
 *
 * The key itself is not asked for and there is nowhere here to put it.
 * `secret_ref` holds the NAME of an environment variable by design, so a
 * database dump is worth nothing to whoever takes it.
 *
 * Validated against the same schema the server parses, which is how the
 * `NEXT_PUBLIC_` refusal reaches a person as a sentence rather than as a 400.
 * That prefix is inlined into the browser bundle at build time and this
 * repository is public: a key named that way would be published, not leaked.
 */
function NewProvider({ api }: { api: AdminApi }) {
  const create = useProviderCreate(api);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [secretRef, setSecretRef] = useState("");
  const [unitCostUsd, setUnitCostUsd] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 text-[12px] underline-offset-2 hover:underline"
        style={{ color: "var(--vg-text-faint)" }}
      >
        + ارائه‌دهنده‌ی تازه
      </button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = AdminProviderCreateSchema.safeParse({
      code: code.trim(),
      name: name.trim(),
      secretRef: secretRef.trim(),
      creditUnitName: "credit",
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(unitCostUsd.trim() ? { unitCostUsd: Number(unitCostUsd) } : {}),
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "ورودی معتبر نیست.");
      return;
    }
    setProblem(null);
    create.mutate(parsed.data, {
      onSuccess: () => {
        setCode("");
        setName("");
        setBaseUrl("");
        setSecretRef("");
        setUnitCostUsd("");
        setOpen(false);
      },
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-xl p-3"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
    >
      <p className="text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
        ارائه‌دهنده‌ی تازه
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Field value={code} onChange={setCode} placeholder="code" label="کد" mono />
        <Field value={name} onChange={setName} placeholder="نام" label="نام" />
        <Field value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com" label="آدرس پایه" mono wide />
        <Field value={secretRef} onChange={setSecretRef} placeholder="EXAMPLE_API_KEY" label="نام متغیر کلید" mono />
        <Field value={unitCostUsd} onChange={setUnitCostUsd} placeholder="0.005" label="هزینه‌ی هر واحد (دلار)" mono />
        <button
          type="submit"
          disabled={create.isPending}
          className="h-8 rounded-lg px-3 text-[12px] font-bold disabled:opacity-50"
          style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)", border: "1px solid var(--vg-border-subtle)" }}
        >
          {create.isPending ? "…" : "ساختن"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-8 px-2 text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
          انصراف
        </button>
      </div>
      {problem ? (
        <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
          {problem}
        </p>
      ) : null}
      {create.error ? (
        <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
          ساخته نشد — شاید این کد از قبل وجود دارد.
        </p>
      ) : null}
      <p className="mt-1.5 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
        کلید اینجا وارد نمی‌شود. فقط نام متغیر محیطی ذخیره می‌شود؛ مقدارش با یک استقرار تنظیم می‌شود و هرگز وارد پایگاه‌داده نمی‌گردد.
      </p>
    </form>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  label,
  mono = false,
  wide = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      dir={mono ? "ltr" : undefined}
      className={`h-8 rounded-lg px-2 ${mono ? "font-mono text-[11.5px]" : "text-[12px]"} ${wide ? "min-w-[220px] flex-1" : "min-w-[130px]"}`}
      style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
    />
  );
}
