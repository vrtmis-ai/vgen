import type { FastifyInstance } from "fastify";
import type { CustomerWallet } from "@vgen/db";
import type { CustomerSessionApplication } from "./session";

export interface CustomerWalletApplication {
  getCurrent(userId: string): Promise<CustomerWallet>;
}

export function registerWalletRoute(app: FastifyInstance, sessions: CustomerSessionApplication, wallets: CustomerWalletApplication): void {
  app.get("/api/v1/wallet", async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }
    return wallets.getCurrent(session.user.id);
  });
}
