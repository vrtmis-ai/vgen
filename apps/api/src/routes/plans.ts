import type { FastifyInstance } from "fastify";
import type { Plan } from "@vgen/contracts";
import { publicJson } from "../publicJson";

export interface CustomerPlansApplication {
  list(): Promise<Plan[]>;
}

/**
 * Public on purpose. Someone deciding whether to sign up has to be able to see
 * what a plan costs before they have an account to see it with.
 */
export function registerPlansRoute(app: FastifyInstance, plans: CustomerPlansApplication): void {
  // The memoised value is the list; the envelope around it is shaped here, so
  // the cache is still keyed on the one reference that changes when it changes.
  const send = publicJson<Plan[]>((list) => ({ plans: list }));
  app.get("/api/v1/plans", async (_request, reply) => send(reply, await plans.list()));
}
