"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppLoading } from "./AppLoading";

/**
 * What `<Navigate to={…} replace />` used to do for unresolvable route params.
 *
 * A server `redirect()` cannot decide these: whether a family id or a generation
 * id exists is only knowable from client state (the catalog query and the
 * localStorage-backed generations list), so the decision has to happen after
 * mount.
 */
export function ClientRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return <AppLoading />;
}
