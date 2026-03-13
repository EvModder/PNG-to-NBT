/**
 * Public API:
 * - getSupportedColorAbove()
 * - isWithinShapeBounds()
 * - shouldIncludeFragileSupportCell()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeSubstitution.ts
 */
import { BASE_COLORS } from "../data/mapColors";
import { MAP_SIZE } from "./colorGridTypes";
import { isFragileBlock } from "../data/fragileBlocks";
import { FillerRole, type CustomColor } from "./conversionTypes";
import { normalizeBlockId } from "./blockId";
import { isShapeColorCell, parseShapeCoordKey, toShapeCoordKey, type ShapeColor, type ShapePart } from "./shapeTypes";

function getMappedShapeColorBlockId(
  color: ShapeColor,
  options: { blockMapping: Record<number, string>; customColors: CustomColor[] },
): string | null {
  if (color.isCustom) {
    const block = options.customColors[color.id]?.block ?? "";
    return block ? normalizeBlockId(block) : null;
  }
  const mapped = options.blockMapping[color.id] || BASE_COLORS[color.id].blocks[0] || "";
  return mapped ? normalizeBlockId(mapped) : null;
}

// Callers:
// - src/Index.tsx
export function getSupportedColorAbove(part: ShapePart, coord: number): ShapeColor | null {
  const [x, y, z] = parseShapeCoordKey(coord);
  const above = part.cells.get(toShapeCoordKey(x, y + 1, z));
  return above && isShapeColorCell(above) ? above : null;
}

// Callers:
// - src/Index.tsx
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeSubstitution.ts
export function isWithinShapeBounds(
  candidate: { x: number; y: number; z: number },
  bounds: ShapePart["bounds"],
  assumeFloor: boolean,
): boolean {
  if (candidate.x < 0 || candidate.x >= MAP_SIZE) return false;
  if (candidate.z < bounds.minZ || candidate.z > bounds.maxZ) return false;
  if (assumeFloor && candidate.y < bounds.minY) return false;
  return true;
}

// Callers:
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeSubstitution.ts
export function shouldIncludeFragileSupportCell(
  part: ShapePart,
  coord: number,
  roles: readonly FillerRole[],
  activeRole: FillerRole | null,
  options: { blockMapping: Record<number, string>; customColors: CustomColor[] },
): boolean {
  if (activeRole !== FillerRole.SupportFragile || !roles.includes(FillerRole.SupportFragile)) return true;
  const fragileColor = getSupportedColorAbove(part, coord);
  if (!fragileColor) return false;
  const blockId = getMappedShapeColorBlockId(fragileColor, options);
  return !!blockId && isFragileBlock(blockId);
}
