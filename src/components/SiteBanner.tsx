"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Banner } from "./Banner";
import { useI18n } from "../lib/i18n";
import { EASE_OUT } from "../lib/motion";
import { useActiveCampaign } from "../features/session/useSession";
import type { Campaign } from "../runtime/contracts/campaign";
import type { Plan } from "../runtime/contracts/plans";

/** How long each announcement holds the strip before the next one takes it. */
const DWELL_MS = 7000;

interface Announcement {
  id: string;
  body: ReactNode;
}

/**
 * The strip above everything, cycling through whatever is currently true.
 *
 * Both announcements can qualify at once and the strip is one row, so they take
 * turns rather than one winning: a campaign expires and the plan benefit does
 * not, and showing only the deadline would bury the offer that is always there
 * — while showing only the offer would waste the deadline.
 *
 * Nothing here is written copy. The campaign's percentage and bonus are the
 * server's own numbers, and the unlimited headline is the exact string the plans
 * screen prints for the same benefit, so the strip and the page it links to
 * cannot come to disagree.
 *
 * **Never on `/plans`.** That page already carries `FestivalBanner` — the same
 * offer with a full clock — and two of them stacked would put the top 90px of
 * the page under one message.
 */
export function SiteBanner({ plans, onSeePlans }: { plans: readonly Plan[]; onSeePlans: () => void }) {
  const { t, n } = useI18n();
  const pathname = usePathname();
  const { data: campaign } = useActiveCampaign();
  const reduced = useReducedMotion();

  const [now, setNow] = useState(() => Date.now());
  const [index, setIndex] = useState(0);
  /**
   * Rotation stops while a pointer is on the strip or focus is inside it.
   *
   * Text that changes out from under somebody mid-sentence is the whole reason
   * carousels have a bad name, and this one is a link: a target that swaps for
   * a different destination between reading it and pressing it is worse than a
   * slow one.
   */
  const [held, setHeld] = useState(false);

  /**
   * A coarse clock for whether the campaign is still running.
   *
   * The countdown below keeps its own per-second one, and only while it is the
   * slide on screen. This one exists so a page left open all day eventually
   * drops an expired campaign, and twice a minute is enough for that.
   */
  useEffect(() => {
    if (!campaign) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [campaign]);

  const announcements = useMemo(() => {
    const list: Announcement[] = [];

    if (campaign && campaign.endsAt > now)
      list.push({
        id: `campaign-${campaign.id}`,
        body: (
          <>
            {t("pl_festival_strip").replace("{pct}", n(campaign.maxDiscountPct)).replace("{n}", n(campaign.maxBonusCoins))}
            {" · "}
            <Countdown campaign={campaign} />
          </>
        ),
      });

    // The plan that carries the benefit, read off the served ladder rather than
    // named here — the tier granting it has moved once already.
    if (plans.some((plan) => plan.code === "pro"))
      list.push({
        id: "unlimited-trial",
        body: (
          <>
            {t("pl_unlimited_7d_title")}
            {" · "}
            {t("banner_plans_cta")}
          </>
        ),
      });

    return list;
  }, [campaign, now, plans, t, n]);

  // Whatever the list is, `index` has to point inside it — a campaign expiring
  // shortens it under a pointer that was already past the end.
  const current = announcements[index % Math.max(announcements.length, 1)];

  useEffect(() => {
    if (held || announcements.length < 2) return;
    const timer = window.setInterval(() => setIndex((at) => (at + 1) % announcements.length), DWELL_MS);
    return () => window.clearInterval(timer);
  }, [held, announcements.length]);

  if (pathname === "/plans" || !current) return null;

  return (
    <Banner
      /* One key for the whole rotation, so dismissing the strip dismisses the
         strip. It is built from the ids in it rather than fixed, which keeps the
         property the single-announcement version had: a new campaign is a new
         key, so last season's dismissal cannot silence it. */
      id={announcements.map((item) => item.id).join("+")}
      /* One treatment for the strip, not one per slide. The variant used to
         travel with the announcement, so the strip turned from the brand sheen
         to a flat grey panel halfway through a rotation — it read as the banner
         breaking rather than as the message changing. What rotates is the
         sentence; the strip is the strip. */
      variant="rainbow"
      onClick={onSeePlans}
      onHold={setHeld}
      label={t("banner_region")}
    >
      {/* Keyed enter-only, no AnimatePresence and no exit — the same call the
          nav layout makes, for the same reason. `mode="wait"` keeps the outgoing
          slide mounted until its exit animation reports completion, and that
          report rides on requestAnimationFrame, which a backgrounded tab
          throttles to nothing. The strip would freeze on whichever announcement
          was showing when the tab lost focus, and since the destination travels
          with the slide, on that slide's link too. */}
      <motion.span
        key={current.id}
        className="block truncate"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0.12 : 0.24, ease: EASE_OUT }}
      >
        {current.body}
      </motion.span>
    </Banner>
  );
}

/**
 * The time left, ticking once a second — and only while this is the slide on
 * screen, because it is unmounted the moment the strip rotates past it.
 *
 * Compact on purpose. The plans page draws a four-cell clock with labels; this
 * has a row to share with the offer itself, so days are spoken and the rest is
 * a clock, which is how a clock reads.
 */
function Countdown({ campaign }: { campaign: Campaign }) {
  const { t, n, lang } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = Math.max(0, Math.floor((campaign.endsAt - now) / 1000));
  const days = Math.floor(remaining / 86400);
  const pad = (value: number) => n(value).padStart(2, lang === "fa" ? "۰" : "0");
  const clock = `${pad(Math.floor((remaining % 86400) / 3600))}:${pad(Math.floor((remaining % 3600) / 60))}:${pad(remaining % 60)}`;

  /* On its own dark chip rather than bare on the strip — the same call the
     plans page makes, for the same reason it records: coloured type on a
     saturated field is high contrast but low *separation*, and the digits sank
     into the sheen. Tabular numerals so the seconds do not shuffle the line
     every tick. */
  return (
    <span
      className="vg-numeric ms-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 align-middle text-[12px] font-bold tabular-nums"
      style={{ background: "var(--vg-deep)", color: "var(--vg-text)" }}
    >
      {days > 0 && (
        <span style={{ color: "var(--vg-text-muted)" }}>
          {n(days)} {t("pl_festival_days")}
        </span>
      )}
      {clock}
    </span>
  );
}
