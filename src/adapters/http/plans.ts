import type { AppServices } from "../../runtime/AppServices";
import { PlanListSchema } from "../../runtime/contracts/plans";
import type { HttpClient } from "./client";

export function createHttpPlansService(client: HttpClient): AppServices["plans"] {
  return {
    async list(options) {
      const { plans } = await client.request("/plans", { schema: PlanListSchema, signal: options?.signal });
      return plans;
    },
  };
}
