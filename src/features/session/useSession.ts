import { useQuery } from "@tanstack/react-query";
import { useAppServices } from "../../runtime/AppServices";

export const appQueryKeys = {
  session: ["session"] as const,
  catalog: ["catalog"] as const,
  plans: ["plans"] as const,
  wallet: ["wallet"] as const,
};

export function useSession() {
  const services = useAppServices();
  return useQuery({
    queryKey: appQueryKeys.session,
    queryFn: ({ signal }) => services.session.getCurrent({ signal }),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCatalog(enabled: boolean) {
  const services = useAppServices();
  return useQuery({
    queryKey: appQueryKeys.catalog,
    queryFn: ({ signal }) => services.catalog.list({ signal }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * The plan ladder. Unconditional, unlike the catalogue and the wallet.
 *
 * `GET /plans` is public, and the landing page prices two plans while the
 * visitor is still anonymous — gating this behind a session would leave the one
 * screen that has to sell a plan unable to name its price. Long stale time
 * because a ladder changes when someone repricing it says so, not on a timer.
 */
export function usePlans() {
  const services = useAppServices();
  return useQuery({
    queryKey: appQueryKeys.plans,
    queryFn: ({ signal }) => services.plans.list({ signal }),
    staleTime: 10 * 60_000,
  });
}

export function useWallet(enabled: boolean) {
  const services = useAppServices();
  return useQuery({
    queryKey: appQueryKeys.wallet,
    queryFn: ({ signal }) => services.wallet.getCurrent({ signal }),
    enabled,
    staleTime: 15_000,
  });
}
