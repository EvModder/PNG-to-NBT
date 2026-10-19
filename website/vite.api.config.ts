import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--", "website"], { cwd: resolve(root, ".."), encoding: "utf8" }).trim();

// Separate build graph: API entries must never reshape or enlarge the site bundles.
export default defineConfig(({ mode }) => ({
  root: resolve(root, "src/api"),
  base: "./",
  publicDir: false,
  resolve: { alias: { "@": resolve(root, "src") } },
  define: { "import.meta.env.GENERATOR_REVISION": JSON.stringify(revision + (dirty ? "-local" : "")) },
  plugins: mode === "client" ? [{
    name: "api-types",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "api.d.ts", source: readFileSync(resolve(root, "src/api/contract.ts"), "utf8") });
    },
  }] : [],
  build: {
    outDir: resolve(root, mode === "client" ? "dist" : "dist/api"),
    emptyOutDir: mode !== "client",
    // Browsers without native modulepreload still load the imports; skip the extra polyfill request.
    modulePreload: { polyfill: false },
    // The stable client URL must not import hashed chunks removed by a later deploy.
    lib: mode === "client" ? {
      entry: resolve(root, "src/api/client.ts"),
      formats: ["es"],
      fileName: () => "api.js",
    } : undefined,
    rolldownOptions: {
      input: mode === "client" ? undefined : {
        index: resolve(root, "src/api/index.html"),
        bridge: resolve(root, "src/api/bridge.html"),
      },
      preserveEntrySignatures: "strict",
      output: mode === "client" ? { codeSplitting: false } : { entryFileNames: "assets/[name]-[hash].js" },
    },
  },
}));
