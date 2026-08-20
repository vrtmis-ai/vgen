import type { AppServices } from "../../runtime/AppServices";
import { createDemoAuthService, createDemoAuthState } from "./auth";
import { createDemoCatalogService } from "./catalog";
import { createDemoCommunityService } from "./community";
import { createDemoContentService } from "./content";
import { createDemoGenerationAdapters } from "./generation";
import { createDemoPlansService } from "./plans";
import { createDemoSessionService } from "./session";
import { createDemoWalletService } from "./wallet";

export interface DemoServiceOptions {
  now?: (() => number) | undefined;
  /**
   * Start signed out, so a sign-in screen can be built and demonstrated.
   *
   * Off by default: demo mode exists so the whole product is reachable with no
   * backend, and starting anonymous would put an unbuilt sign-in screen between
   * a developer and every other screen.
   */
  startAnonymous?: boolean | undefined;
}

export function createDemoServices(options: DemoServiceOptions = {}): AppServices {
  const now = options.now ?? Date.now;
  const authState = createDemoAuthState(!options.startAnonymous);
  const { generation, gallery, assets } = createDemoGenerationAdapters(now);
  return {
    session: createDemoSessionService(authState),
    auth: createDemoAuthService(authState, now),
    catalog: createDemoCatalogService(now),
    content: createDemoContentService(now),
    community: createDemoCommunityService(),
    plans: createDemoPlansService(),
    wallet: createDemoWalletService(now),
    generation,
    gallery,
    assets,
  };
}
