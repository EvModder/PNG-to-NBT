import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, firefox, webkit } from "playwright";

const engines = { chromium, firefox, webkit };
const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
try {
  for (const name of (process.env.BROWSERS ?? "chromium,webkit").split(",")) {
    const browser = await engines[name].launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(server.resolvedUrls.local[0]);
      const result = await page.evaluate(async () => {
        const { getTileBaseGeometry } = await import("/src/lib/tileGeometryWorkerClient.ts");
        const { analyzeBaseGeometry } = await import("/src/lib/tileGeometry.ts");
        const { convertImageToColorGridSetAsync, convertImageToColorGridSet } = await import("/src/lib/colorGridParsing.ts");
        const { FlatModeBehavior } = await import("/src/lib/colorGridAnalysis.ts");
        const NativeWorker = Worker;
        let sent = 0, terminated = 0;
        window.Worker = class extends NativeWorker {
          postMessage(...args) { ++sent; return super.postMessage(...args); }
          terminate() { ++terminated; return super.terminate(); }
        };
        const input = {
          colorGrid: Array.from({ length: 128 }, (_, x) => Array.from({ length: 128 }, (_, z) => ({ id: 11, isCustom: false, shade: (x + z) % 3 }))),
          hasWater: false, hasTransparency: false, includeTransparentBlocks: false,
          flatModeBehavior: FlatModeBehavior.None, layerGap: 5, paletteSeed: 0, enableWaterConvenience: true,
        };
        const serialize = value => JSON.stringify(value, (_, item) => item instanceof Map || item instanceof Set ? [...item] : item);
        const expected = serialize(analyzeBaseGeometry(input));
        for (let cycle = 0; cycle < 4; ++cycle) {
          const controller = new AbortController();
          const before = sent;
          const work = Promise.allSettled(Array.from({ length: 64 }, (_, i) =>
            getTileBaseGeometry(`${cycle}:${i}`, input, () => {}, controller.signal)));
          if (sent - before > 4) throw new Error("Queued geometry was copied into busy workers");
          await new Promise(resolve => setTimeout(resolve, 20));
          const beforeAbort = sent;
          controller.abort();
          const results = await work;
          if (sent !== beforeAbort) throw new Error("Cancelling an operation started more of its queued jobs");
          if (!results.some(result => result.status === "rejected")) throw new Error("Interrupted work was not cancelled");
          const actual = await getTileBaseGeometry(`recovery:${cycle}`, input, () => {});
          if (serialize(actual) !== expected) throw new Error("Recovered geometry differs from fresh generation");
        }
        const image = new ImageData(512, 512);
        for (let i = 0; i < image.data.length; i += 4) image.data.set([112, 112, 112, 255], i);
        const controller = new AbortController();
        const parse = convertImageToColorGridSetAsync(image, [], false, "reject", undefined, undefined, controller.signal);
        controller.abort();
        try { await parse; throw new Error("Aborted parsing unexpectedly fell back to the main thread"); }
        catch (error) { if (error.name !== "AbortError") throw error; }
        const parsed = await convertImageToColorGridSetAsync(image, []);
        const fresh = convertImageToColorGridSet(image, []);
        if (serialize(parsed) !== serialize(fresh)) throw new Error("Recovered parsing differs from synchronous parsing");
        if (image.data.length !== 512 * 512 * 4) throw new Error("Source image was detached");
        return { sent, terminated, tiles: parsed.tiles.length };
      });
      assert.equal(result.tiles, 16);
      assert(result.terminated > 0);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Color → Block", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log(`${name}: interrupted 64-tile jobs, parsing cancellation, recovery, exact geometry and reload passed.`);
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
