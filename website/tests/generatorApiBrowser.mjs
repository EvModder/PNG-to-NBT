// Run after build. Serves two origins and a project subpath, matching Pages embedding.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { gunzipSync } from "node:zlib";
import { chromium, webkit } from "playwright";

const dist = resolve(import.meta.dirname, "../dist");
const contract = await readFile(resolve(import.meta.dirname, "../src/api/contract.ts"), "utf8");
assert.equal(await readFile(resolve(dist, "api.d.ts"), "utf8"), contract, "Published declarations must match the contract");
const optionNames = [...contract.split("export interface GenerationOptions {")[1].split("\n}")[0]
  .matchAll(/^  (\w+)\?:/gm)].map(match => match[1]).sort();
const mime = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png" };
const host = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const relative = pathname.replace(/^\/PNG-to-NBT\//, "") || "index.html";
  const file = resolve(dist, relative.endsWith("/") ? `${relative}index.html` : relative);
  if (!file.startsWith(`${dist}/`)) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Access-Control-Allow-Origin": "*" }).end(bytes);
  } catch { response.writeHead(404).end(); }
});
const caller = createServer((_, response) => response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>API integration test</title>"));
await new Promise(resolve => host.listen(0, "127.0.0.1", resolve));
await new Promise(resolve => caller.listen(0, "127.0.0.1", resolve));
const apiOrigin = `http://127.0.0.1:${host.address().port}`;
const callerOrigin = `http://127.0.0.1:${caller.address().port}`;

try {
  for (const name of (process.env.BROWSERS ?? "chromium,webkit").split(",")) {
    const engine = { chromium, webkit }[name];
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      const downloads = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => downloads.push(request.url()));
      await page.goto(callerOrigin);
      const report = await page.evaluate(async apiOrigin => {
        const { connect } = await import(`${apiOrigin}/PNG-to-NBT/api.js`);
        const api = await connect();
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        assert(api.protocolVersion === 1 && api.minecraftVersions.includes("26.2"), "Invalid handshake");
        assert(/^[0-9a-f]{40}(?:-local)?$/.test(api.engineRevision), `Invalid revision: ${api.engineRevision}`);
        // A view of a larger backing buffer must remain intact and must not leak unrelated bytes.
        const backing = new Uint8Array(20000).fill(99);
        const colors = backing.subarray(1000, 17384);
        colors.fill(45);
        const input = { colors, blocks: { 11: "stone" }, options: { mode: "suppress_step_checker" } };
        const first = await api.generateTile(input);
        assert(first.files[0].data[0] === 31 && first.files[0].data[1] === 139, "Not gzip NBT");
        assert(backing.length === 20000 && backing[0] === 99 && colors[0] === 45, "Input mutated/detached");
        const order = [];
        const queuedInput = { colors: new Uint8Array(colors), blocks: { 11: "stone" },
          options: { mode: "suppress_step_checker", waterDrops: [4, 2, 0] } };
        const jobs = [
          api.generateTile(input).then(result => { order.push(0); return result; }),
          api.generateTile({ ...input, options: { unknown: true } }).then(() => { throw new Error("Bad input accepted"); }, error => {
            assert(error.code === "INVALID_INPUT", "Lost validation code"); order.push(1);
          }),
          api.generateTile(queuedInput).then(result => { order.push(2); return result; }),
          api.generateTile(input).then(result => { order.push(3); return result; }),
        ];
        queuedInput.colors.fill(255); queuedInput.blocks[11] = "invalid";
        queuedInput.options.mode = "invalid"; queuedInput.options.waterDrops[0] = -1;
        const results = await Promise.all(jobs);
        assert(order.join() === "0,1,2,3", "Queue did not settle in submission order");
        assert(results[2].files[0].name === "tile.nbt", "Unexpected output filename");
        const recovered = results[3];
        const unpack = async data => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
        const a = await unpack(first.files[0].data), b = await unpack(recovered.files[0].data);
        assert(a.length === b.length && a.every((byte, i) => byte === b[i]), "Queue changed output");
        const queuedBytes = await unpack(results[2].files[0].data);
        assert(a.length === queuedBytes.length && a.every((byte, i) => byte === queuedBytes[i]), "Queued inputs mutated");
        const failedClone = api.generateTile({ ...input, blocks: { 11: () => "stone" } });
        await failedClone.then(() => { throw new Error("Uncloneable input accepted"); }, error => assert(error.name === "DataCloneError", "Wrong clone error"));
        await api.generateTile(input);
        const interrupted = Promise.allSettled([api.generateTile(input), api.generateTile(input), api.generateTile(input)]);
        api.dispose();
        api.dispose();
        assert((await interrupted).every(result => result.status === "rejected" && result.reason.code === "DISPOSED"), "Dispose must reject active and queued calls");
        await api.generateTile(input).then(() => { throw new Error("Disposed connection accepted request"); }, error => assert(error.code === "DISPOSED", "Missing disposed error"));
        assert(document.querySelectorAll("iframe").length === 0, "Iframe leaked");
        const next = await connect();
        next.dispose();
        return { compressedBytes: first.files[0].data.length, nbtBytes: a.length };
      }, apiOrigin);
      assert(!downloads.some(url => /react|icons|\.png|tiff|tileParsing/.test(url)), "API fetched UI/image assets");
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(apiOrigin => new Promise(resolve => {
        const iframe = Object.assign(document.createElement("iframe"), { hidden: true, src: `${apiOrigin}/PNG-to-NBT/api/bridge.html` });
        const { port1, port2 } = new MessageChannel();
        const finish = code => { iframe.remove(); resolve(code); };
        port1.onmessage = event => finish(event.data.code);
        iframe.onload = () => iframe.contentWindow.postMessage({ type: "png-to-nbt:connect", protocolVersion: 999 }, apiOrigin, [port2]);
        setTimeout(finish, 5000, "no reply");
        document.documentElement.append(iframe);
      }), apiOrigin), "PROTOCOL_MISMATCH", "A client from another interface version must be refused at once");

      await page.route("**/api/bridge.html", route => route.fulfill({ status: 404, body: "Unavailable" }));
      await page.clock.install();
      await page.evaluate(async apiOrigin => {
        const { connect } = await import(`${apiOrigin}/PNG-to-NBT/api.js`);
        window.connectionAttempt = connect().then(() => false,
          error => error.code === "CONNECTION_TIMEOUT" && !document.querySelector("iframe"));
      }, apiOrigin);
      await page.clock.fastForward(30_001);
      assert.equal(await page.evaluate(() => window.connectionAttempt), true, "Failed connections must clean up");
      await page.clock.resume();
      await page.unroute("**/api/bridge.html");

      // Worker construction and transfer can fail synchronously, not just through onerror.
      for (const failure of ["startup", "send", "restart", "crash"]) {
        const isolated = await browser.newContext();
        let timer;
        try {
          await isolated.addInitScript(failure => {
            if (window.parent === window) return;
            const NativeWorker = window.Worker;
            let starts = 0, sends = 0;
            window.Worker = class extends NativeWorker {
              constructor(...args) {
                ++starts;
                if ((failure === "startup" && starts === 1) || (failure === "restart" && starts === 2)) {
                  throw new DOMException("Worker blocked", "SecurityError");
                }
                super(...args);
              }
              postMessage(...args) {
                if (++sends === 1) {
                  if (failure === "crash") {
                    queueMicrotask(() => this.dispatchEvent(new ErrorEvent("error", { cancelable: true })));
                    return;
                  }
                  throw new DOMException("Transfer failed", "DataCloneError");
                }
                return super.postMessage(...args);
              }
            };
          }, failure);
          const target = await isolated.newPage();
          await target.goto(callerOrigin);
          const result = await Promise.race([target.evaluate(async ({ apiOrigin, failure }) => {
            const { connect } = await import(`${apiOrigin}/PNG-to-NBT/api.js`);
            if (failure === "startup") {
              return connect().then(api => { api.dispose(); return false; },
                error => error.code === "WORKER_FAILED" && !document.querySelector("iframe"));
            }
            const api = await connect();
            try {
              const input = { colors: new Uint8Array(16384).fill(45), blocks: { 11: "stone" } };
              const results = await Promise.allSettled([api.generateTile(input), api.generateTile(input), api.generateTile(input)]);
              const failures = failure === "restart" ? 2 : 1;
              return results.every((result, index) => index < failures
                ? result.status === "rejected" && result.reason.code === "WORKER_FAILED"
                : result.status === "fulfilled" && result.value.files[0].data[0] === 31);
            }
            finally { api.dispose(); }
          }, { apiOrigin, failure }), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${name}: ${failure} left a request unsettled`)), 30_000);
          })]);
          assert.equal(result, true, `${name}: ${failure} must reject affected calls and recover the queue`);
        }
        finally { clearTimeout(timer); await isolated.close(); }
      }

      downloads.length = 0;
      await page.goto(`${apiOrigin}/PNG-to-NBT/`);
      await page.waitForFunction(() => document.querySelector('input[type="file"]') !== null);
      assert(!downloads.some(url => /\/api(?:\/|\.js)/.test(url)), "Normal site fetched API assets");
      const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
        const context = canvas.getContext("2d"), pixels = context.createImageData(128, 128);
        for (let z = 0; z < 128; ++z) for (let x = 0; x < 128; ++x) {
          const i = (z * 128 + x) * 4, v = Math.floor(112 * [180, 220, 255][(x + z) % 3] / 255);
          pixels.data.set([v, v, v, 255], i);
        }
        context.putImageData(pixels, 0, 0);
        const varied = canvas.toDataURL().split(",")[1];
        context.fillStyle = "rgb(96,96,96)";
        context.fillRect(0, 0, 128, 128);
        return { varied, flat: canvas.toDataURL().split(",")[1] };
      });
      for (const settings of [
        { mode: "flat", support: "all", supportBlock: "sand" },
        { mode: "flat", support: "all", supportBlock: "scaffolding" },
        { mode: "flat", support: "none" },
        { mode: "staircase_party", partyMinHeight: false, support: "all" },
        { mode: "staircase_party", partyMinHeight: true, support: "all" },
        { mode: "suppress_step_checker" },
        { mode: "staircase_northline", westEastSlope: { run: 1, rise: 1 } },
        { mode: "staircase_northline", westEastSlope: { run: 127, rise: -2 } },
        { mode: "suppress_step_checker", centerOut: true, direction: "north_to_south" },
        { mode: "suppress_step_pairs", keepExtras: true },
        { mode: "suppress_2layer", direction: "south_to_north" },
        { mode: "suppress_2layer", crubTech: true, support: "all" },
      ]) {
        await page.evaluate(settings => {
          localStorage.clear();
          for (const [key, value] of Object.entries({ mapart_build_mode: settings.mode,
            mapart_suppress_center_out: settings.centerOut ?? false, mapart_suppress_step_direction: settings.direction ?? "east_to_west",
            mapart_keep_suppress_extras: settings.keepExtras ?? false, mapart_crubtech: settings.crubTech ?? false,
            mapart_party_min_height: settings.partyMinHeight ?? false,
            mapart_support_mode: settings.support ?? "none", mapart_support_filler: settings.supportBlock ?? "cobblestone",
            mapart_secret_apply_support_floor_ys: true })) localStorage.setItem(key, JSON.stringify(value));
        }, settings);
        await page.reload();
        await page.locator('input[type="file"]').setInputFiles({ name: "api-test.png", mimeType: "image/png", buffer: Buffer.from(settings.mode === "flat" ? png.flat : png.varied, "base64") });
        const button = page.getByRole("button", { name: /^Generate/ }).first();
        await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => /^Generate/.test(button.innerText.trim()) && !button.disabled));
        if (settings.mode !== "flat") {
          const modes = await page.locator("select").evaluateAll(elements => elements.map(element => element.value));
          assert(modes.includes(settings.mode), `UI selected a different mode: ${modes}`);
        }
        if (settings.mode === "staircase_party") {
          await page.getByTitle("Open secret settings").click();
          assert.equal(await page.getByLabel("Build at Y=0:", { exact: true }).count(), 0);
          const floor = page.getByRole("checkbox", { name: "Assume floor", exact: true });
          assert(await floor.isDisabled() && !(await floor.isChecked()), "Party forces Assume floor off");
          await page.getByRole("button", { name: "Close", exact: true }).click();
        }
        if (settings.westEastSlope) {
          await page.getByRole("button", { name: "W→E slope", exact: true }).click();
          const run = page.getByRole("spinbutton", { name: /^West-to-east run/ });
          assert.equal(await run.inputValue(), "7", "Slope run defaults to the water-flush spacing");
          assert.equal(await page.getByRole("spinbutton", { name: /^Y change per W→E run/ }).inputValue(), "0", "Slope starts inactive");
          assert.equal(await run.getAttribute("min"), "1");
          assert.equal(await run.getAttribute("max"), "127");
          await run.fill("0");
          assert.equal(await run.inputValue(), "1", "UI clamps below-minimum values");
          await run.fill("128");
          assert.equal(await run.inputValue(), "127", "UI clamps above-maximum values");
          await run.fill(String(settings.westEastSlope.run));
          await page.getByRole("spinbutton", { name: /^Y change per W→E run/ }).fill(String(settings.westEastSlope.rise));
        }
        const downloadPromise = page.waitForEvent("download");
        await button.click();
        const download = await downloadPromise;
        assert.equal(await download.failure(), null);
        const uiBytes = gunzipSync(await readFile(await download.path()));
        // The site falls back to full Party when the minimum-height geometry duplicates another staircase mode.
        const effective = settings.mode !== "staircase_party" ? settings
          : { ...settings, partyMinHeight: await page.getByRole("checkbox", { name: "Min. height:", exact: true }).isChecked() };
        const apiBytes = await page.evaluate(async ({ apiOrigin, settings }) => {
          const { connect } = await import(`${apiOrigin}/PNG-to-NBT/api.js`);
          const api = await connect();
          try {
            const colors = Uint8Array.from({ length: 16384 }, (_, i) => settings.mode === "flat" ? 45 : 44 + (i % 128 + (i >> 7)) % 3);
            // Fullblock's selected stone-color block, unchanged by merely restoring CrubTech settings.
            const result = await api.generateTile({ colors, blocks: { 11: "andesite" }, options: settings });
            if (settings.mode === "staircase_party" && (result.effectiveOptions.assumeSupportFloor || result.effectiveOptions.buildAtWorldMinY)) throw new Error("Party API enabled a floor optimization");
            return Array.from(result.files[0].data);
          }
          finally { api.dispose(); }
        }, { apiOrigin, settings: effective });
        assert.deepEqual(gunzipSync(Uint8Array.from(apiBytes)), uiBytes, `${name}: UI/API ${JSON.stringify(effective)}`);
        assert.equal(await page.evaluate(() => localStorage.getItem("mapart_secret_apply_support_floor_ys")), "true", "Effective mode overrides must not change the saved floor preference");
        if (settings.mode === "staircase_party") {
          await page.locator('select:has(option[value="staircase_party"])').selectOption("staircase_northline");
          await page.getByTitle("Open secret settings").click();
          const floor = page.getByRole("checkbox", { name: "Assume floor", exact: true });
          assert(await floor.isEnabled() && await floor.isChecked(), "Leaving Party restores the saved floor preference");
          await page.getByRole("button", { name: "Close", exact: true }).click();
        }
      }
      assert.deepEqual(errors, []);
      const docs = await context.newPage();
      const docsRequests = [];
      docs.on("request", request => docsRequests.push(request.url()));
      await page.emulateMedia({ colorScheme: "light" });
      await docs.emulateMedia({ colorScheme: "light" });
      await docs.goto(`${apiOrigin}/PNG-to-NBT/api/`);
      const apiLink = await page.getByRole("link", { name: "PNG-to-NBT", exact: true })
        .evaluate(link => [new URL(link.href).pathname, link.target]);
      assert.deepEqual(apiLink, [new URL(docs.url()).pathname, ""], "The site credits must link to the API documentation in the same tab");
      const expectTheme = async dark => {
        for (const target of [page, docs]) {
          await target.waitForFunction(dark => document.documentElement.classList.contains("dark") === dark, dark);
        }
        assert.equal(await docs.evaluate(() => getComputedStyle(document.documentElement).colorScheme), dark ? "dark" : "light");
      };
      await docs.getByRole("button", { name: "Toggle theme", exact: true }).click();
      await expectTheme(true);
      assert.equal(await docs.evaluate(() => localStorage.getItem("mapart_theme")), "dark");
      await docs.reload();
      await expectTheme(true);
      await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
      await expectTheme(false);
      assert.equal(await docs.evaluate(() => localStorage.getItem("mapart_theme")), null);
      for (const target of [page, docs]) await target.emulateMedia({ colorScheme: "dark" });
      await expectTheme(true);
      await docs.getByRole("button", { name: "Toggle theme", exact: true }).click();
      await expectTheme(false);
      assert.equal(await docs.evaluate(() => localStorage.getItem("mapart_theme")), "light");
      await docs.evaluate(() => localStorage.clear());
      await docs.reload();
      await expectTheme(true);
      assert(!docsRequests.some(url => /react|icons|generate\.worker/.test(url)), "Documentation loaded app/generator assets");
      assert.deepEqual(await docs.locator("tbody tr td:first-child > code").allTextContents().then(names => names.sort()), optionNames,
        "Help page must document every public generation option exactly once");
      assert.deepEqual(await docs.evaluate(async () => {
        const broken = [];
        for (const link of document.querySelectorAll("a[href]")) {
          const url = new URL(link.href);
          if (url.origin !== location.origin) continue;
          if (url.hash && !document.querySelector(url.hash)) broken.push(link.getAttribute("href"));
          else if (!(await fetch(url)).ok) broken.push(link.getAttribute("href"));
        }
        return broken;
      }), [], "Help page links must resolve");
      for (const width of [375, 800, 1440]) {
        await docs.setViewportSize({ width, height: 900 });
        assert(await docs.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: docs overflow at ${width}px`);
      }
      // Execute the actual displayed example; only replace the hosted import with this test origin.
      const example = await docs.locator("pre code").innerText();
      assert.equal(await docs.evaluate(async ({ example, apiOrigin }) => {
        const source = example.replace(/import \{ connect \} from "[^"]+";/,
          `const { connect } = await import("${apiOrigin}/PNG-to-NBT/api.js");`);
        let generated = false;
        await new Function("console", `return (async () => {${source}})()`)({ log(files, warnings, options) {
          generated = files.length > 0 && files.every(file => file.data instanceof Uint8Array && file.data[0] === 31)
            && Array.isArray(warnings) && options.mode === "suppress_step_checker";
        } });
        return generated && !document.querySelector("iframe");
      }, { example, apiOrigin }), true, "Quick-start must generate NBT and dispose its connection");
      await docs.close();
      for (const failure of ["blocked", "full"]) {
        const isolated = await browser.newContext();
        try {
          const target = await isolated.newPage();
          const storageErrors = [];
          target.on("pageerror", error => storageErrors.push(error.message));
          await target.addInitScript(failure => {
            if (failure === "blocked") {
              Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
            } else {
              Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
            }
          }, failure);
          for (const route of ["", "api/"]) {
            await target.goto(`${apiOrigin}/PNG-to-NBT/${route}`);
            const before = await target.evaluate(() => document.documentElement.classList.contains("dark"));
            await target.getByRole("button", { name: "Toggle theme", exact: true }).click();
            await target.waitForFunction(before => document.documentElement.classList.contains("dark") !== before, before);
            if (!route) {
              const select = target.locator("select").filter({ has: target.locator('option[value="all"]') }).first();
              await select.selectOption("all");
              assert.equal(await select.inputValue(), "all", "Settings must remain editable without persistence");
            }
            await target.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "mapart_theme" })));
          }
          assert.deepEqual(storageErrors, [], `${name}: ${failure} storage`);
        }
        finally { await isolated.close(); }
      }
      console.log(`${name}: cross-origin subpath, binary output, FIFO/error recovery/input snapshots/dispose, reconnect, timeout and delivery isolation passed (${report.compressedBytes} gzip bytes).`);
      console.log(`${name}: shared main-site/API theme, cross-tab toggles, reload, system changes and preference clearing passed.`);
      console.log(`${name}: blocked and full storage preserve the app, controls and documentation theme.`);
      console.log(`${name}: worker startup/send/crash recovery, documentation coverage, links, responsive widths and literal quick-start passed.`);
    }
    finally { await browser.close(); }
  }
}
finally {
  host.closeAllConnections(); caller.closeAllConnections();
  host.close(); caller.close();
}
