import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// On GitHub Pages this is served from a sub-path (vrtmis-ai.github.io/vgen/),
// so the production base must match the repo name. Dev stays at "/".
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/vgen/" : "/",
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5180 },
}));
