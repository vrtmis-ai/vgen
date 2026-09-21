import type { FastifyInstance } from "fastify";
import type { PlansResponse } from "@vgen/contracts";
import { publicJson } from "../publicJson";

export interface CustomerPlansApplication {
  list(): Promise<PlansResponse>;
}

/**
 * Public on purpose. Someone deciding whether to sign up has to be able to see
 * what a plan costs before they have an account to see it with.
 */
export function registerPlansRoute(app: FastifyInstance, plans: CustomerPlansApplication): void {
  // The repository builds the whole envelope now — the ladder and the day's
  // exchange rate are one document, rebuilt together when either moves — so
  // there is nothing left to shape here, and the memoised bytes are still
  // keyed on the one reference that changes when the document changes.
  const send = publicJson<PlansResponse>();
  app.get("/api/v1/plans", async (_request, reply) => send(reply, await plans.list()));
}
