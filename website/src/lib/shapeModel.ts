/**
 * Public API:
 * - isShapeColorCell()
 * - isShapeFillerCell()
 * - toShapeCoordKey()
 * - parseShapeCoordKey()
 * - getSupportedBlockIdAbove()
 * - NO_SUPPORT_FLOORS
 * - isWithinShapeBounds()
 * - shouldIncludeFragileSupportCell()
 * - FragileSupportOverride
 * - getFragileSupportOverride()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/nbtExport.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/suppressClearance.ts
 * - src/lib/suppressLoadMarkers.ts
 */
import { isFragileBlock } from "@/data/fragileBlocks";
import { getVersionedSupportRules } from "@/lib/minecraftVersion";
import { resolveAssignedFillerName } from "@/lib/fillerRules";
import { FillerRole } from "@/types/conversion";
import { type ShapeCell, type ShapeColorRef, type ShapeCoordKey, type ShapePart } from "@/types/shape";
import { MAP_SIZE } from "@/utils/color";
import { normalizeBlockId, resolveAssignedColorBlock, type ColorBlockSelections } from "@/lib/blockId";

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/suppressLoadMarkers.ts
export function isShapeColorCell(cell: ShapeCell): cell is ShapeColorRef {
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
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
// - src/lib/suppressClearance.ts
export function toShapeCoordKey(x: number, y: number, z: number): ShapeCoordKey {
  return ((x + 1) * SHAPE_COORD_Y_SIZE + (y + SHAPE_COORD_Y_OFFSET)) * SHAPE_COORD_Z_SIZE + (z + SHAPE_COORD_Z_OFFSET);
}

// Callers:
// - src/Index.tsx
// - src/lib/nbtExport.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
// - src/lib/suppressLoadMarkers.ts
export function parseShapeCoordKey(key: ShapeCoordKey): [number, number, number] {
  const z = (key % SHAPE_COORD_Z_SIZE) - SHAPE_COORD_Z_OFFSET;
  const yBlock = Math.floor(key / SHAPE_COORD_Z_SIZE);
  const y = (yBlock % SHAPE_COORD_Y_SIZE) - SHAPE_COORD_Y_OFFSET;
  const x = Math.floor(yBlock / SHAPE_COORD_Y_SIZE) - 1;
  return [x, y, z];
}

// Callers:
// - src/Index.tsx
export function getSupportedBlockIdAbove(
  part: ShapePart,
  coord: number,
  options: ColorBlockSelections,
  fillerAssignments: Map<FillerRole, string>,
): string | null {
  // One Y step spans the packed Z range; no coordinate decoding is needed.
  const above = part.cells.get(coord + SHAPE_COORD_Z_SIZE);
  if (!above) return null;
  if (isShapeColorCell(above)) {
    const block = above.fillerRole ? resolveAssignedFillerName(fillerAssignments, above.fillerRole) : resolveAssignedColorBlock(above, options);
    return block ? normalizeBlockId(block) : null;
  }
  // Assignment order also determines which filler wins during export.
  for (const role of fillerAssignments.keys()) {
    if (!above.includes(role)) continue;
    const block = resolveAssignedFillerName(fillerAssignments, role);
    if (block) return normalizeBlockId(block);
  }
  return null;
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
  options: ColorBlockSelections,
  fillerAssignments: Map<FillerRole, string>,
): boolean {
  if (activeRole !== FillerRole.SupportFragile || !roles.includes(FillerRole.SupportFragile)) return true;
  const blockId = getSupportedBlockIdAbove(part, coord, options, fillerAssignments);
  return !!blockId && isFragileBlock(blockId);
}

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
  assignedSupportBlockName: string | null,
  options: ColorBlockSelections,
  fillerAssignments: Map<FillerRole, string>,
): FragileSupportOverride | null {
  // CrubTech supports must retain their piston-specific block assignments.
  if (
    activeRole !== FillerRole.SupportAll &&
    activeRole !== FillerRole.SupportFragile &&
    activeRole !== FillerRole.StairStep &&
    activeRole !== FillerRole.SupportWaterSidesCovered
  ) return null;
  const fragileBlockId = getSupportedBlockIdAbove(part, coord, options, fillerAssignments);
  if (!fragileBlockId) return null;
  const fragileSupportRule = getVersionedSupportRules(options.minecraftVersion).get(fragileBlockId);
  if (!fragileSupportRule) return null;
  const assignedSupportBlockId = assignedSupportBlockName ? normalizeBlockId(assignedSupportBlockName) : "";
  if (assignedSupportBlockId && fragileSupportRule.validSupportBlocks.includes(assignedSupportBlockId)) {
    return null;
  }
  return { blockId: fragileBlockId, replacementBlockId: fragileSupportRule.replacementBlock };
}
