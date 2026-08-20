import type { AppServices } from "../../runtime/AppServices";
import { createHttpAssetsService } from "./assets";
import { createHttpAuthService } from "./auth";
import { createHttpCampaignService } from "./campaign";
import { createHttpCatalogService } from "./catalog";
import { createHttpClient } from "./client";
import { createHttpCommunityService } from "./community";
import { createHttpContentService } from "./content";
import { createHttpGalleryService } from "./gallery";
import { createHttpGenerationService } from "./generation";
import { createHttpPlansService } from "./plans";
import { createHttpSessionService } from "./session";
import { createHttpWalletService } from "./wallet";

export function createHttpServices(baseUrl: string, getAccessToken?: () => Promise<string | null>): AppServices {
  const client = createHttpClient({ baseUrl, ...(getAccessToken ? { getAccessToken } : {}) });
  return {
    session: createHttpSessionService(client),
    auth: createHttpAuthService(client, baseUrl),
    catalog: createHttpCatalogService(client),
    content: createHttpContentService(client),
    community: createHttpCommunityService(client),
    plans: createHttpPlansService(client),
    wallet: createHttpWalletService(client),
    campaign: createHttpCampaignService(client),
    generation: createHttpGenerationService(client),
    gallery: createHttpGalleryService(client),
    assets: createHttpAssetsService(client),
  };
}
