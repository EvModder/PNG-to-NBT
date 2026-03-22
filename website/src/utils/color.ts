/**
 * Public API:
 * - MAP_SIZE
 * - TRANSPARENT_COLOR
 * - isTransparentColor()
 * - isWaterColor()
 * - packRgb()
 * - unpackRgb()
 * - getShadedRgb()
 * - getHue()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/colorGridAnalysis.ts
 * - src/lib/colorGridParsing.ts
 * - src/lib/messages.ts
 * - src/lib/nbtExport.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeModel.ts
 * - src/lib/shapeGeneration.ts
 */
import { BASE_COLORS, SHADE_MULTIPLIERS, TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX } from "@/data/mapColors";
import { Shade, type ShadedColorRef } from "@/types/color";

// Callers:
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsing.ts
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeModel.ts
// - src/lib/shapeGeneration.ts
export const MAP_SIZE = 128;

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
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
// - src/lib/shapeGeneration.ts
export function isWaterColor(color: ShadedColorRef): boolean {
  return !color.isCustom && color.id === WATER_BASE_INDEX;
}

// Callers:
// - src/lib/colorGridParsing.ts
export function packRgb(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/messages.ts
export function unpackRgb(key: number): [number, number, number] {
  return [(key >> 16) & 255, (key >> 8) & 255, key & 255];
}

// Callers:
// - src/Index.tsx
export function getShadedRgb(color: Pick<ShadedColorRef, "id" | "shade">): [number, number, number] {
  const { r, g, b } = BASE_COLORS[color.id];
  const multiplier = SHADE_MULTIPLIERS[color.shade];
  return [
    Math.floor((r * multiplier) / 255),
    Math.floor((g * multiplier) / 255),
    Math.floor((b * multiplier) / 255),
  ];
}

// Callers:
// - src/Index.tsx
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
