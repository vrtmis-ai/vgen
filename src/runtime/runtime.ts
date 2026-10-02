import type { AppServices } from "./AppServices";
import { createDemoServices } from "../adapters/demo/demoServices";
import { createHttpServices } from "../adapters/http/httpServices";

export type RuntimeResolution = { ready: true; services: AppServices } | { ready: false; message: string };

export interface RuntimeEnvironment {
  APP_MODE?: string | undefined;
  API_BASE_URL?: string | undefined;
  /** Demo mode only: start signed out, so sign-in screens are reachable. */
  DEMO_ANONYMOUS?: string | undefined;
}

/**
 * The one place that reads browser configuration.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` only for literal member expressions.
 * Passing `process.env` around as an object — which is what this used to do with
 * Vite's `import.meta.env` — hands the browser an empty object and silently
 * drops the app into the "not configured" branch. Each key is spelled out here
 * so the substitution can actually happen, and everything downstream takes the
 * resolved values instead of reaching for the environment itself.
 */
export function browserEnvironment(): RuntimeEnvironment {
  return {
    APP_MODE: process.env.NEXT_PUBLIC_APP_MODE,
    API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    DEMO_ANONYMOUS: process.env.NEXT_PUBLIC_DEMO_ANONYMOUS,
  };
}

export function resolveRuntime(environment: RuntimeEnvironment, getAccessToken?: () => Promise<string | null>): RuntimeResolution {
  if (environment.APP_MODE === "demo") {
    return { ready: true, services: createDemoServices({ startAnonymous: environment.DEMO_ANONYMOUS === "1" }) };
  }
  if (!environment.API_BASE_URL) {
    return {
      ready: false,
      message:
        "DEEV production services are not configured. Set NEXT_PUBLIC_API_BASE_URL or use NEXT_PUBLIC_APP_MODE=demo for local development.",
    };
  }
  return { ready: true, services: createHttpServices(environment.API_BASE_URL, getAccessToken) };
}
