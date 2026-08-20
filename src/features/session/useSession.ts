import { useQuery } from "@tanstack/react-query";
import { useAppServices } from "../../runtime/AppServices";

export const appQueryKeys = {
  session: ["session"] as const,
  catalog: ["catalog"] as const,
  content: ["content"] as const,
  community: ["community"] as const,
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

/**
 * The editorial content: presets, fragments, skills, the featured shelf,
 * courses, examples and voices.
 *
 * Unconditional, like the plan ladder and unlike the catalogue. The landing
 * page is not just plans and model names — its feature bento renders nine
 * effects, three courses and three voices to a visitor who has no session yet,
 * so gating this on `authed` would leave a signed-out landing page with three
 * empty panels on it.
 */
export function useContent() {
  const services = useAppServices();
  return useQuery({
    queryKey: appQueryKeys.content,
    queryFn: ({ signal }) => services.content.list({ signal }),
    staleTime: 5 * 60_000,
  });
}

/**
 * The community feed. Fetched by the two screens that show it rather than
 * handed down a provider: unlike the catalogue and the content, it is not
 * needed by anything between the shell and those screens, and it is the one
 * payload here that will grow — a real feed is paginated, and a provider that
 * holds the whole thing is the wrong shape to grow into.
 */
export function useCommunityFeed() {
  const services = useAppServices();
  return useQuery({
    queryKey: appQueryKeys.community,
    queryFn: ({ signal }) => services.community.list({ signal }),
    staleTime: 60_000,
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
