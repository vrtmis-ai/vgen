import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "../../runtime/apiError";
import { browserEnvironment } from "../../runtime/runtime";
import {
  createAdminApiFor,
  type AdminApi,
  type AdminBan,
  type AdminUsersQuery,
  type AnalyticsWindow,
  type CreateInviteInput,
  type CreatePromoInput,
} from "./adminApi";
import type { AdminProviderCreate, AdminRouteInput, AdminServingModelCreate, AdminSessionState } from "../../runtime/contracts/admin";

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
  overview: (window: AnalyticsWindow) => ["admin", "analytics", "overview", window] as const,
  modelMargin: (window: AnalyticsWindow) => ["admin", "analytics", "models", window] as const,
  providerHealth: (window: AnalyticsWindow) => ["admin", "analytics", "providers", window] as const,
  users: (query: AdminUsersQuery) => ["admin", "users", query] as const,
  user: (id: string) => ["admin", "user", id] as const,
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
    mutationFn: ({ id, patch }: { id: string; patch: { isActive?: boolean; baseUrl?: string | null; name?: string } }) =>
      api.patchProvider(id, patch),
    // Both: deactivating a provider changes what every model routed to it is
    // serving, and the models list computes that the same way `claim()` does.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.providers });
      await queryClient.invalidateQueries({ queryKey: adminKeys.models });
    },
  });
}

/**
 * Both lists, because a new provider is also a new place to route to and the
 * models query is what carries `servingModels`.
 */
export function useProviderCreate(api: AdminApi) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminProviderCreate) => api.createProvider(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.providers });
      await queryClient.invalidateQueries({ queryKey: adminKeys.models });
    },
  });
}

export function useServingModelCreate(api: AdminApi) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminServingModelCreate) => api.createServingModel(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.models }),
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

/**
 * The one-click move.
 *
 * Invalidates the routes for the model AND the models list, because the list's
 * "running on" column is the thing this changed — leaving it stale would show
 * an admin the old provider immediately after they moved off it, which is the
 * one moment they are most likely to believe it.
 */
export function useRouteTo(api: AdminApi) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, servingModelId }: { modelId: string; servingModelId: string }) => api.routeTo(modelId, servingModelId),
    onSuccess: async (_result, { modelId }) => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.routes(modelId) });
      await queryClient.invalidateQueries({ queryKey: adminKeys.models });
    },
  });
}

/** Back to the provider that owns the catalogue row. Not a delete of anything a customer sees. */
export function useClearRoutes(api: AdminApi) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => api.clearRoutes(modelId),
    onSuccess: async (_result, modelId) => {
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

// ---------------------------------------------------------------- analytics

/**
 * The window is part of the key, not a parameter to one query.
 *
 * Switching from 30d to today then back is then instant and offline, which
 * matters because comparing two windows is the actual thing an operator does
 * with this screen — and a refetch on every toggle would make that a
 * three-second habit instead of a free one.
 */
export function useOverview(api: AdminApi, window: AnalyticsWindow, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.overview(window),
    enabled,
    queryFn: () => api.getOverview(window),
    retry: false,
    staleTime: 60_000,
  });
}

export function useModelMargin(api: AdminApi, window: AnalyticsWindow, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.modelMargin(window),
    enabled,
    queryFn: () => api.listModelMargin(window),
    retry: false,
    staleTime: 60_000,
  });
}

export function useProviderHealth(api: AdminApi, window: AnalyticsWindow, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.providerHealth(window),
    enabled,
    queryFn: () => api.listProviderHealth(window),
    retry: false,
    staleTime: 60_000,
  });
}

export function useUsers(api: AdminApi, query: AdminUsersQuery, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.users(query),
    enabled,
    queryFn: () => api.listUsers(query),
    retry: false,
    // The list is a table someone is typing into. Keeping the previous page
    // visible while the next one loads stops every keystroke blanking it.
    placeholderData: (previous) => previous,
  });
}

export function useUser(api: AdminApi, id: string | null) {
  return useQuery({ queryKey: adminKeys.user(id ?? "none"), enabled: id !== null, queryFn: () => api.getUser(id!), retry: false });
}

/**
 * Everything that changes one customer.
 *
 * All four invalidate the user AND the list: a grant moves a balance the list
 * shows, and a ban moves a count it shows. Refreshing only the open drawer
 * would leave the row behind it contradicting the drawer in front of it.
 */
export function useUserActions(api: AdminApi, userId: string) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) });
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  };
  return {
    adjustCredits: useMutation({
      mutationFn: (input: { coins: number; note: string }) => api.adjustCredits(userId, input),
      onSuccess: refresh,
    }),
    ban: useMutation({
      mutationFn: (input: { scope: AdminBan["scope"]; reason?: string; expiresAt?: string }) => api.banUser(userId, input),
      onSuccess: refresh,
    }),
    liftBan: useMutation({ mutationFn: (banId: string) => api.liftBan(userId, banId), onSuccess: refresh }),
    revokeSessions: useMutation({ mutationFn: () => api.revokeUserSessions(userId), onSuccess: refresh }),
  };
}
