import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(server.resolvedUrls.local[0]);
      const results = await page.evaluate(async () => {
        const { analyzeBaseGeometry, analyzeFinalGeometry } = await import("/src/lib/tileGeometry.ts");
        const { computeColorGridStats } = await import("/src/lib/colorGridAnalysis.ts");
        const { BuildMode, SuppressStepDirection } = await import("/src/types/conversion.ts");
        const worker = new Worker(new URL("/src/lib/tileGeometry.worker.ts", location.href), { type: "module" });
        let checked = 0;
        // Include maps/sets in the comparison; JSON alone would silently omit them.
        const serialize = value => JSON.stringify(value, (_, item) => item instanceof Map || item instanceof Set ? [...item] : item);
        const check = async (input, type, tileCacheKey) => {
          const actual = await new Promise((resolve, reject) => {
            worker.onerror = event => reject(new Error(event.message));
            worker.onmessageerror = () => reject(new Error("Unreadable geometry response"));
            worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.result);
            worker.postMessage({ id: checked, type, tileCacheKey, input });
          });
          const analyze = type === "base" ? analyzeBaseGeometry : analyzeFinalGeometry;
          if (serialize(actual) !== serialize(analyze(structuredClone(input)))) {
            throw new Error(`Geometry mismatch: ${tileCacheKey}, ${type}, ${input.buildMode}, request ${checked}`);
          }
          ++checked;
        };
        try {
          for (let i = 0; i < 8; ++i) {
            const color = i < 6 ? 11 : 12;
            const input = {
              colorGrid: Array.from({ length: 128 }, (_, x) => Array.from({ length: 128 }, (_, z) => ({ id: color, isCustom: false, shade: (x + z) % 3 }))),
              hasWater: false, hasTransparency: false, requiresTwoLayerLateShading: false, includeTransparentBlocks: false,
              buildAtWorldMinY: false, buildMode: BuildMode.SuppressStepChecker, isFlatShape: false,
              layerGap: 5, suppress2LayerLatePairY: 6, useCrubTech: false, mixSteps: true, mixedStepMaxHeight: 1,
              paletteSeed: 0, enableWaterConvenience: true, skipEmptySuppressSteps: true,
              minSuppressStepOffset: 1 + i % 3, uniformSuppressStepSpacing: i % 2 === 0, keepSuppressExtras: false,
              collapseStaircaseModes: false, includeFlatNorthline: false, selectedStepDirection: SuppressStepDirection.EastToWest,
              suppressCenterOut: i === 5,
            };
            await check(input, "final", String(color));
          }
          for (const kind of ["land", "water", "custom"]) {
            const colorGrid = Array.from({ length: 128 }, (_, x) => Array.from({ length: 128 }, (_, z) => ({
              id: x >= 12 || z >= 12 ? 0 : kind === "water" && x % 3 === 0 ? 12 : kind === "custom" ? 1 : 11,
              isCustom: kind === "custom" && x < 12 && z < 12,
              shade: (x + z) % 3,
            })));
            for (const buildMode of Object.values(BuildMode)) {
              if (kind === "water" && (buildMode === BuildMode.InclineUp || buildMode === BuildMode.InclineDown)) continue;
              const shade = buildMode === BuildMode.InclineUp ? 0 : buildMode === BuildMode.InclineDown ? 2 : buildMode === BuildMode.Flat ? 1 : undefined;
              const grid = shade === undefined ? colorGrid : colorGrid.map(column => column.map(color => ({ ...color, shade })));
              const stats = computeColorGridStats(grid);
              const key = `${kind}:${shade ?? "mixed"}`;
              const input = {
                colorGrid: grid, allSameShade: stats.allSameShade, flatModeBehavior: stats.flatModeBehavior,
                hasWater: kind === "water", hasTransparency: true, requiresTwoLayerLateShading: buildMode.includes("late"),
                includeTransparentBlocks: true, waterSetting: { kind: "below-platform", drops: [3, 2, 1] },
                buildAtWorldMinY: false, buildMode, isFlatShape: false, layerGap: 5, suppress2LayerLatePairY: 6,
                useCrubTech: false, mixSteps: false, mixedStepMaxHeight: 0, paletteSeed: 0, enableWaterConvenience: true,
                skipEmptySuppressSteps: true, minSuppressStepOffset: 1, uniformSuppressStepSpacing: true,
                keepSuppressExtras: false, collapseStaircaseModes: false, includeFlatNorthline: false,
                selectedStepDirection: SuppressStepDirection.EastToWest, suppressCenterOut: false,
              };
              await check(input, "base", key);
              for (let variant = 0; variant < 4; ++variant) {
                await check({ ...input, layerGap: 3 + variant, suppress2LayerLatePairY: 9 + variant,
                  paletteSeed: variant, enableWaterConvenience: variant % 2 === 0,
                  waterSetting: variant % 2 ? { kind: "top-aligned" } : input.waterSetting,
                  includeTransparentBlocks: variant % 2 === 0, buildAtWorldMinY: variant === 1,
                  useCrubTech: variant === 2, mixSteps: variant === 3, mixedStepMaxHeight: variant === 3 ? 1 : 0,
                  skipEmptySuppressSteps: variant !== 1, minSuppressStepOffset: 1 + variant,
                  uniformSuppressStepSpacing: variant % 2 === 0, keepSuppressExtras: variant === 1,
                  selectedStepDirection: Object.values(SuppressStepDirection)[variant], suppressCenterOut: variant === 3,
                }, "final", key);
              }
            }
          }
        }
        finally { worker.terminate(); }
        return checked;
      });
      assert.equal(results, 8 + (3 * 16 - 2) * 5);
      console.log(`${name}: ${results} cached-worker/fresh comparisons passed across modes, base/final interleaving, water, transparency, custom colors, directions, spacing and eviction.`);
    }
    finally { await browser.close(); }
  }
}
finally { await server.close(); }
