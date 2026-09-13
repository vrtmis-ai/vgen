import { useState, type FormEvent } from "react";
import type { AdminApi, StaffMember, StaffTotp } from "../../features/admin/adminApi";
import { useStaff, useStaffMutations, useStaffRoles } from "../../features/admin/useAdmin";
import { ApiError } from "../../runtime/apiError";
import { Cell, Muted, Table, when } from "./primitives";

function appointFailure(error: unknown): string {
  const code = error instanceof ApiError ? error.code : null;
  if (code === "no_such_user") return "این ایمیل حسابی ندارد. برای ساختن حساب، رمز عبور هم بده.";
  if (code === "account_exists") return "این ایمیل از قبل حساب دارد. رمز را خالی بگذار؛ رمز حساب کسی را از اینجا نمی‌شود عوض کرد.";
  if (code === "validation_failed") return "رمز عبور باید دست‌کم ۱۰ نویسه باشد.";
  return "انجام نشد. شاید دسترسی خواسته‌شده بیشتر از توست.";
}

/**
 * Who is staff, and what each of them can do.
 *
 * Until this existed the answer was decided by `scripts/create-admin.ts` on the
 * server, and there were only ever four answers — the seeded roles — of which
 * `admin` holds `["*"]`. So somebody who should have had the moderation queue
 * and nothing else got everything, because everything was the only thing on
 * offer.
 *
 * Two rules shape what this screen is allowed to show, and both are enforced on
 * the server as well — the checkbox list is a convenience, never the control:
 *
 *   · you can only offer permissions you hold yourself, so the list of
 *     checkboxes is built from `grantable`, which the server sends;
 *   · you cannot edit somebody who holds access you do not, and you cannot
 *     edit yourself. Those rows render read-only with the reason on them,
 *     rather than as buttons that will come back 403.
 */

/** Does `held` cover `wanted`? The client half of the same comparison the server makes. */
function covers(held: readonly string[], wanted: string): boolean {
  return held.some(
    (permission) =>
      permission === "*" || permission === wanted || (permission.endsWith(".*") && wanted.startsWith(permission.slice(0, -1))),
  );
}

export function StaffSection({
  api,
  canWrite,
  canGrantPlans,
  meEmail,
}: {
  api: AdminApi;
  canWrite: boolean;
  canGrantPlans: boolean;
  /* Matched by email rather than by id because the staff session does not
     carry one. It only decides whether to draw a button — the server refuses a
     self-edit by user id regardless, which is the check that counts. */
  meEmail: string | null;
}) {
  const staff = useStaff(api, true);
  const roles = useStaffRoles(api, true);
  const mutations = useStaffMutations(api);
  const [editing, setEditing] = useState<string | null>(null);

  const grantable = staff.data?.grantable ?? [];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <Heading>هم‌تیمی‌ها</Heading>
        <Muted>
          دسترسی هر نفر جدا از نقشش قابل تنظیم است. نمی‌توانی دسترسی‌ای بدهی که خودت نداری، و نمی‌توانی دسترسی کسی را که از تو بیشتر دارد
          تغییر دهی. هر تغییر در audit_log ثبت می‌شود.
        </Muted>

        {staff.isPending ? (
          <Muted>…</Muted>
        ) : staff.error ? (
          <Muted>خوانده نشد.</Muted>
        ) : staff.data.staff.length === 0 ? (
          <Muted>هنوز کسی جز خودت نیست.</Muted>
        ) : (
          <Table head={["ایمیل", "نقش", "دسترسی", "دومرحله‌ای", "از", ""]}>
            {staff.data.staff.map((member) => (
              <StaffRow
                key={member.userId}
                member={member}
                grantable={grantable}
                canWrite={canWrite}
                canGrantPlans={canGrantPlans}
                isMe={meEmail !== null && member.email === meEmail}
                editing={editing === member.userId}
                onEdit={() => setEditing(editing === member.userId ? null : member.userId)}
                mutations={mutations}
                roleDefaults={roles.data?.roles ?? []}
              />
            ))}
          </Table>
        )}
      </section>

      {canWrite && <Appoint api={api} grantable={grantable} mutations={mutations} />}
    </div>
  );
}

