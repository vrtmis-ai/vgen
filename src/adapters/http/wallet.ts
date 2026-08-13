import type { AppServices } from "../../app/AppServices";
import { WalletSchema } from "../../app/contracts/wallet";
import type { HttpClient } from "./client";

export function createHttpWalletService(client: HttpClient): AppServices["wallet"] {
  return {
    getCurrent(options) {
      return client.request("/wallet", { schema: WalletSchema, signal: options?.signal });
    },
  };
}
