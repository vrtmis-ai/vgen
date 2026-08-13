/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_PROVIDER?: "clerk" | "none";
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_APP_MODE?: "demo" | "production";
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
