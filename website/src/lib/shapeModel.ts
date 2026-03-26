/**
 * Public API:
 * - isShapeColorCell()
 * - isShapeFillerCell()
 * - toShapeCoordKey()
 * - parseShapeCoordKey()
 * - getSupportedColorAbove()
 * - NO_SUPPORT_FLOORS
 * - isWithinShapeBounds()
 * - shouldIncludeFragileSupportCell()
 * - FragileSupportOverride
 * - getFragileSupportOverride()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/nbtExport.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeGeneration.ts
 */
import { BASE_COLORS } from "@/data/mapColors";
import { FRAGILE_SUPPORT_RULES, isFragileBlock } from "@/data/fragileBlocks";
import type { ColorRef, ColorRgbCustom } from "@/types/color";
import { FillerRole } from "@/types/conversion";
import { type ShapeCell, type ShapeCoordKey, type ShapePart } from "@/types/shape";
import { MAP_SIZE } from "@/utils/color";
import { normalizeBlockId } from "@/lib/blockId";

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export function isShapeColorCell(cell: ShapeCell): cell is ColorRef {
  return !Array.isArray(cell);
}

// Callers:
// - src/Index.tsx
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export function isShapeFillerCell(cell: ShapeCell): cell is FillerRole[] {
  return Array.isArray(cell);
}

const SHAPE_COORD_Z_OFFSET = 256;
const SHAPE_COORD_Y_OFFSET = 4096;
const SHAPE_COORD_Z_SIZE = 512;
const SHAPE_COORD_Y_SIZE = 8192;

// Callers:
// - src/lib/shapeGeneration.ts
export function toShapeCoordKey(x: number, y: number, z: number): ShapeCoordKey {
  return ((x + 1) * SHAPE_COORD_Y_SIZE + (y + SHAPE_COORD_Y_OFFSET)) * SHAPE_COORD_Z_SIZE + (z + SHAPE_COORD_Z_OFFSET);
}

// Callers:
// - src/Index.tsx
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
export function parseShapeCoordKey(key: ShapeCoordKey): [number, number, number] {
  const z = (key % SHAPE_COORD_Z_SIZE) - SHAPE_COORD_Z_OFFSET;
  const yBlock = Math.floor(key / SHAPE_COORD_Z_SIZE);
  const y = (yBlock % SHAPE_COORD_Y_SIZE) - SHAPE_COORD_Y_OFFSET;
  const x = Math.floor(yBlock / SHAPE_COORD_Y_SIZE) - 1;
  return [x, y, z];
}

function getMappedShapeColorBlockId(
  color: ColorRef,
  options: { blockMapping: Record<number, string>; customColors: ColorRgbCustom[] },
): string | null {
  if (color.isCustom) {
    const block = options.customColors[color.id]?.blocks[0] ?? "";
    return block ? normalizeBlockId(block) : null;
  }
  const mapped = options.blockMapping[color.id] || BASE_COLORS[color.id].blocks[0] || "";
  return mapped ? normalizeBlockId(mapped) : null;
}

// Callers:
// - src/Index.tsx
export function getSupportedColorAbove(part: ShapePart, coord: number): ColorRef | null {
  const [x, y, z] = parseShapeCoordKey(coord);
  const above = part.cells.get(toShapeCoordKey(x, y + 1, z));
  return above && isShapeColorCell(above) ? above : null;
}

// Callers:
// - src/Index.tsx
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export const NO_SUPPORT_FLOORS: ReadonlySet<number> = new Set<number>();

// Callers:
// - src/Index.tsx
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export function isWithinShapeBounds(
  candidate: { x: number; y: number; z: number },
  bounds: ShapePart["bounds"],
  supportFloorYs: ReadonlySet<number>,
): boolean {
  if (candidate.x < 0 || candidate.x >= MAP_SIZE) return false;
  if (candidate.z < bounds.minZ || candidate.z > bounds.maxZ) return false;
  if (supportFloorYs.has(candidate.y)) return false;
  return true;
}

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export function shouldIncludeFragileSupportCell(
  part: ShapePart,
  coord: number,
  roles: readonly FillerRole[],
  activeRole: FillerRole | null,
  options: { blockMapping: Record<number, string>; customColors: ColorRgbCustom[] },
): boolean {
  if (activeRole !== FillerRole.SupportFragile || !roles.includes(FillerRole.SupportFragile)) return true;
  const fragileColor = getSupportedColorAbove(part, coord);
  if (!fragileColor) return false;
  const blockId = getMappedShapeColorBlockId(fragileColor, options);
  return !!blockId && isFragileBlock(blockId);
}

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export interface FragileSupportOverride {
  blockId: string;
  replacementBlockId: string;
}

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export function getFragileSupportOverride(
  part: ShapePart,
  coord: number,
  activeRole: FillerRole | null,
  assignedSupportBlock: string | null,
  options: { blockMapping: Record<number, string>; customColors: ColorRgbCustom[] },
): FragileSupportOverride | null {
  if (
    activeRole !== FillerRole.SupportAll &&
    activeRole !== FillerRole.SupportFragile &&
    activeRole !== FillerRole.StairStep &&
    activeRole !== FillerRole.SupportWaterSidesCovered
  ) return null;
  const supportedColor = getSupportedColorAbove(part, coord);
  if (!supportedColor) return null;
  const blockId = getMappedShapeColorBlockId(supportedColor, options);
  if (!blockId) return null;
  const rule = FRAGILE_SUPPORT_RULES.get(blockId);
  if (!rule) return null;
  const normalizedAssignedSupportBlock = assignedSupportBlock ? normalizeBlockId(assignedSupportBlock) : "";
  if (normalizedAssignedSupportBlock && rule.validSupportBlocks.includes(normalizedAssignedSupportBlock)) {
    return null;
  }
  return { blockId, replacementBlockId: rule.replacementBlock };
}
