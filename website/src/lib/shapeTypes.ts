/**
 * Public API:
 * - ShapePartType
 * - ShapeColor
 * - ShapeCell
 * - isShapeColorCell()
 * - isShapeFillerCell()
 * - ShapeCoordKey
 * - toShapeCoordKey()
 * - parseShapeCoordKey()
 * - ShapePart
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/materialRules.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeCellRules.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/shapeSubstitution.ts
 */
import { FillerRole } from "./conversionTypes";

// Callers:
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
export enum ShapePartType {
  SingleColumn = "single_column",
  SuppressStepColumns = "suppress_step_columns",
}

// Callers:
// - src/lib/materialRules.ts
// - src/lib/shapeCellRules.ts
// - src/lib/shapeGeneration.ts
export interface ShapeColor {
  id: number;
  isCustom: boolean;
}

// Callers:
// - src/lib/shapeGeneration.ts
export type ShapeCell = ShapeColor | FillerRole[];

// Callers:
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeCellRules.ts
// - src/lib/shapeSubstitution.ts
export function isShapeColorCell(cell: ShapeCell): cell is ShapeColor {
  return !Array.isArray(cell);
}

// Callers:
// - src/Index.tsx
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeSubstitution.ts
export function isShapeFillerCell(cell: ShapeCell): cell is FillerRole[] {
  return Array.isArray(cell);
}

// Callers:
// - src/lib/shapeGeneration.ts
export type ShapeCoordKey = number;

const SHAPE_COORD_Z_OFFSET = 256;
const SHAPE_COORD_Y_OFFSET = 4096;
const SHAPE_COORD_Z_SIZE = 512;
const SHAPE_COORD_Y_SIZE = 8192;

// Callers:
// - src/lib/shapeCellRules.ts
// - src/lib/shapeGeneration.ts
export function toShapeCoordKey(x: number, y: number, z: number): ShapeCoordKey {
  return ((x + 1) * SHAPE_COORD_Y_SIZE + (y + SHAPE_COORD_Y_OFFSET)) * SHAPE_COORD_Z_SIZE + (z + SHAPE_COORD_Z_OFFSET);
}

// Callers:
// - src/Index.tsx
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeCellRules.ts
// - src/lib/shapeGeneration.ts
// - src/lib/shapeSubstitution.ts
export function parseShapeCoordKey(key: ShapeCoordKey): [number, number, number] {
  const z = (key % SHAPE_COORD_Z_SIZE) - SHAPE_COORD_Z_OFFSET;
  const yBlock = Math.floor(key / SHAPE_COORD_Z_SIZE);
  const y = (yBlock % SHAPE_COORD_Y_SIZE) - SHAPE_COORD_Y_OFFSET;
  const x = Math.floor(yBlock / SHAPE_COORD_Y_SIZE) - 1;
  return [x, y, z];
}

// Callers:
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeCellRules.ts
// - src/lib/shapeGeneration.ts
// - src/lib/shapeSubstitution.ts
export interface ShapePart {
  cells: Map<ShapeCoordKey, ShapeCell>;
  bounds: {
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
}
