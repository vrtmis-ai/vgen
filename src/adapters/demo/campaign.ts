import type { AppServices } from "../../runtime/AppServices";
import type { Campaign } from "../../runtime/contracts/campaign";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Demo mode invents a campaign, the same way it invents a wallet and a
 * catalogue — it exists so the whole product is reachable with no backend.
 *
 * The end is anchored to a midnight four days out rather than "now plus four
 * days", so the countdown holds still across a reload instead of springing back
 * to full every time the page loads. Production never reaches this file: the
 * HTTP adapter is what runs when NEXT_PUBLIC_API_BASE_URL is set, and until the
 * API answers, the banner does not render at all.
 */
export function demoCampaign(now: number): Campaign {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return {
    id: "demo-festival",
    endsAt: midnight.getTime() + 4 * DAY_MS,
    maxDiscountPct: 22,
    maxBonusCoins: 350,
  };
}

export function createDemoCampaignService(now: () => number): AppServices["campaign"] {
  return { getActive: async () => demoCampaign(now()) };
}
