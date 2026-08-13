import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "./index.css";
import App from "./App";
import { LanguageProvider } from "./lib/i18n";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppServicesProvider } from "./app/AppServices";
import { ConfigurationError } from "./app/ConfigurationError";
import { resolveRuntime } from "./app/runtime";
import { VgenBrowserRouter } from "./app/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, useAuth, useClerk } from "@clerk/react";

// index.css carries a prefers-reduced-motion rule, but it only zeroes CSS
// animations and transitions — it cannot touch framer-motion, which drives its
// values from JS. Everything that actually moves here is framer-motion: the
// drifting ambient blobs, the floating logo, the pulsing prompt bar, the hero's
// slow zoom. A user who asked the OS for less motion was still getting all of it.
// reducedMotion="user" makes every motion component honour the setting, and
// still allows opacity fades so transitions do not become instant jump-cuts.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function ProductRuntime({
  getAccessToken,
  onSignIn,
  onSignUp,
  onSignOut,
}: {
  getAccessToken?: () => Promise<string | null>;
  onSignIn?: () => void;
  onSignUp?: () => void;
  onSignOut?: () => void;
}) {
  const runtime = resolveRuntime(import.meta.env, getAccessToken);
  if (!runtime.ready) return <ConfigurationError message={runtime.message} />;
  return (
    <AppServicesProvider services={runtime.services}>
      <VgenBrowserRouter>
        <App {...(onSignIn ? { onSignIn } : {})} {...(onSignUp ? { onSignUp } : {})} {...(onSignOut ? { onSignOut } : {})} />
      </VgenBrowserRouter>
    </AppServicesProvider>
  );
}

function ClerkProductRuntime() {
  const { isLoaded, getToken, userId } = useAuth();
  const { openSignIn, openSignUp, signOut } = useClerk();
  useEffect(() => {
    if (userId) void queryClient.invalidateQueries({ queryKey: ["session"] });
  }, [userId]);
  if (!isLoaded) return null;
  return (
    <ProductRuntime
      getAccessToken={getToken}
      onSignIn={() => openSignIn({ withSignUp: true })}
      onSignUp={() => openSignUp()}
      onSignOut={() => void signOut({ redirectUrl: "/" })}
    />
  );
}

function AuthenticatedRuntime() {
  const authProvider = import.meta.env.VITE_AUTH_PROVIDER ?? (import.meta.env.VITE_APP_MODE === "demo" ? "none" : "clerk");
  if (authProvider === "none") return <ProductRuntime />;
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) return <ConfigurationError message="Clerk is not configured. Set VITE_CLERK_PUBLISHABLE_KEY." />;
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <ClerkProductRuntime />
    </ClerkProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <LanguageProvider>
            <AuthenticatedRuntime />
          </LanguageProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
