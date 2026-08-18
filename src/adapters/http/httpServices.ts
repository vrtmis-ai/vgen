import type { AppServices } from "../../runtime/AppServices";
import { createHttpAuthService } from "./auth";
import { createHttpCatalogService } from "./catalog";
import { createHttpClient } from "./client";
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
    plans: createHttpPlansService(client),
    wallet: createHttpWalletService(client),
    generation: createHttpGenerationService(client),
    gallery: createHttpGalleryService(client),
  };
}
