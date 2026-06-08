/**
 * Public API:
 * - convertToNbt()
 * - convertToNbtEntries()
 *
 * Callers:
 * - src/Index.tsx
 * - tests/run.mts
 * - tests/invariants.mts
 */
import { MAP_SIZE } from "@/utils/color";
import { DEFAULT_NBT_AUTHOR } from "@/data/defaultSettings";
import type { ColorRef } from "@/types/color";
import type { GeneratedShape, ShapePart } from "@/types/shape";
import { buildFillerAssignmentMap, resolveAssignedFillerName } from "./fillerRules";
import { type ColorBlockSelections, resolveExportBlockName, resolveShapeColorBlockName } from "./blockId";
import { gzipCompress, writeStructureNbt } from "@/utils/nbtWriter";
import { createZip } from "@/utils/zip";
import { BuildMode, FillerRole, SuppressStepDirection, type FillerAssignment } from "@/types/conversion";
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
  collapseDuplicatePaletteStates?: boolean;
  forceXZ128?: boolean;
  forceZ129?: boolean;
  xColumnRange?: [number, number];
  phaseRange?: [number, number];
  baseName: string;
  buildMode: BuildMode;
  suppressStepDirection: SuppressStepDirection;
  suppress2LayerLatePairY?: number;
  crubTech?: boolean;
  markSuppressLoadSpotsInSchematic?: boolean;
  suppressLoadSpotMarkerBlock?: string;
}

type ExportPaletteRole = "visible" | "convenience" | "shading" | "vs_filler" | "support";
const EXPORT_PALETTE_ROLE_ORDER = ["visible", "shading", "vs_filler", "support", "convenience"] as const;

interface PaletteIndexedBlock {
  x: number;
  y: number;
  z: number;
  state: number;
}

interface PaletteSourceBlock {
  x: number;
  y: number;
  z: number;
  blockName: string;
  paletteRole?: ExportPaletteRole;
}

function comparePaletteSourceBlocks(left: PaletteSourceBlock, right: PaletteSourceBlock): number {
  if (left.x !== right.x) return left.x - right.x;
  if (left.z !== right.z) return left.z - right.z;
  return right.y - left.y;
}

function getExportPaletteRoleForFiller(role: FillerRole): ExportPaletteRole {
  switch (role) {
    case FillerRole.StairStep:
    case FillerRole.WaterPath:
      return "convenience";
    case FillerRole.ShadeNorthRow:
    case FillerRole.ShadeNorthRowBreakable:
    case FillerRole.ShadeNorthRowPushable:
    case FillerRole.ShadeSuppress:
    case FillerRole.ShadeSuppressBreakable:
    case FillerRole.ShadeSuppressPushable:
    case FillerRole.ShadeSuppressLate:
      return "shading";
    case FillerRole.ShadeVoidDominant:
    case FillerRole.ShadeVoidRecessive:
      return "vs_filler";
    case FillerRole.SupportAll:
    case FillerRole.SupportFragile:
    case FillerRole.SupportWaterBase:
    case FillerRole.SupportWaterSides:
    case FillerRole.SupportWaterSidesCovered:
      return "support";
  }
  const exhaustiveCheck: never = role;
  return exhaustiveCheck;
}

function buildStructurePaletteStateEntries(
  blocks: readonly PaletteSourceBlock[],
  collapseDuplicatePaletteStates: boolean,
): { paletteBlockIds: string[]; stateBlocks: PaletteIndexedBlock[] } {
  const paletteBlockIds: string[] = [];
  const blockIndexesByRole: Record<ExportPaletteRole, number[]> = {
    visible: [],
    convenience: [],
    shading: [],
    vs_filler: [],
    support: [],
  };
  const stateByBlockIndex = new Array<number>(blocks.length);
  const sharedPaletteIndexByBlockName = collapseDuplicatePaletteStates ? new Map<string, number>() : null;

  for (let index = 0; index < blocks.length; index += 1) {
    blockIndexesByRole[blocks[index].paletteRole ?? "visible"].push(index);
  }

  for (const paletteRole of EXPORT_PALETTE_ROLE_ORDER) {
    const paletteIndexByBlockName = sharedPaletteIndexByBlockName ?? new Map<string, number>();
    for (const blockIndex of blockIndexesByRole[paletteRole]) {
      const blockName = blocks[blockIndex].blockName;
      let state = paletteIndexByBlockName.get(blockName);
      if (state === undefined) {
        state = paletteBlockIds.length;
        paletteIndexByBlockName.set(blockName, state);
        paletteBlockIds.push(blockName);
      }
      stateByBlockIndex[blockIndex] = state;
    }
  }

  return {
    paletteBlockIds,
    stateBlocks: blocks.map((block, index) => ({
      x: block.x,
      y: block.y,
      z: block.z,
      state: stateByBlockIndex[index]!,
    })),
  };
}

