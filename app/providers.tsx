"use client";

import { useState, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "../src/lib/i18n";
import type { Lang } from "../src/lib/lang";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { AppServicesProvider } from "../src/runtime/AppServices";
import { ConfigurationError } from "../src/runtime/ConfigurationError";
import { browserEnvironment, resolveRuntime } from "../src/runtime/runtime";

/**
 * Everything that used to sit in main.tsx's createRoot call.
 *
 * index.css carries a prefers-reduced-motion rule, but it only zeroes CSS
 * animations and transitions — it cannot touch framer-motion, which drives its
 * values from JS. Everything that actually moves here is framer-motion: the
 * drifting ambient blobs, the floating logo, the pulsing prompt bar, the hero's
 * slow zoom. A user who asked the OS for less motion was still getting all of
 * it. reducedMotion="user" makes every motion component honour the setting, and
 * still allows opacity fades so transitions do not become instant jump-cuts.
 */
export function Providers({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  // Both of these are per-client, never module scope. On a Node server a
  // module-level QueryClient is one object shared by every concurrent request,
  // so one visitor's cached session and wallet would be handed to the next.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  const [runtime] = useState(() => resolveRuntime(browserEnvironment()));

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <LanguageProvider initialLang={initialLang}>
            {runtime.ready ? (
              <AppServicesProvider services={runtime.services}>{children}</AppServicesProvider>
            ) : (
              <ConfigurationError message={runtime.message} />
            )}
          </LanguageProvider>
        </QueryClientProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}
