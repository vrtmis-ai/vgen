import type { NavKey } from "../components/TopBar";

/**
 * The nav destinations, still the single source of truth for their paths.
 *
 * These now mirror files under `app/(nav)/` rather than feeding a router
 * component — TopBar and the layout's active-tab highlight both read them, so
 * the map stays. `VgenBrowserRouter` is gone with react-router; Next resolves
 * routes from the filesystem and there is no `basename` to thread through.
 */
const NAV_PATHS: Record<NavKey, string> = {
  explore: "/explore",
  image: "/studio/image",
  video: "/studio/video",
  audio: "/studio/audio",
  effects: "/effects",
  academy: "/academy",
  gallery: "/gallery",
  community: "/community",
  mcp: "/mcp",
};

export function navPath(key: NavKey): string {
  return NAV_PATHS[key];
}

export function navKeyFromPath(pathname: string): NavKey | null {
  const found = (Object.entries(NAV_PATHS) as [NavKey, string][]).find(([, path]) => path === pathname);
  return found?.[0] ?? null;
}
