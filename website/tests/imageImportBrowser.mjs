import assert from "node:assert/strict";
import { deflateSync, crc32 } from "node:zlib";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), result.length - 4);
  return result;
}
function integers(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
  return bytes;
}
function png(colors, gamma) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(colors.length); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    ...(gamma ? [chunk("gAMA", integers([gamma])), chunk("cHRM", integers([31270,32900,64000,33000,30000,60000,15000,6000]))] : []),
    chunk("IDAT", deflateSync(Buffer.from([0, ...colors.flat()]))), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(server.resolvedUrls.local[0]);
      for (const colors of [[[127,178,56], [247,233,163], [199,199,199], [64,64,255]], [[123,45,67], [88,99,111]]]) {
        for (const gamma of [0, 45455, 100000]) {
          const result = await page.evaluate(async bytes => {
            const { loadImageDataFromFile } = await import("/src/lib/colorGridParsing.ts");
            const file = new File([Uint8Array.from(bytes)], "colors.png", { type: "image/png" });
            const actual = await loadImageDataFromFile(file);
            const img = new Image(); const url = URL.createObjectURL(file);
            img.src = url; await img.decode();
            const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
            const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
            const managed = ctx.getImageData(0, 0, img.width, img.height);
            URL.revokeObjectURL(url);
            const rgb = data => [...data].filter((_, i) => i % 4 !== 3);
            return { actual: rgb(actual.data), managed: rgb(managed.data) };
          }, [...png(colors, gamma)]);
          assert.deepEqual(result.actual, colors.length === 4 ? colors.flat() : result.managed, `${name}, gamma=${gamma}`);
        }
      }
      console.log(`${name}: exact map palette preserved; ordinary PNG color management unchanged.`);
    }
    finally { await browser.close(); }
  }
}
finally { await server.close(); }
