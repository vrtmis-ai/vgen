import type { AppServices } from "./AppServices";
import { createDemoServices } from "../adapters/demo/demoServices";
import { createHttpServices } from "../adapters/http/httpServices";

export type RuntimeResolution = { ready: true; services: AppServices } | { ready: false; message: string };

export interface RuntimeEnvironment {
  VITE_APP_MODE?: string | undefined;
  VITE_API_BASE_URL?: string | undefined;
}

export function resolveRuntime(environment: RuntimeEnvironment, getAccessToken?: () => Promise<string | null>): RuntimeResolution {
  if (environment.VITE_APP_MODE === "demo") return { ready: true, services: createDemoServices() };
  if (!environment.VITE_API_BASE_URL) {
    return {
      ready: false,
      message: "DEEV production services are not configured. Set VITE_API_BASE_URL or use VITE_APP_MODE=demo for local development.",
    };
  }
  return { ready: true, services: createHttpServices(environment.VITE_API_BASE_URL, getAccessToken) };
}
