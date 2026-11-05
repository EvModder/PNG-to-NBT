/**
 * Public API:
 * - isShapeColorCell()
 * - isShapeFillerCell()
 * - toShapeCoordKey()
 * - parseShapeCoordKey()
 * - NO_SUPPORT_FLOORS
 * - isWithinShapeBounds()
 * - shouldIncludeFragileSupportCell()
 * - resolveShapeFiller()
 * - resolveShapeBlockName()
 *
 * Callers:
 * - src/lib/nbtExport.ts
 * - src/lib/placementWarnings.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeBlocksStaircase.ts
 * - src/lib/shapeBlocksSuppress.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/suppressClearance.ts
 * - src/lib/suppressLoadMarkers.ts
 */
import { FRAGILE_SUPPORT_RULES, isFragileBlock } from "@/data/blockFragility";
import { MINECRAFT_VERSIONS } from "@/data/minecraftVersions";
import { DEFAULT_CORAL_SUPPORT_BLOCK, DEFAULT_SUPPORT_FILLER_BLOCK } from "@/data/defaultSettings";
import { canSupportBlock } from "./blockSupport";
import { isCoralSupportValid, resolveAssignedFillerName } from "@/lib/fillerRules";
import { FillerRole } from "@/types/conversion";
import { type ShapeCell, type ShapeColorRef, type ShapeCoordKey, type ShapePart } from "@/types/shape";
import { MAP_SIZE } from "@/utils/color";
import { normalizeBlockId, resolveAssignedColorBlock, resolveExportBlockName, resolveShapeColorBlockName, type ColorBlockSelections } from "@/lib/blockId";

// Resolve actual exports, including omitted floors, optional supports and soil overrides.
// Callers:
// - src/lib/placementWarnings.ts
export function resolveShapeBlockName(
  part: ShapePart, coord: number, selections: ColorBlockSelections,
  fillers: Map<FillerRole, string>, assumeFloor: boolean,
): string {
  const cell = part.cells.get(coord);
  if (!cell) return "";
  if (isShapeColorCell(cell)) return resolveShapeColorBlockName(cell, selections, fillers) ?? "";
  const [x, y, z] = parseShapeCoordKey(coord);
  if (!isWithinShapeBounds({ x, y, z }, part.bounds, assumeFloor ? part.supportFloorYs : NO_SUPPORT_FLOORS)) return "";
  return resolveShapeFiller(part, coord, cell, selections, fillers)?.blockName ?? "";
}

const SUBSTITUTABLE_SUPPORTS = new Set([FillerRole.SupportAll, FillerRole.SupportFragile, FillerRole.StairStep, FillerRole.SupportWaterSidesCovered]);

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/placementWarnings.ts
// - src/lib/shapeAnalysis.ts
export function resolveShapeFiller(
  part: ShapePart,
  coord: number,
  roles: readonly FillerRole[],
  options: ColorBlockSelections,
  assignments: Map<FillerRole, string>,
): { role: FillerRole; blockName: string | null; constrainedBlock: string | null } | null {
  // Looked up at most once: what a support here holds up.
  let above: string | null | undefined;
  const supported = () => above === undefined ? above = getSupportedBlockAbove(part, coord, options, assignments) : above;
  let role: FillerRole | undefined;
  let blockName: string | null = null;
  // First placed assignment wins. If none place a block, retain the first unfilled requirement.
  for (const candidate of assignments.keys()) {
    if (!roles.includes(candidate)) continue;
    // Fragile-only supports go under fragile blocks.
    if (candidate === FillerRole.SupportFragile && !isFragileBlock(supported() ?? "")) continue;
    const name = resolveAssignedFillerName(assignments, candidate);
    if (name) {
      role = candidate;
      blockName = name;
      break;
    }
    role ??= candidate;
  }
  if (role === undefined) return null;
  const coral = role === FillerRole.CoralSupport || role === FillerRole.StairStep && roles.includes(FillerRole.CoralSupport);
  if (options.autoPickSupports && coral && (!blockName || !isCoralSupportValid(blockName))) {
    role = FillerRole.CoralSupport;
    blockName = resolveExportBlockName(DEFAULT_CORAL_SUPPORT_BLOCK);
  }
  // CrubTech and shading roles keep their own assignments.
  const held = SUBSTITUTABLE_SUPPORTS.has(role) ? supported() : null;
  const constrainedBlock = held && isFragileBlock(held) ? normalizeBlockId(held) : null;
  if (options.autoPickSupports && held && constrainedBlock) {
    const version = options.minecraftVersion && MINECRAFT_VERSIONS[options.minecraftVersion].dataVersion;
    if (!blockName || !canSupportBlock(blockName, held, version)) {
      const replacement = FRAGILE_SUPPORT_RULES.get(constrainedBlock)?.replacementBlock ?? DEFAULT_SUPPORT_FILLER_BLOCK;
      if (canSupportBlock(replacement, held, version)) blockName = resolveExportBlockName(replacement);
    }
  }
  return { role, blockName, constrainedBlock };
}

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/placementWarnings.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/suppressLoadMarkers.ts
export function isShapeColorCell(cell: ShapeCell): cell is ShapeColorRef {
  return !Array.isArray(cell);
}

// Callers:
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
// - src/lib/nbtExport.ts
// - src/lib/placementWarnings.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeBlocksStaircase.ts
// - src/lib/shapeBlocksSuppress.ts
// - src/lib/shapeGeneration.ts
// - src/lib/suppressClearance.ts
export function toShapeCoordKey(x: number, y: number, z: number): ShapeCoordKey {
  return ((x + 1) * SHAPE_COORD_Y_SIZE + (y + SHAPE_COORD_Y_OFFSET)) * SHAPE_COORD_Z_SIZE + (z + SHAPE_COORD_Z_OFFSET);
}

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/placementWarnings.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeBlocksSuppress.ts
// - src/lib/shapeGeneration.ts
// - src/lib/suppressLoadMarkers.ts
export function parseShapeCoordKey(key: ShapeCoordKey): [number, number, number] {
  const z = (key % SHAPE_COORD_Z_SIZE) - SHAPE_COORD_Z_OFFSET;
  const yBlock = Math.floor(key / SHAPE_COORD_Z_SIZE);
  const y = (yBlock % SHAPE_COORD_Y_SIZE) - SHAPE_COORD_Y_OFFSET;
  const x = Math.floor(yBlock / SHAPE_COORD_Y_SIZE) - 1;
  return [x, y, z];
}

function getSupportedBlockAbove(
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
    return block || null;
  }
  // Assignment order also determines which filler wins during export.
  for (const role of fillerAssignments.keys()) {
    if (!above.includes(role)) continue;
    const block = resolveAssignedFillerName(fillerAssignments, role);
    if (block) return block;
  }
  return null;
}

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export const NO_SUPPORT_FLOORS: ReadonlySet<number> = new Set<number>();

// Callers:
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
  const blockId = getSupportedBlockAbove(part, coord, options, fillerAssignments);
  return !!blockId && isFragileBlock(blockId);
}
