/**
 * Block and column helpers shared by the shape builders.
 *
 * Public API:
 * - PositionedEntry
 * - ShapeRef
 * - ShapeBlock
 * - ColumnPixelCell
 * - ColumnCoordKey
 * - ColumnPixelCache
 * - FillerCandidate
 * - COLUMN_COORD_Z_SIZE
 * - toColumnCoordKey()
 * - parseColumnCoordKey()
 * - getCachedColumnPixelInfo()
 * - groupBlocksByColumn()
 * - buildColumnBlockRows()
 * - isWaterBlock()
 * - makeFillerBlock()
 * - getWaterDepth()
 * - getWaterDrop()
 *
 * Callers:
 * - src/lib/shapeBlocksStaircase.ts
 * - src/lib/shapeGeneration.ts
 */
import { Shade, type ColorGrid, type ShadedColorRef } from "@/types/color";
import type { FillerRole } from "@/types/conversion";
import type { ShapeColorRef } from "@/types/shape";
import { MAP_SIZE, isTransparentColor, isWaterColor } from "@/utils/color";
import { PixelParity, getPixelParity, type WaterDrops } from "./colorGridAnalysis";

export type PositionedEntry = { x: number; y: number; z: number };
export type ShapeRef =
  | { kind: "color"; color: ShadedColorRef & ShapeColorRef }
  | { kind: "filler"; role: FillerRole };
export type ShapeBlock = PositionedEntry & { ref: ShapeRef };
export type ColumnPixelCell = { shade: Shade; isWater: boolean };
export type ColumnCoordKey = number;
export interface ColumnPixelCache {
  // Per-X non-transparent source-pixel lookup used by staircase transforms.
  columnPixelsByZ: Map<number, Map<number, ColumnPixelCell>>;
  // Water-filtered variant of the same lookup, for below-platform staircase shaping.
  columnNonWaterPixelsByZ: Map<number, Map<number, ColumnPixelCell>>;
}

// Callers:
// - src/lib/shapeBlocksStaircase.ts
// - src/lib/shapeGeneration.ts
export type FillerCandidate = PositionedEntry & { roles: FillerRole[] };

const COLUMN_COORD_Z_OFFSET = 256;
// Callers:
// - src/lib/shapeGeneration.ts
export const COLUMN_COORD_Z_SIZE = 512;

// Callers:
// - src/lib/shapeBlocksStaircase.ts
// - src/lib/shapeGeneration.ts
export function toColumnCoordKey(x: number, z: number): ColumnCoordKey {
  return (x + 1) * COLUMN_COORD_Z_SIZE + (z + COLUMN_COORD_Z_OFFSET);
}

// Callers:
// - src/lib/shapeGeneration.ts
export function parseColumnCoordKey(key: ColumnCoordKey): [number, number] {
  return [Math.floor(key / COLUMN_COORD_Z_SIZE) - 1, (key % COLUMN_COORD_Z_SIZE) - COLUMN_COORD_Z_OFFSET];
}

// Callers:
// - src/lib/shapeBlocksStaircase.ts
export function getCachedColumnPixelInfo(
  colorGrid: ColorGrid,
  cache: ColumnPixelCache,
  x: number,
  excludeWater = false,
): Map<number, ColumnPixelCell> {
  const targetCache = excludeWater ? cache.columnNonWaterPixelsByZ : cache.columnPixelsByZ;
  const cached = targetCache.get(x);
  if (cached) return cached;
  const info = new Map<number, { shade: number; isWater: boolean }>();
  for (let z = 0; z < MAP_SIZE; ++z) {
    const color = colorGrid[x][z];
    if (isTransparentColor(color)) continue;
    if (excludeWater && isWaterColor(color)) continue;
    info.set(z, { shade: color.shade, isWater: isWaterColor(color) });
  }
  targetCache.set(x, info);
  return info;
}

// Callers:
// - src/lib/shapeBlocksStaircase.ts
export function groupBlocksByColumn<T extends PositionedEntry>(blocks: T[]): T[][] {
  const columns = Array.from({ length: MAP_SIZE }, () => [] as T[]);
  for (const block of blocks) columns[block.x].push(block);
  return columns;
}

interface ColumnBlockRows<T extends PositionedEntry> {
  rowBlocks: (T[] | undefined)[];
  rowMinY: number[];
  rowMaxY: number[];
  rowPresent: boolean[];
  zValues: number[];
}

// Callers:
// - src/lib/shapeBlocksStaircase.ts
export function buildColumnBlockRows<T extends PositionedEntry>(colBlocks: T[]): ColumnBlockRows<T> {
  const rowBlocks = new Array<T[] | undefined>(MAP_SIZE + 1);
  const rowMinY = new Array<number>(MAP_SIZE + 1).fill(Infinity);
  const rowMaxY = new Array<number>(MAP_SIZE + 1).fill(-Infinity);
  const rowPresent = new Array<boolean>(MAP_SIZE + 1).fill(false);
  const zValues: number[] = [];

  for (const block of colBlocks) {
    const idx = block.z + 1;
    let row = rowBlocks[idx];
    if (!row) {
      row = [];
      rowBlocks[idx] = row;
      rowPresent[idx] = true;
      zValues.push(block.z);
    }
    row.push(block);
    if (block.y < rowMinY[idx]) rowMinY[idx] = block.y;
    if (block.y > rowMaxY[idx]) rowMaxY[idx] = block.y;
  }

  return { rowBlocks, rowMinY, rowMaxY, rowPresent, zValues };
}

// Callers:
// - src/lib/shapeBlocksStaircase.ts
// - src/lib/shapeGeneration.ts
export function isWaterBlock(block: ShapeBlock): boolean {
  return block.ref.kind === "color" && isWaterColor(block.ref.color);
}

// Callers:
// - src/lib/shapeBlocksStaircase.ts
// - src/lib/shapeGeneration.ts
export function makeFillerBlock(x: number, y: number, z: number, role: FillerRole): ShapeBlock {
  return { x, y, z, ref: { kind: "filler", role } };
}

// Callers:
// - src/lib/shapeBlocksStaircase.ts
// - src/lib/shapeGeneration.ts
export function getWaterDepth(shade: Shade, x: number, z: number): number {
  switch (shade) {
    case Shade.Light:
      return 1;
    case Shade.Flat:
      return getPixelParity(x, z) === PixelParity.Recessive ? 5 : 3;
    case Shade.Dark:
      return getPixelParity(x, z) === PixelParity.Recessive ? 10 : 7;
    default:
      throw new Error(`Unexpected water shade for depth lookup: ${shade}`);
  }
}

// Callers:
// - src/lib/shapeBlocksStaircase.ts
// - src/lib/shapeGeneration.ts
export function getWaterDrop(waterDrops: WaterDrops, shade: Shade): number {
  const waterDrop = (waterDrops as readonly (number | undefined)[])[shade];
  if (waterDrop === undefined) throw new Error(`Unexpected water shade for drop lookup: ${shade}`);
  return waterDrop;
}
