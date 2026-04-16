import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import path from "path";

const BLOCK_ICON_CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

const blockIconCachePlugin: Plugin = {
  name: "block-icon-cache",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url || "";
      if (url.includes("/block-icons/precomputed/") && url.endsWith(".png")) {
        res.setHeader("Cache-Control", BLOCK_ICON_CACHE_CONTROL);
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url || "";
      if (url.includes("/block-icons/precomputed/") && url.endsWith(".png")) {
        res.setHeader("Cache-Control", BLOCK_ICON_CACHE_CONTROL);
      }
      next();
    });
  },
};

// https://vitejs.dev/config/
export default defineConfig(() => ({
  base: "./",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), blockIconCachePlugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
