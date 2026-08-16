import type { FastifyInstance } from "fastify";
import type { Plan } from "@vgen/contracts";

export interface CustomerPlansApplication {
  list(): Promise<Plan[]>;
}

/**
 * Public on purpose. Someone deciding whether to sign up has to be able to see
 * what a plan costs before they have an account to see it with.
 */
export function registerPlansRoute(app: FastifyInstance, plans: CustomerPlansApplication): void {
  app.get("/api/v1/plans", async () => ({ plans: await plans.list() }));
}
