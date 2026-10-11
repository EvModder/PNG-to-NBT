import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{
            debugName: "dependencies",
            name(id) {
              if (!id.includes("/node_modules/")) return null;
              if (id.includes("/react/") || id.includes("/react-dom/")) return "react";
              if (id.includes("/lucide-react/")) return "icons";
              if (id.includes("/utif/")) return "tiff";
              return "vendor";
            },
          }],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
});
