import { useState, type FormEvent } from "react";
import type { AdminApi, StaffMember, StaffTotp } from "../../features/admin/adminApi";
import { useStaff, useStaffMutations, useStaffRoles } from "../../features/admin/useAdmin";
import { ApiError } from "../../runtime/apiError";
import { GrantPlan } from "./GrantPlan";
import { Cell, Muted, Table, when } from "./primitives";

/**
 * Every refusal this form can get, in its own words.
 *
 * This used to name three codes and send the other eight to "maybe you asked
 * for more access than you hold" — which, for the account that holds `*` and
 * was simply typing its own address, was a fabricated explanation for a
 * refusal that had nothing to do with permissions. A message that guesses is
 * worse than one that admits it does not know, because the guess sends people
 * to look in the wrong place.
 */
function appointFailure(error: unknown): string {
  const code = error instanceof ApiError ? error.code : null;
  if (code === "no_such_user") return "این ایمیل حسابی ندارد. برای ساختن حساب، رمز عبور هم بده.";
  if (code === "account_exists") return "این ایمیل از قبل حساب دارد. رمز را خالی بگذار؛ رمز حساب کسی را از اینجا نمی‌شود عوض کرد.";
  if (code === "validation_failed") return "رمز عبور باید دست‌کم ۱۰ نویسه باشد.";
  if (code === "self") return "این آدرس خودت است. دسترسی خودت را از این‌جا نمی‌شود عوض کرد.";
  if (code === "beyond_your_own") return "این نقش دسترسی‌ای دارد که خودت نداری، و نمی‌شود چیزی داد که نداری.";
  if (code === "outranked") return "این نفر دسترسی‌ای دارد که تو نداری، پس تغییرش با تو نیست.";
  if (code === "no_such_role") return "چنین نقشی وجود ندارد.";
  if (code === "role_above_you") return "این نقش از نقش خودت بالاتر است. فقط کسی که هم‌رتبه‌اش باشد می‌تواند آن را بدهد.";
  if (code === "forbidden") return "دسترسی staff.write را نداری.";
  if (code === "mfa_required") return "ورود دومرحله‌ای‌ات هنوز تأیید نشده. یک بار بیرون برو و دوباره وارد شو.";
  if (code === "not_found") return "نشستت منقضی شده. دوباره وارد شو.";
  if (code === "network_error" || code === "request_timeout") return "به سرور نرسید. اتصال را بررسی کن و دوباره بزن.";
  // No invented reason. The server refused and did not say something we know.
  return "سرور این درخواست را نپذیرفت.";
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
 * Three rules shape what this screen is allowed to show, and all three are
 * enforced on the server as well — this list is a convenience, never the
 * control:
 *
 *   · you can only offer permissions you hold yourself, so the list of
 *     checkboxes is built from `grantable`, which the server sends;
 *   · you cannot edit somebody who holds access you do not, and you cannot
 *     edit yourself. Those rows render read-only with the reason on them,
 *     rather than as buttons that will come back 403;
 *   · you cannot touch anybody ranked above you, or appoint to a role above
 *     your own. Rank is the one of the three that `grantable` cannot imply —
 *     an owner and an admin both hold `*` — so the server sends it too.
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
  /* Zero until the list arrives, which refuses everything rather than
     offering it — the wrong way to be wrong here is the permissive one. */
  const myRank = staff.data?.rank ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <Heading>هم‌تیمی‌ها</Heading>
        <Muted>
          دسترسی هر نفر جدا از نقشش قابل تنظیم است. نمی‌توانی دسترسی‌ای بدهی که خودت نداری، نمی‌توانی دسترسی کسی را که از تو بیشتر دارد
          تغییر دهی، و نمی‌توانی کسی را به نقشی بالاتر از نقش خودت بگماری. هر تغییر در audit_log ثبت می‌شود.
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
                api={api}
                member={member}
                grantable={grantable}
                canWrite={canWrite}
                canGrantPlans={canGrantPlans}
                myRank={myRank}
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

      {canWrite && <Appoint api={api} grantable={grantable} mutations={mutations} meEmail={meEmail} myRank={myRank} />}
    </div>
  );
}

function StaffRow({
  api,
  member,
  grantable,
  canWrite,
  canGrantPlans,
  myRank,
  isMe,
  editing,
  onEdit,
  mutations,
  roleDefaults,
}: {
  api: AdminApi;
  member: StaffMember;
  grantable: string[];
  canWrite: boolean;
  canGrantPlans: boolean;
  myRank: number;
  isMe: boolean;
  editing: boolean;
  onEdit: () => void;
  mutations: ReturnType<typeof useStaffMutations>;
  roleDefaults: { code: string; name: string; permissions: string[] }[];
}) {
  /* The same three refusals the server makes, so a row that cannot be changed
     says why instead of offering a button that comes back 403. Rank is checked
     first because it is the one `grantable` cannot see: an owner and an admin
     both hold `*`, so the permission comparison below finds nothing wrong. */
  const outranks = !member.permissions.every((permission) => covers(grantable, permission));
  const locked = isMe ? "خودت" : member.rank > myRank ? "بالاتر از تو" : outranks ? "دسترسی بیشتر از تو" : null;
  const editable = canWrite && locked === null;

  const [draft, setDraft] = useState<string[]>(member.permissions);

  return (
    <>
      <tr>
        <Cell>{member.email ?? "—"}</Cell>
        <Cell>
          {member.roleName}
          {member.rank > myRank && (
            <span className="ms-1.5 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
              (بالاتر)
            </span>
          )}
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

              {/* The same control the customer list draws. A colleague and a
                  customer are one route now, so they should not be two forms. */}
              {canGrantPlans && <GrantPlan api={api} userId={member.userId} />}

              {(mutations.setPermissions.error || mutations.revoke.error) && <Muted>انجام نشد. شاید دسترسی لازم را نداری.</Muted>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Appoint({
  api,
  grantable,
  mutations,
  meEmail,
  myRank,
}: {
  api: AdminApi;
  grantable: string[];
  mutations: ReturnType<typeof useStaffMutations>;
  meEmail: string | null;
  myRank: number;
}) {
  const roles = useStaffRoles(api, true);
  const [email, setEmail] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  // Shown once: the server keeps the key only sealed.
  const [issued, setIssued] = useState<{ email: string; totp: StaffTotp } | null>(null);

  /* Your own address, caught here rather than by the round trip. The server
     refuses it either way — this only means the form says so while you are
     still looking at the field you typed it into. */
  const isSelf = meEmail !== null && email.trim().toLowerCase() === meEmail.toLowerCase();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !roleCode || isSelf) return;
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
            {/* Roles above your own are left out rather than offered and
                refused. The server checks again either way. */}
            {(roles.data?.roles ?? [])
              .filter((role) => role.rank <= myRank)
              .map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name}
                </option>
              ))}
          </select>
          <button
            type="submit"
            disabled={!email.trim() || !roleCode || isSelf || mutations.appoint.isPending}
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
        {isSelf && <Muted>این آدرس خودت است. دسترسی خودت را از این‌جا نمی‌شود عوض کرد.</Muted>}
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
