import type { AppServices } from "../../app/AppServices";
import { SessionSchema } from "../../app/contracts/session";
import type { HttpClient } from "./client";

export function createHttpSessionService(client: HttpClient): AppServices["session"] {
  return {
    getCurrent(options) {
      return client.request("/session", { schema: SessionSchema, signal: options?.signal });
    },
  };
}
