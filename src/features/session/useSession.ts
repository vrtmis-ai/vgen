import { useQuery } from "@tanstack/react-query";
import { useAppServices } from "../../runtime/AppServices";

export const appQueryKeys = {
  session: ["session"] as const,
  catalog: ["catalog"] as const,
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

export function useWallet(enabled: boolean) {
  const services = useAppServices();
  return useQuery({
    queryKey: appQueryKeys.wallet,
    queryFn: ({ signal }) => services.wallet.getCurrent({ signal }),
    enabled,
    staleTime: 15_000,
  });
}
