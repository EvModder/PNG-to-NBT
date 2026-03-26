/**
 * Public API:
 * - convertToNbt()
 *
 * Callers:
 * - src/Index.tsx
 */
import { MAP_SIZE } from "@/utils/color";
import type { ColorRef, ColorRgbCustom } from "@/types/color";
import type { GeneratedShape, ShapePart } from "@/types/shape";
import { buildFillerAssignmentMap, resolveAssignedFillerName } from "./fillerRules";
import { resolveExportBlockName, resolveShapeColorBlockName } from "./blockId";
import { type BlockEntry, gzipCompress, writeStructureNbt } from "@/utils/nbtWriter";
import { createZip } from "@/utils/zip";
import type { FillerAssignment } from "@/types/conversion";
import { WATER_BASE_INDEX } from "@/data/mapColors";
import {
  isShapeColorCell,
  isShapeFillerCell,
  isWithinShapeBounds,
  NO_SUPPORT_FLOORS,
  parseShapeCoordKey,
  shouldIncludeFragileSupportCell,
  getFragileSupportOverride,
} from "./shapeModel";

interface ExportOptions {
  blockMapping: Record<number, string>;
  fillerAssignments: FillerAssignment[];
  applySupportFloorYs: boolean;
  forceZ129?: boolean;
  customColors: ColorRgbCustom[];
  xColumnRange?: [number, number];
  phaseRange?: [number, number];
  baseName: string;
}

function getWaterColumnTopY(part: ShapePart): Map<string, number> {
  const topYByColumn = new Map<string, number>();

  for (const [coord, cell] of part.cells) {
    if (!isShapeColorCell(cell) || cell.isCustom || cell.id !== WATER_BASE_INDEX) continue;
    const [x, y, z] = parseShapeCoordKey(coord);
    const columnKey = `${x},${z}`;
    const currentTopY = topYByColumn.get(columnKey);
    if (currentTopY === undefined || y > currentTopY) topYByColumn.set(columnKey, y);
  }

  return topYByColumn;
}

function resolveExportShapeColorBlockName(
  color: ColorRef,
  x: number,
  y: number,
  z: number,
  waterTopYByColumn: ReadonlyMap<string, number>,
  options: ExportOptions,
): string | null {
  const blockName = resolveShapeColorBlockName(color, options);
  if (!blockName) return null;
  if (color.isCustom || color.id !== WATER_BASE_INDEX) return blockName;

  const waterTopY = waterTopYByColumn.get(`${x},${z}`);
  if (waterTopY === undefined || y >= waterTopY) return blockName;

  const blockBaseName = blockName.split("[", 1)[0];
  return blockBaseName === "minecraft:water" ? "minecraft:water[level=8]" : blockName;
}

function materializePart(part: ShapePart, options: ExportOptions, supportFloorYs: ReadonlySet<number>): BlockEntry[] {
  const resolved: BlockEntry[] = [];
  const occupied = new Set<number>();
  const fillerAssignments = buildFillerAssignmentMap(options.fillerAssignments);
  const waterTopYByColumn = getWaterColumnTopY(part);

  for (const [coord, cell] of part.cells) {
    if (!isShapeColorCell(cell)) continue;
    const [x, y, z] = parseShapeCoordKey(coord);
    const blockName = resolveExportShapeColorBlockName(cell, x, y, z, waterTopYByColumn, options);
    if (!blockName) continue;
    resolved.push({ x, y, z, blockName });
    occupied.add(coord);
  }

  if (options.fillerAssignments.length === 0) return resolved;

  for (const assignment of options.fillerAssignments) {
    const fillerName = resolveAssignedFillerName(fillerAssignments, assignment.role);
    for (const [coord, cell] of part.cells) {
      if (!isShapeFillerCell(cell) || !cell.includes(assignment.role)) continue;
      const [x, y, z] = parseShapeCoordKey(coord);
      if (!shouldIncludeFragileSupportCell(part, coord, cell, assignment.role, options)) continue;
      if (!isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs)) continue;
      if (occupied.has(coord)) continue;
      const assignedSupportBlock = fillerAssignments.get(assignment.role) ?? null;
      const override = getFragileSupportOverride(part, coord, assignment.role, assignedSupportBlock, options);
      const blockName = override ? resolveExportBlockName(override.replacementBlockId) : fillerName;
      if (!blockName) continue;
      resolved.push({ x, y, z, blockName });
      occupied.add(coord);
    }
  }

  return resolved;
}

function materializeShapeParts(shape: GeneratedShape, options: ExportOptions): BlockEntry[][] {
  return shape.parts.map(part =>
    materializePart(part, options, options.applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS),
  );
}

function normalizeAndMeasure(blocks: BlockEntry[], forceZ129 = false): { sizeX: number; sizeY: number; sizeZ: number } {
  if (blocks.length === 0) return { sizeX: MAP_SIZE, sizeY: 1, sizeZ: forceZ129 ? MAP_SIZE + 1 : MAP_SIZE };

  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
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

async function buildSplitZip(
  parts: BlockEntry[][],
  options: ExportOptions,
  names: [string, string],
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const toNbt = async (blocks: BlockEntry[]) => {
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options.forceZ129 === true);
    return gzipCompress(writeStructureNbt(blocks, sizeX, sizeY, sizeZ));
  };

  const [firstData, secondData] = await Promise.all([toNbt(parts[0] ?? []), toNbt(parts[1] ?? [])]);
  const zipEntries = [
    { name: `${options.baseName}-${names[0]}.nbt`, data: firstData },
    { name: `${options.baseName}-${names[1]}.nbt`, data: secondData },
  ];
  return { data: createZip(zipEntries), isZip: true };
}

// Callers:
// - src/Index.tsx
export async function convertToNbt(
  shape: GeneratedShape,
  options: ExportOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const parts = materializeShapeParts(shape, options);
  if (shape.splitExportNames) return buildSplitZip(parts, options, shape.splitExportNames);

  const blocks = parts.flat();
  const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options.forceZ129 === true);
  return { data: await gzipCompress(writeStructureNbt(blocks, sizeX, sizeY, sizeZ)), isZip: false };
}