function StaffRow({
  member,
  grantable,
  canWrite,
  canGrantPlans,
  isMe,
  editing,
  onEdit,
  mutations,
  roleDefaults,
}: {
  member: StaffMember;
  grantable: string[];
  canWrite: boolean;
  canGrantPlans: boolean;
  isMe: boolean;
  editing: boolean;
  onEdit: () => void;
  mutations: ReturnType<typeof useStaffMutations>;
  roleDefaults: { code: string; name: string; permissions: string[] }[];
}) {
  /* The same two refusals the server makes, so a row that cannot be changed
     says why instead of offering a button that comes back 403. */
  const outranks = !member.permissions.every((permission) => covers(grantable, permission));
  const locked = isMe ? "خودت" : outranks ? "دسترسی بیشتر از تو" : null;
  const editable = canWrite && locked === null;

  const [draft, setDraft] = useState<string[]>(member.permissions);
  const [planCode, setPlanCode] = useState("");

  return (
    <>
      <tr>
        <Cell>{member.email ?? "—"}</Cell>
        <Cell>
          {member.roleName}
          {member.isCustom && (
            <span className="ms-1.5 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
              (سفارشی)
            </span>
          )}
        </Cell>
        <Cell dim>{member.permissions.join("، ") || "—"}</Cell>
        <Cell dim>{member.hasMfa ? "دارد" : "ندارد"}</Cell>
        <Cell dim>{when(member.grantedAt)}</Cell>
        <Cell>
          {locked ? (
            <span className="text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
              {locked}
            </span>
          ) : (
            editable && (
              <button onClick={onEdit} className="text-[12px]" style={{ color: "var(--vg-primary-soft)" }}>
                {editing ? "بستن" : "تغییر"}
              </button>
            )
          )}
        </Cell>
      </tr>

      {editing && editable && (
        <tr>
          <td colSpan={6} className="px-3 pb-4">
            <div className="flex flex-col gap-3 rounded-xl p-3" style={{ background: "var(--vg-canvas)" }}>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {grantable.map((permission) => (
                  <label key={permission} className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--vg-text)" }}>
                    <input
                      type="checkbox"
                      checked={draft.includes(permission)}
                      onChange={(event) =>
                        setDraft(event.target.checked ? [...draft, permission] : draft.filter((held) => held !== permission))
                      }
                    />
                    {permission}
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => mutations.setPermissions.mutate({ userId: member.userId, permissions: draft })}
                  disabled={mutations.setPermissions.isPending}
                  className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
                  style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
                >
                  ذخیره
                </button>
                {/* Null, not an empty array: "give them the role's set back" is
                    a real instruction and a different one from "they can do
                    nothing", which is what [] means. */}
                <button
                  onClick={() => mutations.setPermissions.mutate({ userId: member.userId, permissions: null })}
                  className="rounded-lg px-3 py-1.5 text-[12.5px]"
                  style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
                >
                  برگرداندن به نقش ({roleDefaults.find((role) => role.code === member.roleCode)?.permissions.join("، ") || member.roleCode})
                </button>
                <button
                  onClick={() => mutations.revoke.mutate(member.userId)}
                  disabled={mutations.revoke.isPending}
                  className="rounded-lg px-3 py-1.5 text-[12.5px]"
                  style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-danger, #ff6b6b)" }}
                >
                  حذف از تیم
                </button>
              </div>

              {canGrantPlans && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--vg-border-subtle)" }}>
                  <span className="text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
                    پلن:
                  </span>
                  <input
                    value={planCode}
                    onChange={(event) => setPlanCode(event.target.value)}
                    placeholder="کد پلن"
                    className="vg-field-pad h-8 w-[140px] rounded-lg text-[12.5px]"
                    style={{ background: "var(--vg-surface)", color: "var(--vg-text)" }}
                  />
                  <button
                    onClick={() => mutations.grantPlan.mutate({ userId: member.userId, planCode: planCode.trim() })}
                    disabled={!planCode.trim() || mutations.grantPlan.isPending}
                    className="rounded-lg px-3 py-1.5 text-[12.5px] disabled:opacity-40"
                    style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
                  >
                    فعال کن
                  </button>
                  <button
                    onClick={() => mutations.revokePlan.mutate(member.userId)}
                    disabled={mutations.revokePlan.isPending}
                    className="rounded-lg px-3 py-1.5 text-[12.5px]"
                    style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
                  >
                    غیرفعال کن
                  </button>
                  {/* The sentence this feature was asked for. Worth saying on
                      the screen rather than only in the schema: a plan granted
                      here is one term of that plan, and its credits expire with
                      the term — it is not unlimited access. */}
                  <Muted>فعال‌کردن پلن، اعتبار یک دوره را می‌دهد و سقف ماهانهٔ همان پلن را دارد.</Muted>
                </div>
              )}

              {(mutations.setPermissions.error || mutations.revoke.error || mutations.grantPlan.error || mutations.revokePlan.error) && (
                <Muted>انجام نشد. شاید دسترسی لازم را نداری.</Muted>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Appoint({ api, grantable, mutations }: { api: AdminApi; grantable: string[]; mutations: ReturnType<typeof useStaffMutations> }) {
  const roles = useStaffRoles(api, true);
  const [email, setEmail] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  // Shown once: the server keeps the key only sealed.
  const [issued, setIssued] = useState<{ email: string; totp: StaffTotp } | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !roleCode) return;
    const address = email.trim();
    setIssued(null);
    mutations.appoint.mutate(
      {
        email: address,
        roleCode,
        // No permissions chosen means "inherit the role", which is what every
        // staff row created before this screen existed does. Sending [] instead
        // would appoint somebody who can do nothing.
        permissions: permissions.length > 0 ? permissions : undefined,
        password: password || undefined,
      },
      {
        onSuccess: (totp) => {
          setEmail("");
          setPassword("");
          setPermissions([]);
          if (totp) setIssued({ email: address, totp });
        },
      },
    );
  };

  return (
    <section>
      <Heading>افزودن هم‌تیمی</Heading>
      <Muted>
        کارکنان کد دعوت لازم ندارند. اگر این ایمیل هنوز حساب ندارد، یک رمز عبور (دست‌کم ۱۰ نویسه) بده تا حسابش همین‌جا ساخته شود. اگر حساب
        دارد، رمز را خالی بگذار.
      </Muted>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            placeholder="ایمیل"
            aria-label="ایمیل"
            className="vg-field-pad h-9 w-[240px] rounded-lg text-[13px]"
            style={{ background: "var(--vg-surface)", color: "var(--vg-text)" }}
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
            minLength={10}
            placeholder="رمز عبور — فقط برای حساب تازه"
            aria-label="رمز عبور برای حساب تازه"
            className="vg-field-pad h-9 w-[240px] rounded-lg text-[13px]"
            style={{ background: "var(--vg-surface)", color: "var(--vg-text)" }}
            dir="ltr"
          />
          <select
            value={roleCode}
            onChange={(event) => setRoleCode(event.target.value)}
            className="vg-field-pad h-9 rounded-lg text-[13px]"
            style={{ background: "var(--vg-surface)", color: "var(--vg-text)" }}
          >
            <option value="">نقش…</option>
            {(roles.data?.roles ?? []).map((role) => (
              <option key={role.code} value={role.code}>
                {role.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!email.trim() || !roleCode || mutations.appoint.isPending}
            className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            افزودن
          </button>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {grantable.map((permission) => (
            <label key={permission} className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--vg-text)" }}>
              <input
                type="checkbox"
                checked={permissions.includes(permission)}
                onChange={(event) =>
                  setPermissions(event.target.checked ? [...permissions, permission] : permissions.filter((held) => held !== permission))
                }
              />
              {permission}
            </label>
          ))}
        </div>
        <Muted>هیچ‌کدام را انتخاب نکنی، همان دسترسی‌های خودِ نقش را می‌گیرد.</Muted>
        {mutations.appoint.error && <Muted>{appointFailure(mutations.appoint.error)}</Muted>}
      </form>
      {issued && (
        <div
          role="status"
          className="mt-3 rounded-lg p-3 text-[12.5px] leading-[1.9]"
          style={{ background: "var(--vg-surface)", color: "var(--vg-text)" }}
        >
          <p>
            کلید ورود دومرحله‌ای <bdi>{issued.email}</bdi> — همین حالا به خودش بده تا در Google Authenticator (یا هر برنامه‌ی مشابه) وارد
            کند. دوباره نمایش داده نمی‌شود.
          </p>
          <p className="mt-1 select-all font-mono text-[13px]" dir="ltr">
            {issued.totp.secret}
          </p>
          <p className="mt-1">
            روی گوشی، این پیوند برنامه را باز می‌کند:{" "}
            <a href={issued.totp.uri} className="underline" dir="ltr">
              افزودن به برنامه
            </a>
          </p>
          <p className="mt-1" style={{ color: "var(--vg-text-muted)" }}>
            بعد با ایمیل و رمز در /admin وارد می‌شود و کد شش‌رقمی برنامه را می‌زند.
          </p>
        </div>
      )}
    </section>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
      {children}
    </h3>
  );
}
