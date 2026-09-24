import { useState } from "react";
import type { AdminApi } from "../../features/admin/adminApi";
import { usePlanGrant, usePlanLadder, useUserPlan } from "../../features/admin/useAdmin";
import { ApiError } from "../../runtime/apiError";
import { Muted, num, when } from "./primitives";

/**
 * Turn a plan on for somebody, and say what that will do before it is pressed.
 *
 * One component for customers and colleagues alike, because the route behind it
 * stopped distinguishing them: `plans.grant` comps a paying account and a
 * teammate by the same path, and two forms would be two places for the sentence
 * about the monthly limit to drift out of agreement.
 *
 * It replaces a free-text `planCode` field that would accept "prro" and come
 * back 404. The codes are a short closed list the server already publishes.
 */
export function GrantPlan({ api, userId }: { api: AdminApi; userId: string }) {
  const ladder = usePlanLadder(api, true);
  const live = useUserPlan(api, userId);
  const grant = usePlanGrant(api, userId);
  const [planCode, setPlanCode] = useState("");

  const chosen = ladder.data?.find((plan) => plan.code === planCode);
  const busy = grant.grant.isPending || grant.revoke.isPending;

  return (
    <div className="rounded-xl p-3" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}>
      <p className="text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
        پلن
      </p>

      {live.data ? (
        <p className="mt-1.5 text-[12px]" style={{ color: "var(--vg-text)" }}>
          {live.data.planName} — {num(live.data.coins)} سکه، تا {when(live.data.endsAt)}
        </p>
      ) : (
        <Muted>{live.isPending ? "…" : "پلنی فعال نیست."}</Muted>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <select
          value={planCode}
          onChange={(event) => setPlanCode(event.target.value)}
          aria-label="پلن"
          className="h-8 rounded-lg px-2 text-[12px]"
          style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
        >
          <option value="">انتخاب پلن…</option>
          {(ladder.data ?? []).map((plan) => (
            <option key={plan.code} value={plan.code}>
              {plan.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => grant.grant.mutate(planCode)}
          disabled={!planCode || busy}
          className="h-8 rounded-lg px-3 text-[12px] font-bold disabled:opacity-40"
          style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)", border: "1px solid var(--vg-border-subtle)" }}
        >
          فعال کن
        </button>
        {live.data ? (
          <button
            onClick={() => grant.revoke.mutate()}
            disabled={busy}
            className="h-8 rounded-lg px-3 text-[12px] disabled:opacity-40"
            style={{ background: "var(--vg-bg, #0a0a0b)", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
          >
            لغو پلن
          </button>
        ) : null}
      </div>

      {/* The sentence this was asked for, said before the press rather than
          discovered after it: a grant is one term of the plan, so the plan's
          monthly ceiling is the grant itself and the coins lapse with it. A
          pack has no term, so nothing about it expires. */}
      {chosen ? (
        <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--vg-text-muted)" }}>
          {chosen.termDays > 0
            ? `${num(chosen.coinsPerTerm)} سکه برای ${num(chosen.termDays)} روز. سقف ماهانهٔ همین پلن را دارد و ته دوره منقضی می‌شود.`
            : `${num(chosen.coinsPerTerm)} سکه بدون تاریخ انقضا — این بسته است، نه اشتراک.`}
        </p>
      ) : (
        <Muted>فعال‌کردن پلن، اعتبار یک دوره را می‌دهد و سقف ماهانهٔ همان پلن را دارد.</Muted>
      )}

      {grant.grant.error || grant.revoke.error ? (
        <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
          {grantFailure(grant.grant.error ?? grant.revoke.error)}
        </p>
      ) : null}
    </div>
  );
}

/** Each refusal in its own words; pressing twice is the one people will hit. */
function grantFailure(error: unknown): string {
  const code = error instanceof ApiError ? error.code : null;
  if (code === "already_active") return "این حساب همین حالا روی یک پلن است. اول لغوش کن.";
  if (code === "unknown_plan") return "چنین پلنی وجود ندارد.";
  if (code === "no_account") return "این نفر هنوز حساب شخصی ندارد.";
  if (code === "not_active") return "پلنی فعال نیست که لغو شود.";
  if (code === "outranked") return "این نفر از تو بالاتر است.";
  if (code === "forbidden") return "دسترسی plans.grant را نداری.";
  return "انجام نشد.";
}
