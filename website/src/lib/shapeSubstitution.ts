/**
 * Public API:
 * - materializeShapeParts()
 * - normalizeAndMeasure()
 *
 * Used by:
 * - src/lib/nbtExport.ts
 */
import { MAP_SIZE } from "./colorGridTypes";
import type { BlockEntry } from "./nbtWriter";
import { type SubstitutionOptions } from "./conversionTypes";
import { buildFillerAssignmentMap, resolveAssignedFillerName } from "./fillerRules";
import { resolveShapeColorBlockName } from "./materialRules";
import type { GeneratedShape } from "./shapeGeneration";
import { isShapeColorCell, isShapeFillerCell, parseShapeCoordKey, type ShapePart } from "./shapeTypes";
import { isWithinShapeBounds, shouldIncludeFragileSupportCell } from "./shapeCellRules";

function materializePart(part: ShapePart, options: SubstitutionOptions): BlockEntry[] {
  const resolved: BlockEntry[] = [];
  const occupied = new Set<number>();
  const fillerAssignments = buildFillerAssignmentMap(options.fillerAssignments);

  for (const [coord, cell] of part.cells) {
    if (!isShapeColorCell(cell)) continue;
    const [x, y, z] = parseShapeCoordKey(coord);
    const blockName = resolveShapeColorBlockName(cell, options);
    if (!blockName) continue;
    resolved.push({ x, y, z, blockName });
    occupied.add(coord);
  }

  if (options.fillerAssignments.length === 0) return resolved;

  for (const assignment of options.fillerAssignments) {
    const fillerName = resolveAssignedFillerName(fillerAssignments, assignment.role);
    if (!fillerName) continue;
    for (const [coord, cell] of part.cells) {
      if (!isShapeFillerCell(cell) || !cell.includes(assignment.role)) continue;
      const [x, y, z] = parseShapeCoordKey(coord);
      if (!shouldIncludeFragileSupportCell(part, coord, cell, options)) continue;
      if (!isWithinShapeBounds({ x, y, z }, part.bounds, options.assumeFloor)) continue;
      if (occupied.has(coord)) continue;
      resolved.push({ x, y, z, blockName: fillerName });
      occupied.add(coord);
    }
  }

  return resolved;
}

export function normalizeAndMeasure(blocks: BlockEntry[], forceZ129 = false): { sizeX: number; sizeY: number; sizeZ: number } {
  if (blocks.length === 0) return { sizeX: MAP_SIZE, sizeY: 1, sizeZ: forceZ129 ? MAP_SIZE + 1 : MAP_SIZE };

  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const block of blocks) {
    if (block.y < minY) minY = block.y;
    if (block.y > maxY) maxY = block.y;
    if (block.z < minZ) minZ = block.z;
    if (block.z > maxZ) maxZ = block.z;
  }

  if (minZ < -1 || maxZ >= MAP_SIZE) {
    throw new Error(`Invalid shape z range during export: [${minZ}, ${maxZ}]`);
  }

  for (const block of blocks) {
    block.y -= minY;
    if (minZ < 0 || forceZ129) block.z += 1;
  }

  return {
    sizeX: MAP_SIZE,
    sizeY: maxY - minY + 1,
    sizeZ: minZ < 0 || forceZ129 ? MAP_SIZE + 1 : MAP_SIZE,
  };
}

export function materializeShapeParts(shape: GeneratedShape, options: SubstitutionOptions): BlockEntry[][] {
  return shape.parts.map(part => materializePart(part, options));
}
