import type { AppServices } from "../../runtime/AppServices";
import { SessionSchema } from "../../runtime/contracts/session";
import type { HttpClient } from "./client";

export function createHttpSessionService(client: HttpClient): AppServices["session"] {
  return {
    getCurrent(options) {
      return client.request("/session", { schema: SessionSchema, signal: options?.signal });
    },
  };
}
