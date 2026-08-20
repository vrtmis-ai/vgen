import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "../../runtime/apiError";
import { browserEnvironment } from "../../runtime/runtime";
import { createAdminApiFor, type AdminApi, type CreateInviteInput, type CreatePromoInput } from "./adminApi";
import type { AdminRouteInput, AdminSessionState } from "../../runtime/contracts/admin";

/**
 * The staff panel's data layer.
 *
 * Two things here are decisions rather than plumbing.
 *
 * **Demo mode has no admin.** There is no fixture that could stand in for one:
 * every call on this surface either reads a real provider credential's name or
 * changes which upstream account a job is billed to, and a fake version of that
 * would be a panel that teaches an operator the wrong thing. The console says
 * so plainly instead.
 *
 * **A 404 is the signed-out state, not an error.** The whole staff surface
 * answers 404 to anyone without a session, deliberately, so its existence is
 * not confirmed to a customer poking at the URL. That means the panel cannot
 * treat 404 as a failure — it is how "you are not signed in" arrives.
 */

export const adminKeys = {
  session: ["admin", "session"] as const,
  providers: ["admin", "providers"] as const,
  models: ["admin", "models"] as const,
  routes: (modelId: string) => ["admin", "routes", modelId] as const,
  invites: ["admin", "invites"] as const,
  promos: ["admin", "promos"] as const,
  earlyAccess: ["admin", "early-access"] as const,
};

export type AdminAvailability = { available: true; api: AdminApi } | { available: false; reason: string };

/**
 * `useState` with an initialiser rather than `useMemo`, matching how
 * `app/providers.tsx` resolves the runtime. Both build one object from
 * environment that cannot change while the tab is open — and `useMemo` is a
 * performance hint the compiler is free to discard, which for a value holding a
 * live HTTP client would mean a new client on some renders.
 */
export function useAdminAvailability(): AdminAvailability {
  const [availability] = useState<AdminAvailability>(() => {
    const environment = browserEnvironment();
    if (environment.APP_MODE === "demo") {
      return {
        available: false,
        reason:
          "پنل مدیریت در حالت دمو کار نمی‌کند. هر کاری در این صفحه یا یک کلید واقعی را می‌خواند یا تعیین می‌کند هزینه‌ی یک جاب روی کدام حساب می‌نشیند؛ نسخه‌ی ساختگی‌اش فقط چیز اشتباهی یاد می‌دهد.",
      };
    }
    if (!environment.API_BASE_URL) {
      return { available: false, reason: "NEXT_PUBLIC_API_BASE_URL تنظیم نشده است." };
    }
    return { available: true, api: createAdminApiFor(environment.API_BASE_URL) };
  });
  return availability;
}

/** The signed-out state, told apart from a real failure. */
export const isSignedOut = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

export function useAdminSession(api: AdminApi | null): UseQueryResult<AdminSessionState | null> {
  return useQuery({
    queryKey: adminKeys.session,
    enabled: api !== null,
    queryFn: async () => {
      try {
        return await api!.getSession();
      } catch (error) {
        // Null, not a throw: there is nothing wrong, the person is signed out.
        if (isSignedOut(error)) return null;
        throw error;
      }
    },
    // No retry. A 404 here is an answer, and retrying it three times just makes
    // the sign-in screen take a second longer to appear.
    retry: false,
    staleTime: 30_000,
  });
}

/** Everything a session may do, as a predicate the sections gate on. */
export function permits(session: AdminSessionState | null | undefined, permission: string): boolean {
  if (!session || session.status !== "authed") return false;
  const [section] = permission.split(".");
  return session.permissions.some((granted) => granted === "*" || granted === permission || granted === `${section}.*`);
}

export function useAdminSignIn(api: AdminApi) {
  const queryClient = useQueryClient();
  return {
    password: useMutation({
      mutationFn: ({ email, password }: { email: string; password: string }) => api.signIn(email, password),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.session }),
    }),
    secondFactor: useMutation({
      mutationFn: (code: string) => api.submitSecondFactor(code),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.session }),
    }),
    signOut: useMutation({
      mutationFn: () => api.signOut(),
      onSuccess: () => {
        // The session is written, not removed. Removing it would leave its
        // mounted observer to refetch its way back to the same null — a round
        // trip to learn what we just did, with a "checking session" flash in
        // the middle and a race over which result lands last.
        queryClient.setQueryData(adminKeys.session, null);
        // Everything else goes. A panel that kept its provider list after
        // sign-out would hand the next person at that desk the credential names
        // and the routing table.
        queryClient.removeQueries({
          queryKey: ["admin"],
          predicate: (query) => query.queryKey[1] !== "session",
        });
      },
    }),
  };
}

export function useProviders(api: AdminApi, enabled: boolean) {
  return useQuery({ queryKey: adminKeys.providers, enabled, queryFn: () => api.listProviders(), retry: false });
}

export function useProviderPatch(api: AdminApi) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { isActive?: boolean; baseUrl?: string | null } }) => api.patchProvider(id, patch),
    // Both: deactivating a provider changes what every model routed to it is
    // serving, and the models list computes that the same way `claim()` does.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.providers });
      await queryClient.invalidateQueries({ queryKey: adminKeys.models });
    },
  });
}

export function useModels(api: AdminApi, enabled: boolean) {
  return useQuery({ queryKey: adminKeys.models, enabled, queryFn: () => api.listModels(), retry: false });
}

export function useRoutes(api: AdminApi, modelId: string | null) {
  return useQuery({
    queryKey: adminKeys.routes(modelId ?? "none"),
    enabled: modelId !== null,
    queryFn: () => api.listRoutes(modelId!),
    retry: false,
  });
}

export function useReplaceRoutes(api: AdminApi) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, routes }: { modelId: string; routes: AdminRouteInput[] }) => api.replaceRoutes(modelId, routes),
    onSuccess: async (_result, { modelId }) => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.routes(modelId) });
      await queryClient.invalidateQueries({ queryKey: adminKeys.models });
    },
  });
}

export function useInvites(api: AdminApi, enabled: boolean) {
  return useQuery({ queryKey: adminKeys.invites, enabled, queryFn: () => api.listInvites(), retry: false });
}

export function useInviteMutations(api: AdminApi) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.invites });
  return {
    create: useMutation({ mutationFn: (input: CreateInviteInput) => api.createInvite(input), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api.removeInvite(id), onSuccess: refresh }),
  };
}

export function usePromos(api: AdminApi, enabled: boolean) {
  return useQuery({ queryKey: adminKeys.promos, enabled, queryFn: () => api.listPromos(), retry: false });
}

export function usePromoMutations(api: AdminApi) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.promos });
  return {
    create: useMutation({ mutationFn: (input: CreatePromoInput) => api.createPromo(input), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api.removePromo(id), onSuccess: refresh }),
  };
}

export function useEarlyAccess(api: AdminApi, enabled: boolean) {
  const queryClient = useQueryClient();
  return {
    query: useQuery({ queryKey: adminKeys.earlyAccess, enabled, queryFn: () => api.getEarlyAccess(), retry: false }),
    set: useMutation({
      mutationFn: (value: boolean) => api.setEarlyAccess(value),
      onSuccess: (value) => queryClient.setQueryData(adminKeys.earlyAccess, value),
    }),
  };
}
