import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const BLOCK_ICON_CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

const blockIconCachePlugin = {
  name: "block-icon-cache",
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      const url = req.url || "";
      if (url.includes("/block-icons/precomputed/") && url.endsWith(".png")) {
        res.setHeader("Cache-Control", BLOCK_ICON_CACHE_CONTROL);
      }
      next();
    });
  },
  configurePreviewServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
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
