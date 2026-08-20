"use client";

import { useRouter } from "next/navigation";
import { SystemState } from "../src/components/SystemState";
import { navPath } from "../src/runtime/router";

/**
 * Unmatched routes.
 *
 * App.tsx decided this with an `isKnownProductPath` allowlist it had to keep in
 * sync with the router by hand. Next matches against the file tree, so the
 * allowlist is gone and this cannot drift.
 *
 * It renders above the session gate, so `goBack` is not available here — the
 * router's own history is used instead.
 */
export default function NotFound() {
  const router = useRouter();
  return <SystemState kind="not-found" onPrimary={() => router.replace(navPath("video"))} onSecondary={() => router.back()} />;
}
