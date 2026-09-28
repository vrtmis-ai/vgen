"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n, type TKey } from "../lib/i18n";
import { useAppServices } from "../runtime/AppServices";
import type { OrderStatus } from "../runtime/contracts/account";

/**
 * The four parts of an account page whose routes do not exist yet.
 *
 * Each is its own query and each renders `null` when that query fails. That is
 * the rule `waitlistCount` set in `AppServices`: a call to a route the server
 * has not built must degrade on its own, so a deployment without it shows an
 * account page with fewer cards rather than a page of errors.
 *
 * `retry: false` matters more than it looks. Without it every card would spend
 * three round trips discovering the same 404, on every visit, on a page that is
 * mostly waiting already.
 *
 * In demo mode the adapters answer, so all four are visible and can be worked
 * on. See #142 and #143 for what the server owes them.
 */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-2.5 t-h2">{title}</div>
      <div className="rounded-bezel border border-line bg-card px-3.5">{children}</div>
    </div>
  );
}

const relative = (at: number, lang: string) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(lang === "fa" ? "fa-IR" : "en-US", { numeric: "auto" });
  if (minutes < 60) return rtf.format(-minutes, "minute");
  if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), "hour");
  return rtf.format(-Math.round(minutes / (60 * 24)), "day");
};

/* The current session has no end button — it carries a badge instead. Ending
   it is signing out, which the settings row below already does, and offering it
   twice invites somebody to lock themselves out of the page they are reading. */
export function Sessions() {
  const { t, lang } = useI18n();
  const services = useAppServices();
  const client = useQueryClient();
  const sessions = useQuery({ queryKey: ["me", "sessions"], queryFn: () => services.auth.sessions(), retry: false });
  const end = useMutation({
    mutationFn: (id: string) => services.auth.endSession(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["me", "sessions"] }),
  });
  const endOthers = useMutation({
    mutationFn: () => services.auth.endOtherSessions(),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["me", "sessions"] }),
  });

  if (!sessions.data || sessions.data.length === 0) return null;
  const others = sessions.data.filter((s) => !s.current).length;

  return (
    <Card title={t("p_sessions")}>
      {sessions.data.map((session) => (
        <div key={session.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{session.device}</span>
            <span className="block t-caption text-ink3">
              {[session.city, relative(session.lastSeenAt, lang)].filter(Boolean).join(" · ")}
            </span>
          </span>
          {session.current ? (
            <span
              className="shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-bold"
              style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
            >
              {t("p_session_current")}
            </span>
          ) : (
            <button
              onClick={() => end.mutate(session.id)}
              disabled={end.isPending}
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 t-caption disabled:opacity-40"
            >
              {t("p_session_end")}
            </button>
          )}
        </div>
      ))}
      {others > 0 && (
        <div className="border-t border-line py-3">
          <button
            onClick={() => endOthers.mutate()}
            disabled={endOthers.isPending}
            className="t-caption font-semibold disabled:opacity-40"
            style={{ color: "var(--vg-danger)" }}
          >
            {t("p_session_end_others")}
          </button>
        </div>
      )}
    </Card>
  );
}

const ORDER_LABEL: Record<OrderStatus, TKey> = {
  paid: "p_order_paid",
  pending: "p_order_pending",
  failed: "p_order_failed",
  cancelled: "p_order_cancelled",
  refunded: "p_order_refunded",
};

