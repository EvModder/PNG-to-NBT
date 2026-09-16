/**
 * Public API:
 * - scalePixelArt()
 *
 * Callers:
 * - src/Index.tsx
 * - tests/pixelArtScaling.mts
 */
import type { PixelArtScaleMode } from "@/data/defaultSettings";
import { MAP_SIZE } from "@/utils/color";

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

// Return the original object when disabled or no exact, tile-aligned resize exists.
export function scalePixelArt(input: ImageData, mode: PixelArtScaleMode | null): ImageData {
  if (mode === null) return input;
  const { width, height, data } = input;
  let sourceCell = 1;
  let targetCell = 1;
  const shortest = Math.min(width, height);
  if (mode !== "downscale" && shortest < MAP_SIZE && MAP_SIZE % shortest === 0) {
    const factor = MAP_SIZE / shortest;
    if ((width * factor) % MAP_SIZE === 0 && (height * factor) % MAP_SIZE === 0) targetCell = factor;
  }
  if (targetCell === 1 && mode === "upscale") return input;
  if (targetCell === 1 && shortest <= MAP_SIZE) return input;

  // A color boundary inside a repeated square rules out any cell size that does
  // not divide its coordinate. GCD finds the largest exact grid in one scan.
  const alignedData = data.byteOffset % 4 === 0 ? data : data.slice();
  const pixels = new Uint32Array(alignedData.buffer, alignedData.byteOffset, width * height);
  if (targetCell === 1 && mode !== "upscale") {
    sourceCell = gcd(width, height);
    const requiredCell = () => MAP_SIZE / gcd(MAP_SIZE, gcd(width / sourceCell, height / sourceCell));
    targetCell = requiredCell();
    if (targetCell >= sourceCell) return input;
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) {
        const index = y * width + x;
        const previousCell = sourceCell;
        if (x % sourceCell !== 0 && pixels[index] !== pixels[index - 1]) sourceCell = gcd(sourceCell, x);
        if (y % sourceCell !== 0 && pixels[index] !== pixels[index - width]) sourceCell = gcd(sourceCell, y);
        // Ordinary images usually rule out downscaling after just a few pixels.
        if (sourceCell !== previousCell) {
          targetCell = requiredCell();
          if (targetCell >= sourceCell) return input;
        }
      }
    }
  }
  if (sourceCell === targetCell) return input;
  const outputWidth = width / sourceCell * targetCell;
  const outputHeight = height / sourceCell * targetCell;
  let output: ImageData;
  try {
    output = input.colorSpace
      ? new ImageData(outputWidth, outputHeight, { colorSpace: input.colorSpace })
      : new ImageData(outputWidth, outputHeight);
  } catch {
    // Extreme aspect ratios can exceed browser allocation limits when enlarged.
    // Keep the original upload available to the normal dimension validation.
    return input;
  }
  const result = new Uint32Array(output.data.buffer);
  for (let y = 0; y < outputHeight; ++y) {
    const targetRow = y * outputWidth;
    if (y % targetCell !== 0) {
      result.copyWithin(targetRow, targetRow - outputWidth, targetRow);
      continue;
    }
    const sourceRow = Math.floor(y / targetCell) * sourceCell * width;
    for (let x = 0; x < outputWidth; ++x) {
      result[targetRow + x] = pixels[sourceRow + Math.floor(x / targetCell) * sourceCell];
    }
  }
  return output;
}
