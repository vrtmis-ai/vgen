import { useState } from "react";
import { permits, useAdminAvailability, useAdminSession, useAdminSignIn } from "../../features/admin/useAdmin";
import type { AdminApi } from "../../features/admin/adminApi";
import type { AdminSessionState } from "../../runtime/contracts/admin";
import { AccessSection } from "./AccessSection";
import { AdminSignIn } from "./AdminSignIn";
import { CommunitySection } from "./CommunitySection";
import { ContentSection } from "./ContentSection";
import { OpsSection } from "./OpsSection";
import { DashboardSection } from "./DashboardSection";
import { ProvidersSection } from "./ProvidersSection";
import { RoutingSection } from "./RoutingSection";
import { SecuritySection } from "./SecuritySection";
import { StaffSection } from "./StaffSection";
import { UsersSection } from "./UsersSection";

/**
 * The staff console.
 *
 * This replaces a panel that wrote to localStorage and had never called the
 * API. That one could be reached by anyone who typed /admin, which was safe
 * only for exactly as long as every write stayed in the operator's own browser.
 * This one cannot do anything without a staff session that has proved a second
 * factor, and every mutation it makes writes an `audit_log` row the person who
 * made it cannot tidy afterwards.
 *
 * **Sections are gated on permissions, not on a role name.** A person who
 * cannot write routes does not get a disabled Save button — a disabled control
 * is still an invitation to find out who can press it — and a person with no
 * `catalog.read` does not see that the section exists.
 *
 * A rail rather than a row of tabs, because there are six sections now and a
 * tab row wraps onto two lines at six. The rail also lets the dashboard be
 * where /admin opens, which answers "how are we doing" before anybody clicks.
 */
export function AdminConsole() {
  const availability = useAdminAvailability();
  const api = availability.available ? availability.api : null;
  const session = useAdminSession(api);

  if (!availability.available) return <Notice title="در دسترس نیست">{availability.reason}</Notice>;

  if (session.isPending) return <Notice title="…">در حال بررسی نشست.</Notice>;
  if (session.error) {
    return (
      <Notice title="خطا" retry={{ onClick: () => void session.refetch(), busy: session.isFetching }}>
        نشست خوانده نشد. شبکه یا سرور در دسترس نیست.
      </Notice>
    );
  }

  // Null is signed out, and `mfa_required` is signed in but authorising
  // nothing. Both belong on the sign-in screen; only the second can resume.
  if (!session.data || session.data.status !== "authed") {
    return <AdminSignIn api={api!} session={session.data ?? null} />;
  }

  return <Console api={api!} session={session.data} />;
}

type SectionId = "dashboard" | "users" | "routing" | "providers" | "content" | "community" | "access" | "staff" | "security" | "ops";

