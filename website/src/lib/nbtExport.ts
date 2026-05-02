/**
 * Public API:
 * - convertToNbt()
 * - convertToNbtEntries()
 *
 * Callers:
 * - src/Index.tsx
 * - tests/run.mts
 */
import { MAP_SIZE } from "@/utils/color";
import type { ColorRef } from "@/types/color";
import type { GeneratedShape, ShapePart } from "@/types/shape";
import { buildFillerAssignmentMap, resolveAssignedFillerName } from "./fillerRules";
import { type ColorBlockSelections, resolveExportBlockName, resolveShapeColorBlockName } from "./blockId";
import { type BlockEntry, gzipCompress, writeStructureNbt } from "@/utils/nbtWriter";
import { createZip } from "@/utils/zip";
import { BuildMode, SuppressStepDirection, type FillerAssignment } from "@/types/conversion";
import { WATER_BASE_INDEX } from "@/data/mapColors";
import { isSuppressBuildMode } from "@/utils/conversion";
import {
  isShapeColorCell,
  isShapeFillerCell,
  isWithinShapeBounds,
  NO_SUPPORT_FLOORS,
  parseShapeCoordKey,
  shouldIncludeFragileSupportCell,
  getFragileSupportOverride,
} from "./shapeModel";
import { buildSuppressLoadSpotMarkers } from "./suppressLoadMarkers";

interface ExportOptions extends ColorBlockSelections {
  fillerAssignments: FillerAssignment[];
  applySupportFloorYs: boolean;
  forceXZ128?: boolean;
  forceZ129?: boolean;
  xColumnRange?: [number, number];
  phaseRange?: [number, number];
  baseName: string;
  buildMode: BuildMode;
  suppressStepDirection: SuppressStepDirection;
  markSuppressLoadSpotsInSchematic?: boolean;
  suppressLoadSpotMarkerBlock?: string;
}

// Callers:
// - src/Index.tsx
export interface NbtExportEntry {
  name: string;
  data: Uint8Array;
}

type ExportBoundsOptions = Pick<
  ExportOptions,
  "buildMode" | "suppressStepDirection" | "markSuppressLoadSpotsInSchematic" | "forceXZ128" | "forceZ129"
>;

function getLoadMarkerDistance(options: ExportBoundsOptions): number {
  if (!options.markSuppressLoadSpotsInSchematic) return 0;
  if (options.buildMode === BuildMode.SuppressStepPairs) return 127;
  if (options.buildMode === BuildMode.SuppressStepChecker) return 126;
  if (!isSuppressBuildMode(options.buildMode)) return 127;
  return 0;
}

