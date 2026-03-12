/**
 * Public API:
 * - ShapePartType
 * - ShapeColor
 * - ShapeCell
 * - ShapeCoordKey
 * - toShapeCoordKey()
 * - parseShapeCoordKey()
 * - ShapePart
 *
 * Used by:
 * - src/lib/shapeGeneration.ts
 * - src/lib/shapeSubstitution.ts
 * - src/Index.tsx
 */
import { FillerRole } from "./conversionTypes";

export enum ShapePartType {
  SingleColumn = "single_column",
  SuppressStepColumns = "suppress_step_columns",
}

export interface ShapeColor {
  id: number;
  isCustom: boolean;
}

export type ShapeCell = ShapeColor | FillerRole[];

export function isShapeColorCell(cell: ShapeCell): cell is ShapeColor {
  return !Array.isArray(cell);
}

export function isShapeFillerCell(cell: ShapeCell): cell is FillerRole[] {
  return Array.isArray(cell);
}

export type ShapeCoordKey = number;

const SHAPE_COORD_Z_OFFSET = 256;
const SHAPE_COORD_Y_OFFSET = 4096;
const SHAPE_COORD_Z_SIZE = 512;
const SHAPE_COORD_Y_SIZE = 8192;

export function toShapeCoordKey(x: number, y: number, z: number): ShapeCoordKey {
  return ((x + 1) * SHAPE_COORD_Y_SIZE + (y + SHAPE_COORD_Y_OFFSET)) * SHAPE_COORD_Z_SIZE + (z + SHAPE_COORD_Z_OFFSET);
}

export function parseShapeCoordKey(key: ShapeCoordKey): [number, number, number] {
  const z = (key % SHAPE_COORD_Z_SIZE) - SHAPE_COORD_Z_OFFSET;
  const yBlock = Math.floor(key / SHAPE_COORD_Z_SIZE);
  const y = (yBlock % SHAPE_COORD_Y_SIZE) - SHAPE_COORD_Y_OFFSET;
  const x = Math.floor(yBlock / SHAPE_COORD_Y_SIZE) - 1;
  return [x, y, z];
}

export interface ShapePart {
  cells: Map<ShapeCoordKey, ShapeCell>;
  bounds: {
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
}
