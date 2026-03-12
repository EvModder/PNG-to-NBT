/**
 * Public API:
 * - MAP_SIZE
 * - Shade
 * - ColorData
 * - ColorGrid
 * - TRANSPARENT_COLOR
 * - getColorCell()
 * - isTransparentColor()
 * - isWaterColor()
 *
 * Used by:
 * - src/lib/colorGridAnalyzer.ts
 * - src/lib/colorGridFromImage.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/shapeSubstitution.ts
 * - src/lib/shapeTypes.ts
 */
import { WATER_BASE_INDEX } from "@/data/mapColors";

export const MAP_SIZE = 128;
export type Shade = 0 | 1 | 2 | 3;

export interface ColorData {
  isCustom: boolean;
  id: number;
  shade: Shade;
}

export type ColorGrid = ColorData[][];
export const TRANSPARENT_COLOR: ColorData = Object.freeze({ isCustom: false, id: 0, shade: 0 });

export function getColorCell(grid: ColorGrid, x: number, z: number): ColorData {
  if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) return TRANSPARENT_COLOR;
  return grid[z]?.[x] ?? TRANSPARENT_COLOR;
}

export function isTransparentColor(cell: ColorData): boolean {
  return !cell.isCustom && cell.id === 0;
}

export function isWaterColor(color: ColorData): boolean {
  return !color.isCustom && color.id === WATER_BASE_INDEX;
}
