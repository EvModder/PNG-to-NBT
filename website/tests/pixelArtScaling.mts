import assert from "node:assert/strict";
import { scalePixelArt } from "@/lib/pixelArtScaling";
import { DEFAULT_AUTO_SCALE_PIXEL_ART, DEFAULT_PIXEL_ART_SCALE_MODE } from "@/data/defaultSettings";
import { messages } from "@/lib/messages";

assert.equal(DEFAULT_AUTO_SCALE_PIXEL_ART, true);
assert.equal(DEFAULT_PIXEL_ART_SCALE_MODE, "downscale");
for (const [width, height, outputWidth, text, tone] of [
  [64, 64, 128, "Upscaled by 2× (64×64 → 128×128).", "error"],
  [512, 512, 128, "Downscaled by 4× (512×512 → 128×128).", "warning"],
  [384, 192, 256, "Downscaled by 1.5× (384×192 → 256×128).", "warning"],
] as const) {
  const notice = messages.parsing.scaledImageNotice(width, height, outputWidth);
  assert.equal(messages.parsing.noticeText(notice), text);
  assert.equal(messages.parsing.noticeTone(notice), tone);
  assert.equal(messages.parsing.bannerTone([notice]), "warning", "Scaling must not block export");
}

// Only the pixel buffer constructor is needed; no canvas/browser interpolation.
Object.defineProperty(globalThis, "ImageData", { configurable: true, value: class {
  data: Uint8ClampedArray;
  colorSpace: PredefinedColorSpace;
  constructor(public width: number, public height: number, options?: ImageDataSettings) {
    this.data = new Uint8ClampedArray(width * height * 4);
    this.colorSpace = options?.colorSpace ?? "srgb";
  }
} });

function art(width: number, height: number, cellX: number, cellY = cellX): ImageData {
  const image = new ImageData(width, height);
  for (let y = 0; y < height; ++y) for (let x = 0; x < width; ++x) {
    const column = Math.floor(x / cellX), row = Math.floor(y / cellY);
    image.data.set([column % 256, row % 256, (column + row) % 256, (column * 11 + row * 17) % 256], (y * width + x) * 4);
  }
  return image;
}

function assertLossless(input: ImageData, output: ImageData) {
  assert.equal(output.width % 128, 0);
  assert.equal(output.height % 128, 0);
  assert.equal(input.width * output.height, input.height * output.width);
  assert.equal(output.colorSpace, input.colorSpace);
  // Resample in both directions to detect discarded detail or invented pixels.
  for (const [from, to] of [[input, output], [output, input]]) {
    for (let y = 0; y < to.height; ++y) for (let x = 0; x < to.width; ++x) {
      const source = (Math.floor(y * from.height / to.height) * from.width + Math.floor(x * from.width / to.width)) * 4;
      const target = (y * to.width + x) * 4;
      for (let c = 0; c < 4; ++c) assert.equal(to.data[target + c], from.data[source + c]);
    }
  }
}

for (const [width, height, targetWidth, targetHeight] of [
  [1, 1, 128, 128], [16, 16, 128, 128], [64, 128, 128, 256],
  [64, 32, 256, 128], [32, 96, 128, 384], [256, 64, 512, 128],
]) {
  const input = art(width, height, 1);
  for (const mode of ["upscale", "both"] as const) {
    const output = scalePixelArt(input, mode);
    assert.deepEqual([output.width, output.height], [targetWidth, targetHeight]);
    assertLossless(input, output);
  }
  assert.equal(scalePixelArt(input, "downscale"), input);
  assert.equal(scalePixelArt(input, null), input);
}

for (const [width, height, cell, targetWidth, targetHeight] of [
  [512, 512, 32, 128, 128], [512, 256, 2, 256, 128],
  [768, 512, 4, 384, 256], [192, 192, 3, 128, 128],
  [384, 192, 3, 256, 128], [384, 384, 3, 128, 128],
  [768, 768, 6, 128, 128],
]) {
  const input = art(width, height, cell);
  const original = input.data.slice();
  for (const mode of ["downscale", "both"] as const) {
    const output = scalePixelArt(input, mode);
    assert.deepEqual([output.width, output.height], [targetWidth, targetHeight]);
    assertLossless(input, output);
    assert.equal(scalePixelArt(output, mode), output, "Scaling must be idempotent");
  }
  assert.deepEqual(input.data, original, "The original upload must not be modified");
  assert.equal(scalePixelArt(input, "upscale"), input);
  assert.equal(scalePixelArt(input, null), input);
}

for (const input of [art(63, 64, 1), art(64, 65, 1), art(127, 127, 1),
  art(256, 256, 1), art(512, 256, 2, 1), art(256, 384, 128)]) {
  assert.equal(scalePixelArt(input, "both"), input, `${input.width}x${input.height} should remain unchanged`);
}
// Tile-height strips cannot shrink, regardless of repeated pixel contents.
for (const [width, height] of [[128, 4096], [4096, 128], [64, 4096]]) {
  const input = art(width, height, 256);
  assert.equal(scalePixelArt(input, "downscale"), input);
}
// Repeated output rows must preserve alpha and non-square image proportions.
for (const [width, height, cell, mode] of [
  [16, 256, 1, "upscale"],
  [768, 384, 6, "downscale"],
] as const) {
  const input = art(width, height, cell);
  const output = scalePixelArt(input, mode);
  assert.notEqual(output, input);
  assertLossless(input, output);
}
// Even a single RGBA-channel difference inside a repeated block must survive.
for (let channel = 0; channel < 4; ++channel) {
  const input = art(512, 512, 32);
  input.data[(17 * 512 + 17) * 4 + channel] ^= 1;
  assert.equal(scalePixelArt(input, "downscale"), input);
}
// Non-square source pixels can only shrink by their common square factor.
const rectangular = art(512, 512, 4, 6);
const reduced = scalePixelArt(rectangular, "downscale");
assert.equal(reduced.width, 256);
assertLossless(rectangular, reduced);

// ImageData may use a subarray with an unaligned byte offset.
const input = art(64, 64, 1);
const unaligned = new Uint8ClampedArray(input.data.length + 1).subarray(1);
unaligned.set(input.data);
assertLossless({ ...input, data: unaligned }, scalePixelArt({ ...input, data: unaligned }, "both"));

const imageDataConstructor = globalThis.ImageData;
// Firefox has no colorSpace property and rejects the three-argument overload.
try {
  Object.defineProperty(globalThis, "ImageData", { configurable: true, value: class {
    data: Uint8ClampedArray;
    constructor(public width: number, public height: number) {
      assert.equal(arguments.length, 2);
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  } });
  for (const [size, cell] of [[64, 1], [512, 32]]) {
    const source = art(size, size, cell);
    const output = scalePixelArt(source, "both");
    assert.equal(output.width, 128);
    assertLossless(source, output);
  }
} finally {
  Object.defineProperty(globalThis, "ImageData", { configurable: true, value: imageDataConstructor });
}
try {
  Object.defineProperty(globalThis, "ImageData", { configurable: true, value: class {
    constructor() { throw new RangeError("Image allocation limit"); }
  } });
  assert.equal(scalePixelArt(input, "upscale"), input, "Allocation failure must not crash the UI or discard the upload");
} finally {
  Object.defineProperty(globalThis, "ImageData", { configurable: true, value: imageDataConstructor });
}

console.log("Lossless pixel-art scaling, mode, aspect-ratio, alpha and identity checks passed.");
