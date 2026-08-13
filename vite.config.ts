import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// On GitHub Pages this is served from a sub-path (vrtmis-ai.github.io/vgen/),
// so the production base must match the repo name. Dev stays at "/".
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/vgen/" : "/",
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("zod")) return "vendor-validation";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("react-router")) return "vendor-router";
          if (id.includes("react-dom") || /node_modules[\\/]react[\\/]/.test(id)) return "vendor-react";
          return undefined;
        },
      },
    },
  },
  // PORT lets the preview harness assign a free port when 5180 is taken.
  server: { host: true, port: Number(process.env.PORT) || 5180 },
}));
