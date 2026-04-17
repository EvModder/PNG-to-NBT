/**
 * Public API:
 * - MAP_SIZE
 * - TRANSPARENT_COLOR
 * - isTransparentColor()
 * - isWaterColor()
 * - packRgb()
 * - unpackRgb()
 * - createImageDataFromColorGrid()
 * - getShadedRgb()
 * - getHue()
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/lib/codecColorGrid.ts
 * - src/lib/colorGridAnalysis.ts
 * - src/lib/colorGridParsing.ts
 * - src/lib/colorGridParsingCore.ts
 * - src/lib/messages.ts
 * - src/lib/nbtExport.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/shapeModel.ts
 * - src/lib/suppressLoadMarkers.ts
 * - src/lib/tileParsing.worker.ts
 * - src/lib/tileParsingWorkerClient.ts
 * - src/utils/colorGridKey.ts
 */
import { BASE_COLORS, SHADE_MULTIPLIERS, TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX } from "@/data/mapColors";
import { Shade, type ColorGrid, type ColorRef, type ColorRgb, type ShadedColorRef } from "@/types/color";

// Callers:
// - src/Index.tsx
// - src/lib/codecColorGrid.ts
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsing.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/nbtExport.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
// - src/lib/shapeModel.ts
// - src/lib/suppressLoadMarkers.ts
// - src/lib/tileParsing.worker.ts
// - src/lib/tileParsingWorkerClient.ts
// - src/utils/colorGridKey.ts
export const MAP_SIZE = 128;

// Callers:
// - src/lib/codecColorGrid.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
// - src/utils/colorGridKey.ts
export const TRANSPARENT_COLOR: ShadedColorRef = Object.freeze({ isCustom: false, id: TRANSPARENCY_BASE_INDEX, shade: Shade.Dark });

// Callers:
// - src/lib/colorGridAnalysis.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
export function isTransparentColor(cell: ShadedColorRef): boolean {
  return !cell.isCustom && cell.id === TRANSPARENCY_BASE_INDEX;
}

// Callers:
// - src/lib/colorGridAnalysis.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
export function isWaterColor(color: ShadedColorRef): boolean {
  return !color.isCustom && color.id === WATER_BASE_INDEX;
}

// Callers:
// - src/lib/colorGridParsingCore.ts
export function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

// Callers:
// - src/lib/colorGridParsingCore.ts
// - src/lib/messages.ts
export function unpackRgb(key: number): [number, number, number] {
  return [(key >> 16) & 255, (key >> 8) & 255, key & 255];
}

function resolveColorRgb(
  color: Pick<ColorRef, "id" | "isCustom">,
  customColors?: readonly ColorRgb[],
): [number, number, number] | null {
  const resolvedColor = color.isCustom ? customColors?.[color.id] : BASE_COLORS[color.id];
  return resolvedColor ? [resolvedColor.r, resolvedColor.g, resolvedColor.b] : null;
}

// Callers:
// - src/components/PanelCustomColors.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/lib/colorGridParsingCore.ts
export function getShadedRgb(
  color: Pick<ColorRgb, "r" | "g" | "b">,
  shade: Shade,
): [number, number, number];
export function getShadedRgb(
  color: Pick<ShadedColorRef, "id" | "shade"> & { isCustom?: false },
): [number, number, number];
export function getShadedRgb(
  color: ShadedColorRef,
  customColors: readonly ColorRgb[],
): [number, number, number];
export function getShadedRgb(
  color: Pick<ColorRgb, "r" | "g" | "b"> | Pick<ShadedColorRef, "id" | "shade"> | ShadedColorRef,
  shadeOrCustomColors?: Shade | readonly ColorRgb[],
): [number, number, number] {
  let rgb: [number, number, number] | null;
  let resolvedShade: Shade | undefined;
  if ("r" in color) {
    rgb = [color.r, color.g, color.b];
    resolvedShade = shadeOrCustomColors as Shade | undefined;
  } else {
    const colorRef = "isCustom" in color ? color : { id: color.id, isCustom: false };
    rgb = resolveColorRgb(colorRef, Array.isArray(shadeOrCustomColors) ? shadeOrCustomColors : undefined);
    resolvedShade = color.shade;
  }
  if (!rgb) {
    throw new Error(`Missing RGB source for ${"isCustom" in color && color.isCustom ? "custom" : "base"} color shading`);
  }
  if (resolvedShade === undefined) {
    throw new Error("getShadedRgb requires a shade when called with raw RGB values");
  }
  const multiplier = SHADE_MULTIPLIERS[resolvedShade];
  return [
    Math.floor((rgb[0] * multiplier) / 255),
    Math.floor((rgb[1] * multiplier) / 255),
    Math.floor((rgb[2] * multiplier) / 255),
  ];
}

// Callers:
// - src/Index.tsx
export function createImageDataFromColorGrid(colorGrid: ColorGrid, customColors: ColorRgb[]): ImageData {
  const data = new Uint8ClampedArray(MAP_SIZE * MAP_SIZE * 4);
  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const color = colorGrid[x][z];
      const offset = (z * MAP_SIZE + x) * 4;
      if (!color.isCustom && color.id === TRANSPARENCY_BASE_INDEX) {
        data[offset + 3] = 0;
        continue;
      }
      const [r, g, b] = getShadedRgb(color, customColors);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  if (typeof ImageData !== "undefined") return new ImageData(data, MAP_SIZE, MAP_SIZE);
  return { data, width: MAP_SIZE, height: MAP_SIZE, colorSpace: "srgb" } as ImageData;
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
export function getHue(r: number, g: number, b: number): number {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const delta = max - min;
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta + 6) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return hue * 60;
}