interface NbtExportEntry {
  name: string;
  data: Uint8Array;
}

type ExportBoundsOptions = Pick<
  ExportOptions,
  "buildMode" | "suppressStepDirection" | "markSuppressLoadSpotsInSchematic" | "crubTech" | "forceXZ128" | "forceZ129"
>;

function hasCrubTechPauseMarkers(options: ExportBoundsOptions): boolean {
  return options.crubTech === true &&
    options.buildMode === BuildMode.Suppress2LayerLatePairs;
}

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
  const maxExpectedZ = Math.max(
    extendsZ ? MAP_SIZE - 1 + loadMarkerDistance : MAP_SIZE - 1,
    hasCrubTechPauseMarkers(options) ? MAP_SIZE : MAP_SIZE - 1,
  );

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

function materializePart(part: ShapePart, options: ExportOptions, supportFloorYs: ReadonlySet<number>): PaletteSourceBlock[] {
  const resolved: PaletteSourceBlock[] = [];
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
      resolved.push({ x, y, z, blockName, paletteRole: getExportPaletteRoleForFiller(assignment.role) });
      occupied.add(coord);
    }
  }

  return resolved.toSorted(comparePaletteSourceBlocks);
}

function normalizeAndMeasure<T extends { x: number; y: number; z: number }>(
  blocks: T[],
  options: ExportBoundsOptions,
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

async function writeExportBlocksToNbt(
  blocks: PaletteSourceBlock[],
  options: ExportOptions,
): Promise<Uint8Array> {
  const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options);
  const { paletteBlockIds, stateBlocks } = buildStructurePaletteStateEntries(
    blocks,
    options.collapseDuplicatePaletteStates !== false,
  );
  return gzipCompress(writeStructureNbt(stateBlocks, paletteBlockIds, sizeX, sizeY, sizeZ, DEFAULT_NBT_AUTHOR));
}

async function buildSplitEntries(
  parts: PaletteSourceBlock[][],
  options: ExportOptions,
  names: [string, string],
): Promise<NbtExportEntry[]> {
  const [firstData, secondData] = await Promise.all([
    writeExportBlocksToNbt(parts[0] ?? [], options),
    writeExportBlocksToNbt(parts[1] ?? [], options),
  ]);
  return [
    { name: `${options.baseName}-${names[0]}.nbt`, data: firstData },
    { name: `${options.baseName}-${names[1]}.nbt`, data: secondData },
  ];
}

async function buildSingleEntry(
  shape: GeneratedShape,
  parts: PaletteSourceBlock[][],
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
      crubTech: options.crubTech,
      suppress2LayerLatePairY: options.suppress2LayerLatePairY,
    },
  )) {
    blocks.push(marker);
  }
  return {
    name: `${options.baseName}.nbt`,
    data: await writeExportBlocksToNbt(blocks, options),
  };
}

// Callers:
// - src/Index.tsx
export async function convertToNbtEntries(
  shape: GeneratedShape,
  options: ExportOptions,
): Promise<NbtExportEntry[]> {
  const parts = shape.parts.map(part =>
    materializePart(part, options, options.applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS),
  );
  if (shape.splitExportNames) return buildSplitEntries(parts, options, shape.splitExportNames);
  return [await buildSingleEntry(shape, parts, options)];
}

// Callers:
// - tests/run.mts
// - tests/invariants.mts
export async function convertToNbt(
  shape: GeneratedShape,
  options: ExportOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const entries = await convertToNbtEntries(shape, options);
  if (entries.length === 1) return { data: entries[0].data, isZip: false };
  return { data: createZip(entries), isZip: true };
}
