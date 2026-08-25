import { ActiveCampaignSchema, type Campaign } from "@vgen/contracts";
import type { FastifyInstance } from "fastify";

export interface CustomerCampaignApplication {
  getActive(): Promise<Campaign | null>;
}

/**
 * Public, like the plans it advertises. Someone deciding whether to sign up has
 * to be able to see the offer before they have an account to see it with.
 *
 * Answers `null` most of the year, and the browser treats that as "draw
 * nothing" rather than as an error — which is why the strip's absence has
 * always been the intended state of the page and not a broken fetch.
 */
export function registerCampaignRoute(app: FastifyInstance, campaigns: CustomerCampaignApplication): void {
  /* Not memoised through `publicJson`, unlike the catalogue and the plans
     beside it. That cache is keyed on the identity of the document it is handed
     and a campaign expires by the clock rather than by a write, so the one
     request that matters most — the first one after the countdown reaches zero
     — is exactly the one a reference-keyed cache would answer with a stale
     yes. It is a single indexed row against a partial index; it does not need
     the help. */
  app.get("/api/v1/campaigns/active", async (_request, reply) => reply.send(ActiveCampaignSchema.parse(await campaigns.getActive())));
}
