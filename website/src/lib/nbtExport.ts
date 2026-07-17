/**
 * Public API:
 * - convertToNbt()
 * - convertToNbtEntries()
 *
 * Callers:
 * - src/Index.tsx
 */
import { MAP_SIZE } from "@/utils/color";
import {
  DEFAULT_CRUBTECH_DARK_WATER_DROP,
  DEFAULT_CRUBTECH_FLAT_WATER_DROP,
  DEFAULT_CRUBTECH_LATE_PAIRS_GAP,
  DEFAULT_CRUBTECH_LIGHT_WATER_DROP,
  DEFAULT_NBT_AUTHOR,
} from "@/data/defaultSettings";
import type { ColorRef } from "@/types/color";
import type { GeneratedShape, ShapePart } from "@/types/shape";
import { CRUBTECH_NOOBLINE_FILLER_BLOCK, buildFillerAssignmentMap, resolveAssignedFillerName } from "./fillerRules";
import { type ColorBlockSelections, resolveExportBlockName, resolveShapeColorBlockName } from "./blockId";
import { gzipCompress, writeStructureNbt } from "@/utils/nbtWriter";
import { createZip } from "@/utils/zip";
import { BuildMode, FillerRole, SuppressStepDirection, type FillerAssignment } from "@/types/conversion";
import { Shade, WATER_BASE_INDEX } from "@/data/mapColors";
import { isCrubTechBuildMode, isSuppressBuildMode } from "@/utils/conversion";
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
  westEastSlope?: WestEastSlopeOptions;
  baseName: string;
  buildMode: BuildMode;
  suppressStepDirection: SuppressStepDirection;
  suppress2LayerLatePairY?: number;
  crubTech?: boolean;
  markSuppressLoadSpotsInSchematic?: boolean;
  suppressLoadSpotMarkerBlock?: string;
}

type WestEastSlopeOptions = {
  run: number;
  rise: number;
};