function validateExportHorizontalBounds(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  options: ExportBoundsOptions,
): void {
  const loadMarkerDistance = getLoadMarkerDistance(options);
  const extendsX =
    loadMarkerDistance > 0 &&
    (options.suppressStepDirection === SuppressStepDirection.EastToWest ||
      options.suppressStepDirection === SuppressStepDirection.WestToEast);
  const extendsZ =
    loadMarkerDistance > 0 &&
    (options.suppressStepDirection === SuppressStepDirection.NorthToSouth ||
      options.suppressStepDirection === SuppressStepDirection.SouthToNorth);
  const minExpectedX = extendsX ? -loadMarkerDistance : 0;
  const maxExpectedX = extendsX ? MAP_SIZE - 1 + loadMarkerDistance : MAP_SIZE - 1;
  const minExpectedZ = extendsZ ? -loadMarkerDistance : -1;
  const maxExpectedZ = extendsZ ? MAP_SIZE - 1 + loadMarkerDistance : MAP_SIZE - 1;

  if (minX < minExpectedX || maxX > maxExpectedX) {
    throw new Error(`Invalid shape x range during export: [${minX}, ${maxX}] (expected within [${minExpectedX}, ${maxExpectedX}])`);
  }
  if (minZ < minExpectedZ || maxZ > maxExpectedZ) {
    throw new Error(`Invalid shape z range during export: [${minZ}, ${maxZ}] (expected within [${minExpectedZ}, ${maxExpectedZ}])`);
  }
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

function normalizeAndMeasure(
  blocks: BlockEntry[],
  options: Pick<ExportOptions, "buildMode" | "suppressStepDirection" | "markSuppressLoadSpotsInSchematic" | "forceXZ128" | "forceZ129">,
): { sizeX: number; sizeY: number; sizeZ: number } {
  const forceXZ128 = options.forceXZ128 !== false;
  const forceZ129 = options.forceZ129 === true;
  if (blocks.length === 0) {
    return {
      sizeX: MAP_SIZE,
      sizeY: 1,
      sizeZ: forceZ129 ? MAP_SIZE + 1 : MAP_SIZE,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const block of blocks) {
    if (block.x < minX) minX = block.x;
    if (block.x > maxX) maxX = block.x;
    if (block.y < minY) minY = block.y;
    if (block.y > maxY) maxY = block.y;
    if (block.z < minZ) minZ = block.z;
    if (block.z > maxZ) maxZ = block.z;
  }
  validateExportHorizontalBounds(minX, maxX, minZ, maxZ, options);
  const normalizedMinX = forceXZ128 ? Math.min(minX, 0) : minX;
  const normalizedMaxX = forceXZ128 ? Math.max(maxX, MAP_SIZE - 1) : maxX;
  const normalizedMinZ = forceXZ128 || forceZ129 ? Math.min(minZ, forceZ129 ? -1 : 0) : minZ;
  const normalizedMaxZ = forceXZ128 || forceZ129 ? Math.max(maxZ, MAP_SIZE - 1) : maxZ;
  const xShift = -normalizedMinX;
  const zShift = -normalizedMinZ;

  for (const block of blocks) {
    block.x += xShift;
    block.y -= minY;
    block.z += zShift;
  }

  return {
    sizeX: normalizedMaxX - normalizedMinX + 1,
    sizeY: maxY - minY + 1,
    sizeZ: normalizedMaxZ - normalizedMinZ + 1,
  };
}

async function buildSplitEntries(
  parts: BlockEntry[][],
  options: ExportOptions,
  names: [string, string],
): Promise<NbtExportEntry[]> {
  const toNbt = async (blocks: BlockEntry[]) => {
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options);
    return gzipCompress(writeStructureNbt(blocks, sizeX, sizeY, sizeZ));
  };

  const [firstData, secondData] = await Promise.all([toNbt(parts[0] ?? []), toNbt(parts[1] ?? [])]);
  return [
    { name: `${options.baseName}-${names[0]}.nbt`, data: firstData },
    { name: `${options.baseName}-${names[1]}.nbt`, data: secondData },
  ];
}

async function buildSingleEntry(
  shape: GeneratedShape,
  parts: BlockEntry[][],
  options: ExportOptions,
): Promise<NbtExportEntry> {
  const blocks = parts.flat();
  for (const marker of buildSuppressLoadSpotMarkers(
    shape,
    options.buildMode,
    options.suppressStepDirection,
    {
      markSuppressLoadSpotsInSchematic: options.markSuppressLoadSpotsInSchematic,
      suppressLoadSpotMarkerBlock: options.suppressLoadSpotMarkerBlock,
    },
  )) {
    blocks.push(marker);
  }
  const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options);
  return {
    name: `${options.baseName}.nbt`,
    data: await gzipCompress(writeStructureNbt(blocks, sizeX, sizeY, sizeZ)),
  };
}

// Callers:
// - src/Index.tsx
export async function convertToNbtEntries(
  shape: GeneratedShape,
  options: ExportOptions,
): Promise<NbtExportEntry[]> {
  const parts = materializeShapeParts(shape, options);
  if (shape.splitExportNames) return buildSplitEntries(parts, options, shape.splitExportNames);
  return [await buildSingleEntry(shape, parts, options)];
}

// Callers:
// - src/Index.tsx
export async function convertToNbt(
  shape: GeneratedShape,
  options: ExportOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const entries = await convertToNbtEntries(shape, options);
  if (entries.length === 1) return { data: entries[0].data, isZip: false };
  return { data: createZip(entries), isZip: true };
}
