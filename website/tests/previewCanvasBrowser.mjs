import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

const harness = `
  import React, { useLayoutEffect } from "react";
  import { createRoot } from "react-dom/client";
  import { PreviewCanvas } from "/src/components/PreviewCanvas.tsx";
  import { useStepPreview } from "/src/lib/previewImageEdits.ts";
  const root = createRoot(document.getElementById("root"));
  function Preview({ ready, stepOptions, ...props }) {
    const step = useStepPreview(stepOptions ?? { shape: null });
    useLayoutEffect(ready);
    return React.createElement(PreviewCanvas, stepOptions
      ? { ...props, pixelReplacements: step.replacements, visiblePixelMask: step.mask }
      : props);
  }
  window.renderPreview = props => new Promise(resolve => root.render(React.createElement(Preview, { ...props, ready: () => { resolve(); } })));
`;
const server = await createServer({
  server: { host: "127.0.0.1", port: 0 }, logLevel: "error",
  plugins: [{
    name: "preview-test",
    resolveId: id => id === "virtual:preview-test" ? "\0preview-test" : undefined,
    load: id => id === "\0preview-test" ? harness : undefined,
    configureServer(server) {
      server.middlewares.use("/preview-test", async (_, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml("/preview-test", '<div id="root"></div><script type="module" src="/@id/virtual:preview-test"></script>'));
      });
    },
  }],
});
await server.listen();
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${server.resolvedUrls.local[0]}preview-test`);
      await page.waitForFunction(() => window.renderPreview);
      const checks = await page.evaluate(async () => {
        const { buildPreviewVisibleMask, collectVsFillerPreviewReplacements } = await import("/src/lib/previewImageEdits.ts");
        const { toShapeCoordKey } = await import("/src/lib/shapeModel.ts");
        const { ShapePartType } = await import("/src/types/shape.ts");
        const { FillerRole } = await import("/src/types/conversion.ts");
        const { getShadedRgb } = await import("/src/utils/color.ts");
        const { Shade } = await import("/src/types/color.ts");
        const imageData = new ImageData(256, 256);
        for (let i = 0; i < imageData.data.length; i += 4) imageData.data.set([100, 120, 140, 255], i);
        const original = imageData.data.slice();
        const tiles = [0, 1, 2, 3].map(i => ({ startX: i % 2 * 128, startZ: Math.floor(i / 2) * 128 }));
        const check = (value, message) => { if (!value) throw new Error(message); };
        let checks = 0;
        async function verify(props, expected) {
          await window.renderPreview({ imageData, pixelReplacements: [], visiblePixelMask: null, ...props });
          const canvases = [...document.querySelectorAll("canvas")];
          const canvas = canvases.at(-1);
          const visible = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
          const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
          check(blob.type === "image/png", "Native canvas serialization must produce PNG");
          const decoded = await createImageBitmap(blob);
          const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
          copy.getContext("2d").drawImage(decoded, 0, 0); decoded.close();
          const saved = copy.getContext("2d").getImageData(0, 0, copy.width, copy.height).data;
          for (let i = 0; i < visible.length; ++i) check(visible[i] === saved[i], `Saved PNG differs from displayed bitmap at ${i}`);
          copy.getContext("2d").clearRect(0, 0, copy.width, copy.height);
          for (const layer of canvases) copy.getContext("2d").drawImage(layer, 0, 0);
          const displayed = copy.getContext("2d").getImageData(0, 0, copy.width, copy.height).data;
          for (let z = 0; z < canvas.height; ++z) for (let x = 0; x < canvas.width; ++x) {
            const tile = Math.floor(z / 128) * Math.ceil(canvas.width / 128) + Math.floor(x / 128);
            const contextOnly = props.selectedTileIndices?.size && !props.selectedTileIndices.has(tile);
            const index = (z * canvas.width + x) * 4;
            const source = contextOnly ? imageData.data : saved;
            for (let c = 0; c < 4; ++c) check(displayed[index + c] === source[index + c], `Unexpected displayed pixel ${x},${z}`);
          }
          for (const [x, z, rgba] of expected) {
            const actual = [...saved.slice((z * canvas.width + x) * 4, (z * canvas.width + x) * 4 + 4)];
            check(JSON.stringify(actual) === JSON.stringify(rgba), `Unexpected pixel ${x},${z}: ${actual} vs ${rgba}`);
          }
          check(canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })), "Native context menu must remain available");
          ++checks;
        }
        const opaque = [100, 120, 140, 255], clear = [0, 0, 0, 0];
        for (const selected of [[], [0, 1, 2, 3], [0], [1, 2]]) {
          await verify({ selectedTileIndices: new Set(selected), visiblePixelMask: buildPreviewVisibleMask(imageData, tiles, selected) }, tiles.map((tile, i) =>
            [tile.startX, tile.startZ, !selected.length || selected.includes(i) ? opaque : clear]));
        }
        for (const axis of ["xColumnRange", "zColumnRange"]) {
          await verify({ selectedTileIndices: new Set([3]), visiblePixelMask: buildPreviewVisibleMask(imageData, tiles, [3], {
            tile: tiles[3], mask: null, [axis]: [4, 8],
          }) }, [[0, 0, clear], [128, 128, clear], [132, 132, opaque], [137, 137, clear]]);
        }
        const single = new ImageData(original.slice(0, 128 * 128 * 4), 128, 128);
        const vsShape = { parts: [{ cells: new Map([[toShapeCoordKey(5, 0, 5), [FillerRole.ShadeVoidDominant]]]) }] };
        const replacements = collectVsFillerPreviewReplacements({ shape: vsShape, shadeFillerBlock: "stone", dominateVoidFillerBlock: "", recessiveVoidFillerBlock: "" });
        await verify({ imageData: single, pixelReplacements: replacements }, [[5, 5, [...getShadedRgb({ id: 11, isCustom: false, shade: Shade.Light }, []), 255]]]);
        await verify({ imageData: single }, [[5, 5, opaque]]);
        // A retained top shaded by its northern neighbor, plus the currently printed pixel.
        // Transpose/reflect coordinates to exercise each suppression direction's bitmap layout.
        for (const [oldX, oldZ, newX, newZ] of [[80, 20, 40, 20], [20, 20, 80, 20], [20, 20, 20, 80], [20, 80, 20, 40]]) {
          const pixelMask = new Uint8Array(128 * 128); pixelMask[oldZ * 128 + oldX] = 1;
          const blocks = new Map([
            [toShapeCoordKey(oldX, 0, oldZ), { colorKey: 22, blockName: "stone" }],
            [toShapeCoordKey(oldX, 1, oldZ - 1), { colorKey: 22, blockName: "stone" }],
          ]);
          const stepOptions = {
            shape: { partType: ShapePartType.SuppressStepPhases, parts: [
              { cells: new Map([[toShapeCoordKey(oldX, 0, oldZ), { id: 11, isCustom: false }]]) },
              { cells: new Map([[toShapeCoordKey(newX, 0, newZ), { id: 11, isCustom: false }]]) },
            ] }, phaseRange: [1, 1], retainedState: { blocks, pixelMask },
            selections: { selectedBlocks: { 11: "stone" }, selectedBlocksCustom: {}, customColors: [] },
            fillerAssignments: [], belowPlatformWater: false,
          };
          await verify({ imageData: single, stepOptions }, [
            [oldX, oldZ, [...getShadedRgb({ id: 11, isCustom: false, shade: Shade.Dark }, []), 255]],
            [newX, newZ, opaque], [0, 0, clear],
          ]);
          await verify({ imageData: single, stepOptions: { ...stepOptions, retainedState: undefined } }, [[oldX, oldZ, clear], [newX, newZ, opaque]]);
        }
        check(imageData.data.every((value, i) => value === original[i]), "Preview must not mutate source pixels");
        await verify({}, [[0, 0, opaque], [255, 255, opaque]]);
        return checks;
      });
      assert.equal(checks, 17);
      console.log(`${name}: ${checks} preview/PNG comparisons passed (tiles, ranges, fillers, retained shading, reset).`);
      const png = await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "rgb(112,112,112)";
        ctx.fillRect(0, 0, 256, 256);
        localStorage.setItem("mapart_secret_auto_scale_pixel_art", "false");
        return canvas.toDataURL().split(",")[1];
      });
      await page.goto(server.resolvedUrls.local[0]);
      await page.locator('input[type="file"]').setInputFiles({ name: "tiles.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
      await page.getByRole("button", { name: "Tile 4", exact: true }).waitFor();
      const canvas = page.locator('canvas[aria-hidden="true"]').last();
      const countPixels = (displayed = false) => canvas.evaluate((canvas, displayed) => {
        const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
        const ctx = copy.getContext("2d");
        for (const layer of displayed ? canvas.parentElement.querySelectorAll("canvas") : [canvas]) ctx.drawImage(layer, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) ++count;
        return count;
      }, displayed);
      const untilVisible = async count => {
        for (let i = 0; i < 100; ++i) {
          if (await countPixels() === count) {
            assert.equal(await countPixels(true), 256 * 256, "Unselected tiles must remain visible");
            return;
          }
          await page.waitForTimeout(50);
        }
        assert.equal(await countPixels(), count);
      };
      await untilVisible(256 * 256);
      // Keyboard selection must still work through the non-intercepting tile overlay.
      await page.getByRole("button", { name: "Tile 1", exact: true }).focus();
      await page.keyboard.press("Space");
      await untilVisible(128 * 128);
      const rect = await canvas.boundingBox();
      // Mouse selection must still use the original full-image coordinate system.
      await canvas.click({ position: { x: rect.width * 0.75, y: rect.height * 0.75 }, modifiers: ["ControlOrMeta"] });
      await untilVisible(2 * 128 * 128);
      await page.getByRole("button", { name: "Tile 1", exact: true }).focus();
      await page.keyboard.press("ControlOrMeta+Space");
      await untilVisible(128 * 128);
      await page.getByRole("button", { name: "Tile 4", exact: true }).focus();
      await page.keyboard.press("Space");
      await untilVisible(256 * 256);
      console.log(`${name}: main-page upload, keyboard/mouse tile selection and no-selection reset passed.`);
    }
    finally { await browser.close(); }
  }
}
finally { await server.close(); }
