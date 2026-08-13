import type { AppServices } from "../../app/AppServices";
import { createDemoCatalogService } from "./catalog";
import { createDemoGenerationAdapters } from "./generation";
import { createDemoSessionService } from "./session";
import { createDemoWalletService } from "./wallet";

export interface DemoServiceOptions {
  now?: (() => number) | undefined;
}

export function createDemoServices(options: DemoServiceOptions = {}): AppServices {
  const now = options.now ?? Date.now;
  const { generation, gallery } = createDemoGenerationAdapters(now);
  return {
    session: createDemoSessionService(),
    catalog: createDemoCatalogService(now),
    wallet: createDemoWalletService(now),
    generation,
    gallery,
  };
}
