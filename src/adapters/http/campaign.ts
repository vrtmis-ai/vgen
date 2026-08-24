import type { AppServices } from "../../runtime/AppServices";
import { ActiveCampaignSchema } from "../../runtime/contracts/campaign";
import type { HttpClient } from "./client";

export function createHttpCampaignService(client: HttpClient): AppServices["campaign"] {
  return {
    getActive(options) {
      return client.request("/campaigns/active", { schema: ActiveCampaignSchema, signal: options?.signal });
    },
  };
}