export function Orders() {
  const { t, n, lang } = useI18n();
  const services = useAppServices();
  const orders = useQuery({ queryKey: ["me", "orders"], queryFn: () => services.payment.orders(), retry: false });
  if (!orders.data || orders.data.length === 0) return null;

  return (
    <Card title={t("p_orders")}>
      {orders.data.map((order) => (
        <div key={order.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">{t("p_order_coins").replace("{n}", n(order.coins))}</span>
            <span className="block t-caption text-ink3">
              {new Date(order.createdAt).toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </span>
          <span className="shrink-0 tabular-nums text-[12.5px]">{n(order.amountToman)}</span>
          <span
            className="shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-bold"
            style={{
              background: order.status === "paid" ? "var(--vg-primary)" : "var(--vg-surface-overlay)",
              color:
                order.status === "paid"
                  ? "var(--vg-text-on-primary)"
                  : order.status === "failed"
                    ? "var(--vg-danger)"
                    : "var(--vg-text-muted)",
            }}
          >
            {t(ORDER_LABEL[order.status])}
          </span>
        </div>
      ))}
    </Card>
  );
}

export function Referral() {
  const { t, n } = useI18n();
  const services = useAppServices();
  const [copied, setCopied] = useState(false);
  const referral = useQuery({ queryKey: ["me", "referral"], queryFn: () => services.auth.referral(), retry: false });
  if (!referral.data) return null;

  const copy = () => {
    // Clipboard is permissioned and absent over plain http; a refusal must not
    // look like a broken button, so the label only changes on success.
    void navigator.clipboard
      ?.writeText(referral.data.code)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  return (
    <Card title={t("p_referral")}>
      <div className="py-3">
        <div className="flex items-center gap-2">
          <code className="ltr flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold" style={{ background: "var(--vg-surface-overlay)" }}>
            {referral.data.code}
          </code>
          <button onClick={copy} className="shrink-0 rounded-lg border border-line px-3 py-2 t-caption">
            {copied ? t("p_referral_copied") : t("p_referral_copy")}
          </button>
        </div>
        <p className="mt-2 t-caption text-ink3">{t("p_referral_hint")}</p>
        <p className="mt-1 t-caption">
          {t("p_referral_invited").replace("{n}", n(referral.data.invited))}
          {" · "}
          <span style={{ color: "var(--vg-primary)" }}>{t("p_referral_earned").replace("{n}", n(referral.data.coinsEarned))}</span>
        </p>
      </div>
    </Card>
  );
}

/**
 * Closing the account.
 *
 * Typing the username to confirm, because a misclick must not be enough.
 *
 * **Not mounted yet**, on purpose — `Profile.tsx` says why. `DELETE /me` does
 * not exist, and unlike the reads above this one has no query to fail quietly:
 * it would walk somebody through confirming their own handle and then answer
 * with a generic error. It goes back on the page the day the route answers.
 *
 * The policy behind the warning was settled with the owner on 2026-09-28 and
 * the copy now says it: the account closes, 30 days to bring it back, then
 * generations, posts and unspent coins go. See #142.
 */
export function DeleteAccount({ handle }: { handle: string }) {
  const { t } = useI18n();
  const services = useAppServices();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const remove = useMutation({ mutationFn: () => services.auth.deleteAccount() });
  const matches = typed.trim().toLowerCase() === handle.toLowerCase();

  return (
    <div className="mb-6">
      <div className="mb-2.5 t-h2" style={{ color: "var(--vg-danger)" }}>
        {t("p_danger")}
      </div>
      <div className="rounded-bezel border px-3.5 py-3" style={{ borderColor: "var(--vg-danger)" }}>
        <p className="t-caption text-ink3">{t("p_delete_warn")}</p>
        {open ? (
          <div className="mt-3 grid gap-2">
            <label className="grid gap-1 t-caption text-ink3">
              {t("p_delete_confirm")}
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                dir="ltr"
                autoComplete="off"
                className="h-10 rounded-xl border border-line bg-transparent px-3 t-body"
              />
            </label>
            {remove.error && (
              <p role="alert" className="t-caption" style={{ color: "var(--vg-danger)" }}>
                {t("auth_err_generic")}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => remove.mutate()}
                disabled={!matches || remove.isPending}
                className="rounded-xl px-3.5 py-2 t-caption font-semibold disabled:opacity-40"
                style={{ background: "var(--vg-danger)", color: "#131507" }}
              >
                {t("p_delete_do")}
              </button>
              <button onClick={() => setOpen(false)} className="rounded-xl border border-line px-3.5 py-2 t-caption">
                {t("p_cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="mt-3 rounded-xl border px-3.5 py-2 t-caption font-semibold"
            style={{ borderColor: "var(--vg-danger)", color: "var(--vg-danger)" }}
          >
            {t("p_delete")}
          </button>
        )}
      </div>
    </div>
  );
}
