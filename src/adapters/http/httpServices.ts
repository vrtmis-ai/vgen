import type { AppServices } from "../../runtime/AppServices";
import { createHttpAuthService } from "./auth";
import { createHttpCatalogService } from "./catalog";
import { createHttpClient } from "./client";
import { createHttpGalleryService } from "./gallery";
import { createHttpGenerationService } from "./generation";
import { createHttpSessionService } from "./session";
import { createHttpWalletService } from "./wallet";

export function createHttpServices(baseUrl: string, getAccessToken?: () => Promise<string | null>): AppServices {
  const client = createHttpClient({ baseUrl, ...(getAccessToken ? { getAccessToken } : {}) });
  return {
    session: createHttpSessionService(client),
    auth: createHttpAuthService(client),
    catalog: createHttpCatalogService(client),
    wallet: createHttpWalletService(client),
    generation: createHttpGenerationService(client),
    gallery: createHttpGalleryService(client),
  };
}