function Console({ api, session }: { api: AdminApi; session: AdminSessionState }) {
  const { signOut } = useAdminSignIn(api);

  const sections: { id: SectionId; label: string; group: string; visible: boolean }[] = [
    { id: "dashboard", label: "داشبورد", group: "سنجه‌ها", visible: permits(session, "analytics.read") },
    // The customer list carries email addresses beside spending, so it needs a
    // second permission the aggregate numbers do not.
    {
      id: "users",
      label: "کاربران",
      group: "سنجه‌ها",
      visible: permits(session, "analytics.read") && permits(session, "users.read"),
    },
    { id: "routing", label: "مسیر مدل‌ها", group: "کاتالوگ", visible: permits(session, "catalog.read") },
    { id: "providers", label: "ارائه‌دهنده‌ها", group: "کاتالوگ", visible: permits(session, "catalog.read") },
    { id: "content", label: "افکت‌ها و آکادمی", group: "محتوا", visible: permits(session, "content.read") },
    { id: "community", label: "اشتراک‌های کاربران", group: "محتوا", visible: permits(session, "community.read") },
    {
      id: "access",
      label: "دعوت و تخفیف",
      group: "دسترسی",
      visible: permits(session, "invites.read") || permits(session, "promos.read"),
    },
    {
      id: "staff",
      label: "هم‌تیمی‌ها",
      group: "امنیت",
      visible: permits(session, "staff.read"),
    },
    { id: "security", label: "نشست‌ها", group: "امنیت", visible: permits(session, "security.read") },
    // Failures and the rate need analytics.read; the log needs security.read.
    // Either one is enough to open the page — each half says so when it cannot load.
    {
      id: "ops",
      label: "وضعیت و دفتر",
      group: "امنیت",
      visible: permits(session, "analytics.read") || permits(session, "security.read"),
    },
  ];
  const visible = sections.filter((section) => section.visible);
  const [current, setCurrent] = useState<SectionId>(visible[0]?.id ?? "dashboard");

  const groups = [...new Set(visible.map((section) => section.group))];

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-20 pt-6">
      <header className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-[18px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
          پنل مدیریت
        </h1>
        <span className="text-[11.5px]" style={{ color: "var(--vg-text-faint)" }} dir="ltr">
          {session.email ?? "—"} · {session.roles.join(", ") || "no role"}
        </span>
        <button
          onClick={() => signOut.mutate()}
          className="ms-auto h-8 rounded-lg px-3 text-[12px]"
          style={{ background: "var(--vg-surface)", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
        >
          خروج
        </button>
      </header>

      {visible.length === 0 ? (
        <Notice title="هیچ بخشی">این نقش به هیچ بخشی از این پنل دسترسی ندارد.</Notice>
      ) : (
        <div className="mt-5 flex flex-col gap-5 md:flex-row md:gap-6">
          <nav className="flex shrink-0 flex-col gap-3 md:w-[170px]" aria-label="بخش‌ها">
            {groups.map((group) => (
              <div key={group}>
                <div className="mb-1 px-1 text-[10.5px] font-semibold" style={{ color: "var(--vg-text-faint)" }}>
                  {group}
                </div>
                <div className="flex flex-wrap gap-1 md:flex-col">
                  {visible
                    .filter((section) => section.group === group)
                    .map((section) => (
                      <button
                        key={section.id}
                        onClick={() => setCurrent(section.id)}
                        aria-pressed={current === section.id}
                        className="h-8 rounded-lg px-3 text-start text-[12.5px] font-semibold"
                        style={{
                          background: current === section.id ? "var(--vg-primary-a18)" : "transparent",
                          color: current === section.id ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                          border: `1px solid ${current === section.id ? "var(--vg-border-subtle)" : "transparent"}`,
                        }}
                      >
                        {section.label}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </nav>

          <main className="min-w-0 flex-1">
            {current === "dashboard" ? <DashboardSection api={api} /> : null}
            {current === "users" ? (
              <UsersSection api={api} canWrite={permits(session, "users.write")} canGrant={permits(session, "credits.grant")} />
            ) : null}
            {current === "routing" ? <RoutingSection api={api} canWrite={permits(session, "catalog.write")} /> : null}
            {current === "providers" ? <ProvidersSection api={api} canWrite={permits(session, "catalog.write")} /> : null}
            {current === "content" ? <ContentSection api={api} canWrite={permits(session, "content.write")} /> : null}
            {current === "community" ? <CommunitySection api={api} canWrite={permits(session, "community.write")} /> : null}
            {current === "staff" ? (
              <StaffSection
                api={api}
                canWrite={permits(session, "staff.write")}
                canGrantPlans={permits(session, "plans.grant")}
                meEmail={session.email}
              />
            ) : null}
            {current === "security" ? <SecuritySection api={api} canWrite={permits(session, "security.write")} /> : null}
            {current === "ops" ? <OpsSection api={api} canWriteFx={permits(session, "fx.write")} /> : null}
            {current === "access" ? (
              <AccessSection api={api} canWrite={permits(session, "invites.write")} canFlags={permits(session, "flags.write")} />
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}

function Notice({
  title,
  children,
  retry,
}: {
  title: string;
  children: React.ReactNode;
  /* A way out. Without one, a notice is a dead end that only a reload
     clears, which is what the session error used to be. */
  retry?: { onClick: () => void; busy: boolean };
}) {
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-[440px] flex-col justify-center px-5">
      <h2 className="text-[15px] font-bold" style={{ color: "var(--vg-text)" }}>
        {title}
      </h2>
      <p className="mt-1.5 text-[12.5px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
        {children}
      </p>
      {retry ? (
        <button
          onClick={retry.onClick}
          disabled={retry.busy}
          className="mt-3 self-start rounded-lg px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-50"
          style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
        >
          {retry.busy ? "…" : "تلاش دوباره"}
        </button>
      ) : null}
    </div>
  );
}
