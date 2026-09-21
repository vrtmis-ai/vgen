import type { AppServices } from "../../runtime/AppServices";
import { PlansResponseSchema } from "../../runtime/contracts/plans";
import type { HttpClient } from "./client";

export function createHttpPlansService(client: HttpClient): AppServices["plans"] {
  return {
    async list(options) {
      return client.request("/plans", { schema: PlansResponseSchema, signal: options?.signal });
    },
  };
}
