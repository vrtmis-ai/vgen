import type { AppServices } from "../../runtime/AppServices";
import { WalletSchema } from "../../runtime/contracts/wallet";
import type { HttpClient } from "./client";

export function createHttpWalletService(client: HttpClient): AppServices["wallet"] {
  return {
    getCurrent(options) {
      return client.request("/wallet", { schema: WalletSchema, signal: options?.signal });
    },
  };
}
