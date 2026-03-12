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
 * Callers:
 * - src/Index.tsx
 * - src/lib/colorGridAnalysis.ts
 * - src/lib/colorGridParsing.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeCellRules.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/shapeSubstitution.ts
 */
import { WATER_BASE_INDEX } from "@/data/mapColors";

// Callers:
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsing.ts
// - src/lib/shapeCellRules.ts
// - src/lib/shapeGeneration.ts
// - src/lib/shapeSubstitution.ts
export const MAP_SIZE = 128;
// Callers:
// - src/Index.tsx
export type Shade = 0 | 1 | 2 | 3;

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/shapeGeneration.ts
export interface ColorData {
  isCustom: boolean;
  id: number;
  shade: Shade;
}

// Callers:
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsing.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
export type ColorGrid = ColorData[][];
// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/shapeGeneration.ts
export const TRANSPARENT_COLOR: ColorData = Object.freeze({ isCustom: false, id: 0, shade: 0 });

// Callers:
// - src/lib/colorGridAnalysis.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
export function getColorCell(grid: ColorGrid, x: number, z: number): ColorData {
  if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) return TRANSPARENT_COLOR;
  return grid[z]?.[x] ?? TRANSPARENT_COLOR;
}

// Callers:
// - src/lib/colorGridAnalysis.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
export function isTransparentColor(cell: ColorData): boolean {
  return !cell.isCustom && cell.id === 0;
}

// Callers:
// - src/lib/colorGridAnalysis.ts
// - src/lib/shapeGeneration.ts
export function isWaterColor(color: ColorData): boolean {
  return !color.isCustom && color.id === WATER_BASE_INDEX;
}