type ExportPaletteRole = "visible" | "convenience" | "shading" | "vs_filler" | "support";
const EXPORT_PALETTE_ROLE_ORDER = ["visible", "shading", "vs_filler", "support", "convenience"] as const;
const CRUBTECH_PLATFORM_BLOCK_NAME = "minecraft:glass";
const CRUBTECH_GLASS_PANE_BLOCK_NAME = "minecraft:glass_pane[east=true,north=true,south=true,west=true]";
const CRUBTECH_WATERLOGGED_GLASS_PANE_BLOCK_NAME = "minecraft:glass_pane[east=true,north=true,south=true,west=true,waterlogged=true]";
const CRUBTECH_CATCHER_CHAIN_BLOCK_NAME = "minecraft:chain[axis=z]";
const CRUBTECH_FALLING_WATER_BLOCK_NAME = "minecraft:water[level=8]";

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
  return options.crubTech === true && isCrubTechBuildMode(options.buildMode);
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

  const resolveExportFillerName = (role: FillerRole) => {
    if (
      options.crubTech &&
      (role === FillerRole.ShadeNorthRowBreakable || role === FillerRole.ShadeNorthRowPushable)
    ) {
      return resolveExportBlockName(CRUBTECH_NOOBLINE_FILLER_BLOCK);
    }
    return resolveAssignedFillerName(fillerAssignments, role);
  };

  for (const assignment of options.fillerAssignments) {
    const fillerName = resolveExportFillerName(assignment.role);
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

function applyWestEastSlope(blocks: PaletteSourceBlock[], options: ExportOptions): void {
  if (!options.westEastSlope || isSuppressBuildMode(options.buildMode)) return;
  const rawRun = Number.isFinite(options.westEastSlope.run) ? Math.trunc(options.westEastSlope.run) : 0;
  const run = Math.max(0, Math.min(MAP_SIZE - 1, rawRun)) || 1;
  const rise = Number.isFinite(options.westEastSlope.rise) ? Math.trunc(options.westEastSlope.rise) : 0;
  if (rise === 0) return;
  for (const block of blocks) {
    if (block.x < 0 || block.x >= MAP_SIZE) continue;
    // Positive rise follows increasing X, which is west-to-east in the map preview/export grid.
    block.y += Math.floor(block.x / run) * rise;
  }
}

function normalizeAndMeasure<T extends { x: number; y: number; z: number }>(
  blocks: T[],
  options: ExportBoundsOptions,
): { sizeX: number; sizeY: number; sizeZ: number } {
  const crubTechForcesBounds = options.crubTech === true && isCrubTechBuildMode(options.buildMode);
  const forceXZ128 = crubTechForcesBounds || options.forceXZ128 !== false;
  const forceZ129 = crubTechForcesBounds || options.forceZ129 === true;
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

function appendCrubTechPlatformBlocks(
  blocks: PaletteSourceBlock[],
  shape: GeneratedShape,
  options: ExportOptions,
): void {
  if (options.crubTech !== true || !isCrubTechBuildMode(options.buildMode)) return;

  const platformYs = new Set<number>();
  for (const part of shape.parts) {
    for (const y of part.supportFloorYs) platformYs.add(y);
  }
  if (options.suppress2LayerLatePairY !== undefined) {
    platformYs.add(options.suppress2LayerLatePairY - 1);
  } else if (options.buildMode === BuildMode.Suppress2Layer && platformYs.size > 0) {
    platformYs.add(Math.max(...platformYs) + DEFAULT_CRUBTECH_LATE_PAIRS_GAP);
  }
  if (platformYs.size === 0) return;

  const bottomPlatformY = Math.min(...platformYs);
  const shadeLayerYs = {
    [Shade.Dark]: bottomPlatformY - DEFAULT_CRUBTECH_DARK_WATER_DROP,
    [Shade.Flat]: bottomPlatformY - DEFAULT_CRUBTECH_FLAT_WATER_DROP,
    [Shade.Light]: bottomPlatformY - DEFAULT_CRUBTECH_LIGHT_WATER_DROP,
  } as const;
  const waterShadeByCoord = new Map<string, Shade>();
  for (const part of shape.parts) {
    for (const [coord, cell] of part.cells) {
      if (!isShapeColorCell(cell) || cell.isCustom || cell.id !== WATER_BASE_INDEX) continue;
      const [x, y, z] = parseShapeCoordKey(coord);
      if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) continue;
      const shade = y === shadeLayerYs[Shade.Light]
        ? Shade.Light
        : y === shadeLayerYs[Shade.Flat]
          ? Shade.Flat
          : y === shadeLayerYs[Shade.Dark]
            ? Shade.Dark
            : null;
      if (shade !== null) waterShadeByCoord.set(`${x},${z}`, shade);
    }
  }
  if (waterShadeByCoord.size === 0) {
    platformYs.delete(bottomPlatformY);
    if (platformYs.size === 0) return;
  }

  const blockIndexByCoord = new Map(blocks.map((block, index) => [`${block.x},${block.y},${block.z}`, index] as const));
  const upsertBlock = (x: number, y: number, z: number, blockName: string, replace = false) => {
    const key = `${x},${y},${z}`;
    const existingIndex = blockIndexByCoord.get(key);
    if (existingIndex !== undefined) {
      if (replace) {
        blocks[existingIndex].blockName = blockName;
        blocks[existingIndex].paletteRole = "support";
      }
      return;
    }
    blocks.push({ x, y, z, blockName, paletteRole: "support" });
    blockIndexByCoord.set(key, blocks.length - 1);
  };

  for (const y of [...platformYs].sort((a, b) => a - b)) {
    for (let x = 0; x < MAP_SIZE; x += 1) {
      for (let z = 0; z < MAP_SIZE; z += 1) {
        upsertBlock(x, y, z, CRUBTECH_PLATFORM_BLOCK_NAME);
      }
    }
  }

  if (waterShadeByCoord.size === 0) return;

  for (const shade of [Shade.Light, Shade.Flat, Shade.Dark] as const) {
    const y = shadeLayerYs[shade];
    for (let x = 0; x < MAP_SIZE; x += 1) {
      for (let z = 0; z < MAP_SIZE; z += 1) {
        const blockName = waterShadeByCoord.get(`${x},${z}`) === shade
          ? CRUBTECH_WATERLOGGED_GLASS_PANE_BLOCK_NAME
          : CRUBTECH_GLASS_PANE_BLOCK_NAME;
        upsertBlock(x, y, z, blockName, true);
      }
    }
  }

  const appendCatcher = (waterShade: Shade.Light | Shade.Flat, catcherDrop: number) => {
    const waterY = shadeLayerYs[waterShade];
    const catcherPaneY = waterY - catcherDrop;
    const catcherChainY = catcherPaneY - 1;
    for (let x = 0; x < MAP_SIZE; x += 1) {
      for (let z = 0; z < MAP_SIZE; z += 1) {
        upsertBlock(x, catcherPaneY, z, CRUBTECH_WATERLOGGED_GLASS_PANE_BLOCK_NAME, true);
        upsertBlock(x, catcherChainY, z, CRUBTECH_CATCHER_CHAIN_BLOCK_NAME, true);
      }
    }
    for (const [coord, shade] of waterShadeByCoord) {
      if (shade !== waterShade) continue;
      const [x, z] = coord.split(",").map(Number);
      for (let y = waterY - 1; y > catcherPaneY; y -= 1) {
        upsertBlock(x, y, z, CRUBTECH_FALLING_WATER_BLOCK_NAME, true);
      }
    }
  };
  appendCatcher(Shade.Light, 2);
  appendCatcher(Shade.Flat, 5);
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
  appendCrubTechPlatformBlocks(blocks, shape, options);
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
  for (const partBlocks of parts) applyWestEastSlope(partBlocks, options);
  if (shape.splitExportNames) return buildSplitEntries(parts, options, shape.splitExportNames);
  return [await buildSingleEntry(shape, parts, options)];
}

export async function convertToNbt(
  shape: GeneratedShape,
  options: ExportOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const entries = await convertToNbtEntries(shape, options);
  if (entries.length === 1) return { data: entries[0].data, isZip: false };
  return { data: createZip(entries), isZip: true };
}
