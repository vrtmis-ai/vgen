import { BrowserRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { NavKey } from "../components/TopBar";

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

export function VgenBrowserRouter({ children }: { children: ReactNode }) {
  return <BrowserRouter basename={import.meta.env.BASE_URL}>{children}</BrowserRouter>;
}
