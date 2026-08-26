import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteBanner } from "./SiteBanner";
import { LanguageProvider } from "../lib/i18n";
import { PLAN_LADDER } from "../data/planLadder";
import type { Campaign } from "../runtime/contracts/campaign";

/** Mirrors DWELL_MS in the component; the rotation is what these advance. */
const DWELL = 7000;

const state = vi.hoisted(() => ({ campaign: null as Campaign | null, path: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("../features/session/useSession", () => ({ useActiveCampaign: () => ({ data: state.campaign }) }));

const running = (id: string): Campaign => ({
  id,
  endsAt: Date.now() + 86_400_000,
  maxDiscountPct: 22,
  maxBonusCoins: 350,
});

function renderBanner() {
  render(
    <LanguageProvider initialLang="en">
      <SiteBanner plans={PLAN_LADDER} onSeePlans={vi.fn()} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  // `Date` and the timers both: the rotation runs on setInterval and the
  // countdown reads Date.now(), so a test that moves one has to move the other.
  vi.useFakeTimers();
  state.campaign = null;
  state.path = "/";
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("the site banner", () => {
  it("carries the campaign's own numbers when one is running", () => {
    state.campaign = running("spring");
    renderBanner();

    // 22 and 350 come from the server, not from copy written here — a banner
    // promising a rate the checkout will not honour is the failure mode.
    expect(screen.getByText(/22%/)).toBeInTheDocument();
    expect(screen.getByText(/350/)).toBeInTheDocument();
  });

  it("falls back to the plan benefit when no campaign is running", () => {
    renderBanner();

    expect(screen.getByText(/7 days of unlimited image generation/)).toBeInTheDocument();
  });

  it("leads with the campaign, then hands the strip over", async () => {
    state.campaign = running("spring");
    renderBanner();

    // The deadline goes first: it is the one of the two that stops being true.
    expect(screen.getByText(/22%/)).toBeInTheDocument();
    expect(screen.queryByText(/7 days of unlimited/)).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(DWELL);
    });
    expect(screen.getByText(/7 days of unlimited/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(DWELL);
    });
    expect(screen.getByText(/22%/)).toBeInTheDocument();
  });

  it("holds while a pointer is on it, so the line being read does not move", async () => {
    state.campaign = running("spring");
    renderBanner();

    // Separate acts: the hold is a state change that has to flush before the
    // clock moves, or the interval it removes has already fired three times.
    await act(async () => {
      fireEvent.mouseEnter(screen.getByRole("region", { name: "Site announcements" }));
    });
    await act(async () => {
      vi.advanceTimersByTime(DWELL * 3);
    });
    expect(screen.getByText(/22%/)).toBeInTheDocument();

    // And resumes the moment it is left.
    await act(async () => {
      fireEvent.mouseLeave(screen.getByRole("region", { name: "Site announcements" }));
    });
    await act(async () => {
      vi.advanceTimersByTime(DWELL);
    });
    expect(screen.getByText(/7 days of unlimited/)).toBeInTheDocument();
  });

  it("counts the campaign down once a second while it is the one showing", async () => {
    state.campaign = { ...running("spring"), endsAt: Date.now() + 3 * 3600_000 + 5000 };
    renderBanner();

    expect(screen.getByText(/03:00:05/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/03:00:03/)).toBeInTheDocument();
  });

  it("does not rotate when only one announcement qualifies", async () => {
    renderBanner();

    await act(async () => {
      vi.advanceTimersByTime(DWELL * 4);
    });
    expect(screen.getByText(/7 days of unlimited image generation/)).toBeInTheDocument();
  });

  it("treats a campaign whose end has passed as no campaign at all", () => {
    state.campaign = { ...running("spring"), endsAt: Date.now() - 1000 };
    renderBanner();

    expect(screen.getByText(/7 days of unlimited image generation/)).toBeInTheDocument();
  });

  it("stays away from /plans, which carries the same offer with a clock", () => {
    state.campaign = running("spring");
    state.path = "/plans";
    renderBanner();

    expect(screen.queryByRole("button", { name: "Close banner" })).not.toBeInTheDocument();
  });

  it("keys the dismissal to the campaign, so the next one is not silenced by it", async () => {
    state.campaign = running("spring");
    const first = render(
      <LanguageProvider initialLang="en">
        <SiteBanner plans={PLAN_LADDER} onSeePlans={vi.fn()} />
      </LanguageProvider>,
    );

    // fireEvent, not userEvent: this is one plain click, and userEvent schedules
    // its own waits against a clock these tests have replaced.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close banner" }));
    });
    expect(screen.queryByText(/22%/)).not.toBeInTheDocument();
    first.unmount();

    // Same visitor, same browser, a different campaign.
    state.campaign = running("summer");
    renderBanner();

    expect(screen.getByText(/22%/)).toBeInTheDocument();
  });
});
