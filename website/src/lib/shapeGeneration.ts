/**
 * Public API:
 * - generateShapeMap()
 *
 * Callers:
 * - src/lib/tileGeometry.ts
 */
import {
  buildModeUsesLayerGap,
  isSuppressStepsBuildMode,
  buildModeUsesPaletteSeed,
  isStaircaseBuildMode,
} from "@/utils/conversion";
import { FillerRole, BuildMode, SuppressStepDirection, type MixedStepPalette } from "@/types/conversion";
import { Shade, type ColorGrid, type ShadedColorRef } from "@/types/color";
import { ShapePartType, type GeneratedShape, type ShapeCell, type ShapeColorRef, type ShapeCoordKey, type ShapePart } from "@/types/shape";
import { MAP_SIZE, TRANSPARENT_COLOR, isTransparentColor, isWaterColor } from "@/utils/color";
import { createHashState, getHashId, mixUint32 } from "@/utils/hash";
import { PixelParity, getPixelParity, type WaterDrops } from "./colorGridAnalysis";
import { parseShapeCoordKey, toShapeCoordKey } from "./shapeModel";
import { buildSuppressStepPhases, type SuppressStepPhase } from "./suppressSteps";
import {
  COLUMN_COORD_Z_SIZE, getWaterDepth, getWaterDrop, isWaterBlock, makeFillerBlock, parseColumnCoordKey, toColumnCoordKey,
  type ColumnCoordKey, type ColumnPixelCache, type FillerCandidate, type ShapeBlock, type ShapeRef,
} from "./shapeBlocks";
import {
  addStaircaseWaterConvenienceFillers, applyColumnYOffsets, applyStaircaseVariantGroupPostProcess, applyStaircaseVariantParty,
  applyStaircaseVariantValley, buildBelowPlatformWaterBlocks, buildInclineBlocks, buildStaircaseBlocks, buildTransparentStaircaseBlocks,
  getStaircaseClassicColumnOffsets, getStaircaseSouthlineColumnOffsets, type StaircaseInternalBuildMode,
  type TransparentPlacementBuildMode,
} from "./shapeBlocksStaircase";
import { getSupportedStepHeights, getMixedStepReuse, getMixedStepColor } from "./mixedStepHeights";
import { getColorRefKey } from "./colorRefs";
import type { getEnvironmentalSettings } from "./environmentalSupport";

type ShapeBounds = ShapePart["bounds"];
type SuppressStepSpacing = { minimum: number; uniform: boolean; keepExtras: boolean };
type RecessivePlacementOverride = {
  colorY: number;
  fillerY?: number;
};
type ShapeBlockSet = {
  blocks: ShapeBlock[];
  loweredWaterBlocks: ShapeBlock[];
};
interface RawShapePart {
  suppressStepIndex?: number;
  blocks: ShapeBlock[];
  loweredWaterBlocks: ShapeBlock[];
  fillerCandidates: FillerCandidate[];
  bounds: ShapeBounds;
  supportFloorYs: ReadonlySet<number>;
  suppressedTransparentVsCollisionCount: number;
}

type StepPhasePartsBuildResult = {
  parts: RawShapePart[];
  hasAnyEmptyPhase: boolean;
};

type StaircaseWaterSetting =
  | { kind: "below-platform"; drops: WaterDrops }
  | { kind: "top-aligned" };

type StepwiseBuildMode = BuildMode.SuppressStepPairs | BuildMode.SuppressStepChecker;
type TwoLayerSuppressBuildMode = BuildMode.Suppress2LayerLateFillers | BuildMode.Suppress2LayerLatePairs;
type InternalBuildMode =
  | BuildMode.InclineUp
  | BuildMode.InclineDown
  | BuildMode.StaircaseNorthline
  | BuildMode.StaircaseSouthline
  | BuildMode.StaircaseClassic
  | BuildMode.StaircaseValley
  | BuildMode.StaircaseGroup
  | BuildMode.StaircaseParty
  | BuildMode.SuppressSplitRow
  | BuildMode.SuppressSplitChecker
  | BuildMode.SuppressStepPairs
  | BuildMode.SuppressStepChecker
  | BuildMode.Suppress2LayerLateFillers
  | BuildMode.Suppress2LayerLatePairs;
type ShapeCacheKeyId = string & { readonly __shapeCacheKeyId: unique symbol };
type GeneratedShapeSignatureId = string & { readonly __generatedShapeSignatureId: unique symbol };
type CachedGeneratedShape = {
  shape: GeneratedShape;
  signatureId?: GeneratedShapeSignatureId;
};
const DEFAULT_STAIRCASE_BUILD_MODES: StaircaseInternalBuildMode[] = [
  BuildMode.StaircaseNorthline,
  BuildMode.StaircaseSouthline,
  BuildMode.StaircaseClassic,
  BuildMode.StaircaseValley,
  BuildMode.StaircaseGroup,
  BuildMode.StaircaseParty,
];

const BASE_SUPPRESS_BUILD_MODES: InternalBuildMode[] = [
  BuildMode.SuppressSplitRow,
  BuildMode.SuppressSplitChecker,
  BuildMode.SuppressStepPairs,
  BuildMode.SuppressStepChecker,
];

function assertUnhandledBuildMode(buildMode: never, context: string): never {
  throw new Error(`Unhandled BuildMode in ${context}: ${String(buildMode)}`);
}

function getCanonicalBuildMode(buildMode: BuildMode): InternalBuildMode {
  switch (buildMode) {
    case BuildMode.Flat:
      return BuildMode.StaircaseNorthline;
    case BuildMode.Suppress2Layer:
      return BuildMode.Suppress2LayerLateFillers;
    default:
      return buildMode;
  }
}

function buildModeUsesWorldMinYGeometry(buildMode: BuildMode): boolean {
  return isStaircaseBuildMode(buildMode) &&
    buildMode !== BuildMode.InclineUp &&
    buildMode !== BuildMode.InclineDown;
}

function getRequestedStaircaseModes(
  selectedMode: BuildMode | null,
  allSameShade: Shade | undefined,
  hasWater: boolean,
  hasTransparency: boolean,
  collapseStaircaseModes: boolean,
  includeFlatNorthline: boolean,
): TransparentPlacementBuildMode[] {
  if (!hasTransparency && !hasWater &&
    (allSameShade === Shade.Dark || allSameShade === Shade.Light)) {
    return [allSameShade === Shade.Dark ? BuildMode.InclineUp : BuildMode.InclineDown];
  }
  if (collapseStaircaseModes) return [...DEFAULT_STAIRCASE_BUILD_MODES];

  const requested = new Set<TransparentPlacementBuildMode>();
  if (includeFlatNorthline) requested.add(BuildMode.StaircaseNorthline);
  if (selectedMode && isStaircaseBuildMode(selectedMode)) {
    requested.add(getCanonicalBuildMode(selectedMode) as TransparentPlacementBuildMode);
  }
  return [...requested];
}

interface GridShapeCache extends ColumnPixelCache {
  shapes: Map<ShapeCacheKeyId, CachedGeneratedShape>;
  rawParts: Map<ShapeCacheKeyId, RawShapePart[]>;
  staircaseBaseBlocks: Map<number, ShapeBlock[]>;
  // Per-mode staircase layouts before water convenience fillers or lowered-water overlays are added.
  staircaseVariantBlocks: Map<string, ShapeBlock[]>;
  // Cached vertical spacing between suppress step phases for this image.
  stepPhaseYOffsets: Map<number, number>;
  mixedStepColumnHeights?: Map<number | string, Map<number, Uint8Array>>;
}

const SHAPE_CACHE = new WeakMap<ColorGrid, GridShapeCache>();

function getGridShapeCache(colorGrid: ColorGrid): GridShapeCache {
  let cache = SHAPE_CACHE.get(colorGrid);
  if (cache) return cache;
  cache = {
    shapes: new Map(),
    rawParts: new Map(),
    columnPixelsByZ: new Map(),
    columnNonWaterPixelsByZ: new Map(),
    staircaseBaseBlocks: new Map(),
    staircaseVariantBlocks: new Map(),
    stepPhaseYOffsets: new Map(),
  };
  SHAPE_CACHE.set(colorGrid, cache);
  return cache;
}

// Signatures need role identity, not the same role-name characters for every cell.
const FILLER_ROLE_SIGNATURE_IDS = new Map(Object.values(FillerRole).map((role, index) => [role, index]));

function mixString(state: ReturnType<typeof createHashState>, value: string): void {
  for (let i = 0; i < value.length; ++i) mixUint32(state, value.charCodeAt(i));
  mixUint32(state, 0xff);
}

function getGeneratedShapeSignatureId(shape: GeneratedShape): GeneratedShapeSignatureId {
  const state = createHashState();
  mixString(state, shape.partType);
  mixString(state, shape.splitExportNames?.[0] ?? "");
  mixString(state, shape.splitExportNames?.[1] ?? "");
  mixUint32(state, shape.suppressedTransparentVsCollisionCount);
  mixUint32(state, shape.parts.length);

  for (const part of shape.parts) {
    if (part.suppressStepIndex !== undefined) mixUint32(state, part.suppressStepIndex);
    mixUint32(state, part.bounds.minY);
    mixUint32(state, part.bounds.maxY);
    mixUint32(state, part.bounds.minZ);
    mixUint32(state, part.bounds.maxZ);
    const floorYs = [...part.supportFloorYs].sort((a, b) => a - b);
    mixUint32(state, floorYs.length);
    for (const floorY of floorYs) mixUint32(state, floorY);

    const coords = new Float64Array(part.cells.size);
    let index = 0;
    for (const coord of part.cells.keys()) coords[index++] = coord;
    coords.sort();
    mixUint32(state, coords.length);
    for (const coord of coords) {
      const cell = part.cells.get(coord)!;
      mixUint32(state, coord);
      if (!Array.isArray(cell)) {
        mixUint32(state, 0);
        mixUint32(state, cell.isCustom ? 1 : 0);
        mixUint32(state, cell.id);
        continue;
      }

      mixUint32(state, 1);
      const roles = cell.length > 1 ? [...cell].sort() : cell;
      mixUint32(state, roles.length);
      for (const role of roles) mixUint32(state, FILLER_ROLE_SIGNATURE_IDS.get(role)!);
    }
  }

  return getHashId(state) as GeneratedShapeSignatureId;
}

function cloneShapeBlocks(blocks: ShapeBlock[]): ShapeBlock[] {
  return blocks.map(block => ({
    x: block.x,
    y: block.y,
    z: block.z,
    ref: block.ref.kind === "color" ? { kind: "color", color: block.ref.color } : { kind: "filler", role: block.ref.role },
  }));
}

function buildFillerCandidates(blocks: ShapeBlock[], occupiedExtraBlocks: ShapeBlock[] = []): FillerCandidate[] {
  const occupied = new Set<ShapeCoordKey>();
  for (const block of blocks) occupied.add(toShapeCoordKey(block.x, block.y, block.z));
  for (const block of occupiedExtraBlocks) occupied.add(toShapeCoordKey(block.x, block.y, block.z));

  const byCoord = new Map<ShapeCoordKey, FillerCandidate>();
  const ensureCandidate = (x: number, y: number, z: number) => {
    const coord = toShapeCoordKey(x, y, z);
    if (occupied.has(coord)) return null;
    let candidate = byCoord.get(coord);
    if (!candidate) {
      candidate = { x, y, z, roles: [] };
      byCoord.set(coord, candidate);
    }
    return candidate;
  };
  const addCandidate = (x: number, y: number, z: number, role: FillerRole) => {
    const candidate = ensureCandidate(x, y, z);
    if (candidate && !candidate.roles.includes(role)) candidate.roles.push(role);
  };

  const maxY = new Map<ColumnCoordKey, number>();
  const minY = new Map<ColumnCoordKey, number>();
  const maxColorY = new Map<ColumnCoordKey, number>();
  const waterRange = new Map<ColumnCoordKey, { minY: number; maxY: number }>();
  for (const block of blocks) {
    const coord = toColumnCoordKey(block.x, block.z);
    const current = maxY.get(coord);
    if (current === undefined || block.y > current) maxY.set(coord, block.y);
    const currentBottom = minY.get(coord);
    if (currentBottom === undefined || block.y < currentBottom) minY.set(coord, block.y);
    if (block.ref.kind === "color") {
      const colorCurrent = maxColorY.get(coord);
      if (colorCurrent === undefined || block.y > colorCurrent) maxColorY.set(coord, block.y);
    }
    addCandidate(block.x, block.y - 1, block.z, FillerRole.SupportAll);
    if (isWaterBlock(block)) {
      const range = waterRange.get(coord);
      if (range) {
        if (block.y < range.minY) range.minY = block.y;
        if (block.y > range.maxY) range.maxY = block.y;
      } else {
        waterRange.set(coord, { minY: block.y, maxY: block.y });
      }
    }
  }

  const groundedColumns = Array.from({ length: MAP_SIZE }, () => Array<boolean>(MAP_SIZE).fill(false));
  const sortedTopEntries = [...maxY.entries()].sort((a, b) => {
    // Packed column keys sort by X; within each X, visit Z south-to-north.
    const columnDelta = Math.floor(a[0] / COLUMN_COORD_Z_SIZE) - Math.floor(b[0] / COLUMN_COORD_Z_SIZE);
    return columnDelta || b[0] - a[0];
  });
  const hasGroundedNeighborConnection = (coord: ColumnCoordKey, neighborCoord: ColumnCoordKey, neighborX: number, neighborZ: number) => {
    if (neighborX < 0 || neighborX >= MAP_SIZE || neighborZ < 0 || neighborZ >= MAP_SIZE || !groundedColumns[neighborX][neighborZ]) return false;
    const currentBottom = minY.get(coord);
    const currentTop = maxY.get(coord);
    const neighborBottom = minY.get(neighborCoord);
    const neighborTop = maxY.get(neighborCoord);
    return currentBottom !== undefined &&
      currentTop !== undefined &&
      neighborBottom !== undefined &&
      neighborTop !== undefined &&
      currentBottom <= neighborTop &&
      neighborBottom <= currentTop;
  };

  for (const [coord, y] of sortedTopEntries) {
    const [x, z] = parseColumnCoordKey(coord);
    const currentBottom = minY.get(coord);
    if (currentBottom === undefined) continue;

    const northCoord = toColumnCoordKey(x, z - 1);
    const southCoord = toColumnCoordKey(x, z + 1);
    const westCoord = toColumnCoordKey(x - 1, z);
    const northY = maxY.get(northCoord);
    const southY = maxY.get(southCoord);

    const northStepCandidate = northY !== undefined && y === northY + 1;
    const southStepCandidate = southY !== undefined && y === southY + 1;
    const hasGroundedSouthNeighbor = hasGroundedNeighborConnection(coord, southCoord, x, z + 1);
    const hasGroundedWestNeighbor = hasGroundedNeighborConnection(coord, westCoord, x - 1, z);
    const needsStepSupport =
      !hasGroundedWestNeighbor && !hasGroundedSouthNeighbor &&
      (northStepCandidate || southStepCandidate);
    if (needsStepSupport) addCandidate(x, y - 1, z, FillerRole.StairStep);

    if (currentBottom === 0 || hasGroundedSouthNeighbor || hasGroundedWestNeighbor || needsStepSupport) {
      groundedColumns[x][z] = true;
    }
  }

  for (const block of blocks) {
    if (!isWaterBlock(block)) {
      const candidate = ensureCandidate(block.x, block.y - 1, block.z);
      if (candidate) {
        if (!candidate.roles.includes(FillerRole.SupportFragile)) candidate.roles.push(FillerRole.SupportFragile);
      }
    }
    if (!isWaterBlock(block)) continue;
    const waterPillar = waterRange.get(toColumnCoordKey(block.x, block.z));
    if (!waterPillar) continue;
    if (block.y !== waterPillar.minY && block.y !== waterPillar.maxY) continue;
    const addWaterSideCandidate = (x: number, y: number, z: number) => {
      const role = (maxColorY.get(toColumnCoordKey(x, z)) ?? -Infinity) > y
        ? FillerRole.SupportWaterSidesCovered
        : FillerRole.SupportWaterSides;
      addCandidate(x, y, z, role);
    };
    addWaterSideCandidate(block.x, block.y, block.z - 1);
    addWaterSideCandidate(block.x, block.y, block.z + 1);
    addWaterSideCandidate(block.x - 1, block.y, block.z);
    addWaterSideCandidate(block.x + 1, block.y, block.z);
    addWaterSideCandidate(block.x, block.y - 1, block.z);
  }

  const candidates = [...byCoord.values()];
  for (const [coord, range] of waterRange) {
    const [x, z] = parseColumnCoordKey(coord);
    const y = range.minY - 1;
    const belowKey = toShapeCoordKey(x, y, z);
    if (occupied.has(belowKey)) continue;
    candidates.push({ x, y, z, roles: [FillerRole.SupportWaterBase] });
  }
  return candidates;
}

function measureShapeBounds(blocks: ShapeBlock[], loweredWaterBlocks: ShapeBlock[] = []): ShapeBounds {
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const blockList of [blocks, loweredWaterBlocks]) {
    for (const block of blockList) {
      if (block.y < minY) minY = block.y;
      if (block.y > maxY) maxY = block.y;
      if (block.z < minZ) minZ = block.z;
      if (block.z > maxZ) maxZ = block.z;
    }
  }

  return {
    minY: minY === Infinity ? 0 : minY,
    maxY: maxY === -Infinity ? 0 : maxY,
    minZ: minZ === Infinity ? 0 : minZ,
    maxZ: maxZ === -Infinity ? 0 : maxZ,
  };
}

function assertShapeBlockZRange(blocks: ShapeBlock[]): void {
  for (const block of blocks) {
    if (block.z < -1 || block.z >= MAP_SIZE) {
      throw new Error(`Generated shape block z out of range: (${block.x}, ${block.y}, ${block.z})`);
    }
  }
}

function buildShapePart(
  blocks: ShapeBlock[],
  extraFillerCandidates: FillerCandidate[] = [],
  includeDefaultFillerCandidates = true,
  supportFloorYs?: ReadonlySet<number>,
  loweredWaterBlocks: ShapeBlock[] = [],
  suppressedTransparentVsCollisionCount = 0,
  crubTechSupportUpperY?: number,
): RawShapePart {
  assertShapeBlockZRange(blocks);
  assertShapeBlockZRange(loweredWaterBlocks);
  const bounds = measureShapeBounds(blocks, loweredWaterBlocks);
  const effectiveSupportFloorYs = supportFloorYs ?? new Set<number>([bounds.minY - 1]);
  const fillerCandidates = includeDefaultFillerCandidates
    ? [...buildFillerCandidates(blocks, loweredWaterBlocks), ...extraFillerCandidates]
    : extraFillerCandidates;
  if (crubTechSupportUpperY !== undefined) {
    applyCrubTechSupportRoles(fillerCandidates, blocks, loweredWaterBlocks, effectiveSupportFloorYs, crubTechSupportUpperY);
  }
  return {
    blocks,
    loweredWaterBlocks,
    fillerCandidates,
    bounds,
    supportFloorYs: effectiveSupportFloorYs,
    suppressedTransparentVsCollisionCount,
  };
}

function getShadeFillerRole(z: number): FillerRole {
  return z < 0 ? FillerRole.ShadeNorthRow : FillerRole.ShadeSuppress;
}

function isCrubTechShadeFillerRole(role: FillerRole): role is FillerRole.ShadeNorthRow | FillerRole.ShadeSuppress {
  return role === FillerRole.ShadeNorthRow || role === FillerRole.ShadeSuppress;
}

function getCrubTechShadeFillerRole(
  baseRole: FillerRole.ShadeNorthRow | FillerRole.ShadeSuppress,
  x: number,
  y: number,
  z: number,
  upperY: number,
  occupied: ReadonlySet<ShapeCoordKey>,
  fillerPlacements: ReadonlyMap<ShapeCoordKey, ShapeRef>,
): FillerRole {
  if (baseRole === FillerRole.ShadeNorthRow) return FillerRole.ShadeNorthRowBreakable;
  if (y === upperY + 1) return FillerRole.ShadeSuppressBreakable;
  if (y !== upperY) return FillerRole.ShadeSuppressPushable;
  const pairX = (x & 1) === 0 ? x + 1 : x - 1;
  const pairCoord = toShapeCoordKey(pairX, y, z);
  return !occupied.has(pairCoord) && !fillerPlacements.has(pairCoord)
    ? FillerRole.ShadeSuppressPushable
    : FillerRole.ShadeSuppressBreakable;
}

function getCrubTechSupportRole(
  x: number,
  y: number,
  z: number,
  upperY: number,
  occupied: ReadonlySet<ShapeCoordKey>,
): FillerRole.SupportBreakable | FillerRole.SupportPushable {
  if (y < upperY) return FillerRole.SupportBreakable;
  if (y !== upperY) return FillerRole.SupportPushable;
  // The sweep extends down to support height along the north row.
  if (z < 0) return FillerRole.SupportBreakable;
  // Isolated moss below the sweep is ignored; a paired block must push into it.
  const pairX = (x & 1) === 0 ? x + 1 : x - 1;
  return occupied.has(toShapeCoordKey(pairX, y, z))
    ? FillerRole.SupportBreakable
    : FillerRole.SupportPushable;
}

function applyCrubTechShadeFillerRoles(
  fillerPlacements: Map<ShapeCoordKey, ShapeRef>,
  occupied: ReadonlySet<ShapeCoordKey>,
  upperY: number,
): void {
  for (const [coord, ref] of fillerPlacements) {
    if (ref.kind !== "filler" || !isCrubTechShadeFillerRole(ref.role)) continue;
    const [x, y, z] = parseShapeCoordKey(coord);
    ref.role = getCrubTechShadeFillerRole(ref.role, x, y, z, upperY, occupied, fillerPlacements);
  }
}

function applyCrubTechSupportRoles(
  fillerCandidates: FillerCandidate[],
  blocks: ShapeBlock[],
  loweredWaterBlocks: ShapeBlock[],
  supportFloorYs: ReadonlySet<number>,
  upperY: number,
): void {
  const occupied = new Set<ShapeCoordKey>();
  for (const block of blocks) occupied.add(toShapeCoordKey(block.x, block.y, block.z));
  for (const block of loweredWaterBlocks) occupied.add(toShapeCoordKey(block.x, block.y, block.z));

  const supportCandidates = fillerCandidates.filter(candidate =>
    candidate.roles.includes(FillerRole.SupportAll) && !supportFloorYs.has(candidate.y),
  );
  for (const candidate of supportCandidates) {
    occupied.add(toShapeCoordKey(candidate.x, candidate.y, candidate.z));
  }
  for (const candidate of supportCandidates) {
    const role = getCrubTechSupportRole(candidate.x, candidate.y, candidate.z, upperY, occupied);
    if (!candidate.roles.includes(role)) candidate.roles.push(role);
  }
}

function appendSuppressPixelBlocks(
  blocks: ShapeBlock[],
  loweredWaterBlocks: ShapeBlock[],
  x: number,
  baseY: number,
  z: number,
  color: ShadedColorRef,
  waterDrops?: WaterDrops,
): number {
  const belowPlatformWater = waterDrops !== undefined;
  if (isWaterColor(color)) {
    if (belowPlatformWater) {
      const waterDrop = getWaterDrop(waterDrops, color.shade);
      const waterY = baseY - waterDrop;
      loweredWaterBlocks.push({ x, y: waterY, z, ref: { kind: "color", color } });
      return waterY;
    }
    const depth = getWaterDepth(color.shade, x, z);
    for (let d = 0; d < depth; ++d) blocks.push({ x, y: baseY + d, z, ref: { kind: "color", color } });
    return baseY + depth - 1;
  }

  blocks.push({ x, y: baseY, z, ref: { kind: "color", color } });
  if (color.shade === Shade.Flat) {
    blocks.push(makeFillerBlock(x, baseY, z - 1, getShadeFillerRole(z - 1)));
    return baseY;
  }
  if (color.shade !== Shade.Light) {
    blocks.push(makeFillerBlock(x, baseY + 1, z - 1, getShadeFillerRole(z - 1)));
    return baseY + 1;
  }
  return baseY;
}

function getStepPhaseYOffset(
  colorGrid: ColorGrid,
  stepDirection: SuppressStepDirection,
  cache?: GridShapeCache,
  waterDrops?: WaterDrops,
): number {
  const belowPlatformWater = waterDrops !== undefined;
  const axisZSuppress = getSuppressStepAxis(stepDirection) === "z";
  const cacheKey = (belowPlatformWater ? 2 : 0) | (axisZSuppress ? 1 : 0);
  const cached = cache?.stepPhaseYOffsets.get(cacheKey);
  if (cached !== undefined) return cached;
  let yOffset = 1;
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) continue;
      if (isWaterColor(color)) {
        if (belowPlatformWater) continue;
        // N/S can put two light-shade land pixels south of a reused water pillar.
        yOffset = Math.max(yOffset, getWaterDepth(color.shade, x, z) + (axisZSuppress ? 2 : 0));
        continue;
      }
      if (color.shade === Shade.Light) {
        if (axisZSuppress) yOffset = Math.max(yOffset, 2);
        continue;
      }
      if (color.shade === Shade.Dark) yOffset = Math.max(yOffset, axisZSuppress ? 3 : 2);
    }
  }
  if (cache) cache.stepPhaseYOffsets.set(cacheKey, yOffset);
  return yOffset;
}

function buildSuppressSplitRowBlockSets(
  colorGrid: ColorGrid,
  waterDrops?: WaterDrops,
): ShapeBlockSet[] {
  const buildHalf = (startRow: 0 | 1): ShapeBlockSet => {
    const blocks: ShapeBlock[] = [];
    const loweredWaterBlocks: ShapeBlock[] = [];
    for (let x = 0; x < MAP_SIZE; ++x) {
      for (let z = 0; z < MAP_SIZE; ++z) {
        if (z % 2 !== startRow) continue;
        const color = colorGrid[x][z];
        if (isTransparentColor(color)) continue;
        appendSuppressPixelBlocks(blocks, loweredWaterBlocks, x, 0, z, color, waterDrops);
      }
    }
    return { blocks, loweredWaterBlocks };
  };

  return [buildHalf(0), buildHalf(1)];
}

function buildSuppressSplitCheckerBlockSets(
  colorGrid: ColorGrid,
  waterDrops?: WaterDrops,
): ShapeBlockSet[] {
  const belowPlatformWater = waterDrops !== undefined;
  const buildHalf = (useDominant: boolean): ShapeBlockSet => {
    const blocks: ShapeBlock[] = [];
    const loweredWaterBlocks: ShapeBlock[] = [];
    for (let x = 0; x < MAP_SIZE; ++x) {
      for (let z = 0; z < MAP_SIZE; ++z) {
        const isDominant = getPixelParity(x, z) === PixelParity.Dominant;
        if (isDominant !== useDominant) continue;
        const color = colorGrid[x][z];
        if (isTransparentColor(color)) continue;
        if (isWaterColor(color)) {
          if (belowPlatformWater) {
            const waterDrop = getWaterDrop(waterDrops, color.shade);
            loweredWaterBlocks.push({ x, y: -waterDrop, z, ref: { kind: "color", color } });
            continue;
          }
          const depth = getWaterDepth(color.shade, x, z);
          for (let d = 0; d < depth; ++d) blocks.push({ x, y: -1 - d, z, ref: { kind: "color", color } });
          continue;
        }
        appendSuppressPixelBlocks(blocks, loweredWaterBlocks, x, 0, z, color, waterDrops);
      }
    }
    return { blocks, loweredWaterBlocks };
  };

  return [buildHalf(true), buildHalf(false)];
}

function buildSuppressDualLayerBlocks(
  colorGrid: ColorGrid,
  layerGap: number | undefined,
  suppress2LayerLatePairY: number | undefined,
  buildMode: TwoLayerSuppressBuildMode,
  useCrubTech: boolean,
  waterDrops?: WaterDrops,
): { blocks: ShapeBlock[]; loweredWaterBlocks: ShapeBlock[]; supportFloorYs: ReadonlySet<number> } {
  const belowPlatformWater = waterDrops !== undefined;
  const topYGrid: (number | undefined)[][] = Array.from({ length: MAP_SIZE }, () => new Array<number | undefined>(MAP_SIZE).fill(undefined));
  const blocks: ShapeBlock[] = [];
  const loweredWaterBlocks: ShapeBlock[] = [];
  const occupied = new Set<ShapeCoordKey>();
  const lowerY = 0;
  const upperY = Math.max(1, layerGap ?? 5);
  const lateY = Math.max(upperY + 1, Math.trunc(suppress2LayerLatePairY ?? upperY + 1) || upperY + 1);
  const recessiveOverrides = new Map<ColumnCoordKey, RecessivePlacementOverride>();
  const lateDominant = new Set<ColumnCoordKey>();
  const cellKey = (x: number, z: number) => toColumnCoordKey(x, z);
  const isRecessive = (x: number, z: number) => getPixelParity(x, z) === PixelParity.Recessive;
  const isDominant = (x: number, z: number) => getPixelParity(x, z) === PixelParity.Dominant;
  const shadeDeltaFromSouth = (shade: Shade) => (shade === Shade.Light ? -1 : shade === Shade.Flat ? 0 : 1);
  // Keep the north pixel correct during the full update, then add its provider for the dominant-only update.
  const needsLateDominantShade = (x: number, z: number, color: ShadedColorRef) => {
    if (
      !isDominant(x, z) ||
      isTransparentColor(color) ||
      isWaterColor(color) ||
      color.shade === Shade.Light ||
      z === 0
    ) return false;
    const north = colorGrid[x][z - 1];
    if (isTransparentColor(north)) return true;
    if (!belowPlatformWater || !isWaterColor(north)) return false;
    const northWaterY = lowerY - getWaterDrop(waterDrops, north.shade);
    const fillerY = lowerY + (color.shade === Shade.Dark ? 1 : 0);
    return northWaterY !== fillerY;
  };
  const isLatePairDominantColor = (x: number, z: number, color: ShadedColorRef) =>
    buildMode === BuildMode.Suppress2LayerLatePairs &&
    color.shade === Shade.Flat &&
    needsLateDominantShade(x, z, color);
  const addBlock = (x: number, y: number, z: number, ref: ShapeRef) => {
    const coord = toShapeCoordKey(x, y, z);
    if (occupied.has(coord)) return;
    blocks.push({ x, y, z, ref });
    occupied.add(coord);
  };

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let recZ = 0; recZ < MAP_SIZE - 1; ++recZ) {
      if (!isRecessive(x, recZ)) continue;
      const domZ = recZ + 1;
      if (!isDominant(x, domZ)) continue;
      const dom = colorGrid[x][domZ];
      const rec = colorGrid[x][recZ];
      const northZ = recZ - 1;
      const north = northZ >= 0 ? colorGrid[x][northZ] : TRANSPARENT_COLOR;
      if (isTransparentColor(dom) || isTransparentColor(rec) || isWaterColor(dom) || isWaterColor(rec)) continue;
      if (dom.shade === Shade.Dark) {
        if (rec.shade === Shade.Dark) {
          recessiveOverrides.set(cellKey(x, recZ), { colorY: lowerY + 1, fillerY: upperY });
          continue;
        }
        if (rec.shade === Shade.Light) {
          const northSupportsLoweredLight =
            northZ < 0 ||
            isTransparentColor(north) ||
            (!isWaterColor(north) && !isLatePairDominantColor(x, northZ, north));
          if (northSupportsLoweredLight) {
            recessiveOverrides.set(cellKey(x, recZ), { colorY: lowerY + 1 });
            continue;
          }
        }
      }
      if (dom.shade !== Shade.Flat) continue;
      let canLower = false;
      if (rec.shade === Shade.Dark) canLower = recZ === 0;
      else if (rec.shade === Shade.Flat) {
        const hasRegularNorthDominant =
          northZ >= 0 &&
          isDominant(x, northZ) &&
          !isTransparentColor(north) &&
          !isWaterColor(north) &&
          !isLatePairDominantColor(x, northZ, north);
        canLower = recZ === 0 || hasRegularNorthDominant;
      } else if (rec.shade === Shade.Light) {
        canLower = isTransparentColor(north);
      }
      if (canLower) recessiveOverrides.set(cellKey(x, recZ), { colorY: lowerY });
    }
  }

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = MAP_SIZE - 1; z >= 0; --z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) continue;
      if (isWaterColor(color)) {
        if (belowPlatformWater) {
          const waterDrop = getWaterDrop(waterDrops, color.shade);
          const waterY = lowerY - waterDrop;
          loweredWaterBlocks.push({ x, y: waterY, z, ref: { kind: "color", color } });
          occupied.add(toShapeCoordKey(x, waterY, z));
          topYGrid[x][z] = waterY;
          continue;
        }
        const south = z + 1 < MAP_SIZE ? colorGrid[x][z + 1] : TRANSPARENT_COLOR;
        const southTopY = z < MAP_SIZE - 1 ? topYGrid[x][z + 1] : undefined;
        let topY = lowerY - 1;
        if (isRecessive(x, z) && !isTransparentColor(south) && !isWaterColor(south) && southTopY !== undefined) {
          // Height shades the southern pixel; depth shades the water itself.
          topY = southTopY + shadeDeltaFromSouth(south.shade);
        }
        const depth = getWaterDepth(color.shade, x, z);
        for (let d = 0; d < depth; ++d) addBlock(x, topY - d, z, { kind: "color", color });
        topYGrid[x][z] = topY;
        continue;
      }

      const override = recessiveOverrides.get(cellKey(x, z));
      let y = override?.colorY ?? (isDominant(x, z) ? lowerY : upperY);
      if (isLatePairDominantColor(x, z, color)) {
        y = lateY;
        lateDominant.add(cellKey(x, z));
      }
      addBlock(x, y, z, { kind: "color", color });
      topYGrid[x][z] = y;
    }
  }

  const fillerPlacements = new Map<ShapeCoordKey, ShapeRef>();
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color) || isWaterColor(color) || color.shade === Shade.Light) continue;
      const topY = topYGrid[x][z];
      if (topY === undefined) continue;
      const override = recessiveOverrides.get(cellKey(x, z));
      const fillY = override?.fillerY ?? (topY + (color.shade === Shade.Dark ? 1 : 0));
      const fillZ = z - 1;
      const coord = toShapeCoordKey(x, fillY, fillZ);
      if (occupied.has(coord)) continue;
      if (needsLateDominantShade(x, z, color)) {
        if (buildMode === BuildMode.Suppress2LayerLatePairs) {
          const lateCoord = toShapeCoordKey(x, lateY, fillZ);
          if (!occupied.has(lateCoord)) fillerPlacements.set(lateCoord, { kind: "filler", role: getShadeFillerRole(fillZ) });
        } else {
          fillerPlacements.set(coord, { kind: "filler", role: FillerRole.ShadeSuppressLate });
        }
        continue;
      }
      fillerPlacements.set(coord, { kind: "filler", role: getShadeFillerRole(fillZ) });
    }
  }

  if (buildMode === BuildMode.Suppress2LayerLatePairs) {
    for (const [key, override] of recessiveOverrides.entries()) {
      const [x, z] = parseColumnCoordKey(key);
      const color = colorGrid[x][z];
      if (override.colorY !== lowerY) continue;
      if (isTransparentColor(color) || isWaterColor(color) || color.shade !== Shade.Flat) continue;
      const northZ = z - 1;
      if (northZ < 0 || !lateDominant.has(cellKey(x, northZ))) continue;
      const recY = topYGrid[x][z];
      if (recY === undefined) continue;
      const coord = toShapeCoordKey(x, recY, northZ);
      if (!occupied.has(coord)) fillerPlacements.set(coord, { kind: "filler", role: getShadeFillerRole(northZ) });
    }
  }

  if (useCrubTech) applyCrubTechShadeFillerRoles(fillerPlacements, occupied, upperY);

  for (const [coord, ref] of fillerPlacements.entries()) {
    if (occupied.has(coord)) continue;
    const [x, y, z] = parseShapeCoordKey(coord);
    blocks.push({ x, y, z, ref });
    occupied.add(coord);
  }

  const supportFloorYs = new Set<number>([lowerY - 1, upperY - 1]);
  if (buildMode === BuildMode.Suppress2LayerLatePairs) supportFloorYs.add(lateY - 1);

  return { blocks, loweredWaterBlocks, supportFloorYs };
}

function getSuppressStepAxis(direction: SuppressStepDirection): "x" | "z" {
  return (
    direction === SuppressStepDirection.NorthToSouth ||
    direction === SuppressStepDirection.SouthToNorth
  ) ? "z" : "x";
}

function buildBelowPlatformWaterPreviewBlocks(
  colorGrid: ColorGrid,
  baseY: number,
  waterDrops: WaterDrops,
): ShapeBlock[] {
  const blocks: ShapeBlock[] = [];
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (!isWaterColor(color)) continue;
      const waterDrop = getWaterDrop(waterDrops, color.shade);
      blocks.push({ x, y: baseY - waterDrop, z, ref: { kind: "color", color } });
    }
  }
  return blocks;
}

// Minimize shared-height reuse cost for dry east/west columns, counting entry and exit.
// Count initial construction and final cleanup, not just transitions between phases.
function getMixedStepColumnHeights(colorGrid: ColorGrid, maxHeight: number, cache?: GridShapeCache, palette?: MixedStepPalette): Map<number, Uint8Array> {
  const key = palette ? `${maxHeight}:${palette.key}` : maxHeight;
  const cached = cache?.mixedStepColumnHeights?.get(key);
  if (cached) return cached;
  if (palette) {
    const result = getSupportedStepHeights(colorGrid, maxHeight, palette);
    if (cache) (cache.mixedStepColumnHeights ??= new Map()).set(key, result);
    return result;
  }
  const result = new Map<number, Uint8Array>();
  const states = maxHeight + 1;
  let previous = new Float64Array(states);
  let next = new Float64Array(states);
  const previousHeights = new Uint8Array(MAP_SIZE * states);
  const higherMinima = new Uint8Array(states);
  const operationWeight = MAP_SIZE * maxHeight + 1;
  for (let x = 0; x < MAP_SIZE; ++x) {
    const column = colorGrid[x];
    if (column.some(isWaterColor)) continue;
    if (!column.some(color => !isTransparentColor(color) && color.shade === Shade.Dark)) continue;
    // A matching color retained as a shader costs two operations over both phases;
    // replacing it with a filler costs four. Prefer fewer raised blocks on ties.
    previous.fill(Infinity);
    let baseline = 0;
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = column[z];
      const transparent = isTransparentColor(color);
      const canShare = z > 0 && !transparent && color.shade !== Shade.Light && !isTransparentColor(column[z - 1]);
      if (canShare && color.shade === Shade.Dark) baseline += 2 * operationWeight;
      next.fill(Infinity);
      // Suffix minima find a compatible higher north block in O(1), keeping the
      // full search O(pixels * states). Reuse these buffers for every column.
      let bestNorthHeight = maxHeight;
      for (let height = maxHeight; height >= 0; --height) {
        if (previous[height] <= previous[bestNorthHeight]) bestNorthHeight = height;
        higherMinima[height] = bestNorthHeight;
      }
      // Leave room above dark colors for their north shader, within the same cap.
      const limit = transparent ? 0 : maxHeight - (color.shade === Shade.Dark ? 1 : 0);
      for (let height = 0; height <= limit; ++height) {
        const index = z * states + height;
        if (z === 0) {
          next[height] = height;
          continue;
        }
        let northHeight = bestNorthHeight;
        let cost = previous[northHeight];
        if (canShare) {
          const matches = color.shade === Shade.Flat ? northHeight === height : northHeight > height;
          if (!matches) cost += 2 * operationWeight;
          const matchingHeight = color.shade === Shade.Flat ? height : higherMinima[height + 1];
          if (previous[matchingHeight] < cost || (previous[matchingHeight] === cost && matchingHeight < northHeight)) {
            northHeight = matchingHeight;
            cost = previous[matchingHeight];
          }
        }
        next[height] = cost + height;
        previousHeights[index] = northHeight;
      }
      const swap = previous;
      previous = next;
      next = swap;
    }
    let height = 0;
    for (let h = 1; h <= maxHeight; ++h) if (previous[h] < previous[height]) height = h;
    if (previous[height] >= baseline) continue;
    const heights = new Uint8Array(MAP_SIZE);
    for (let z = MAP_SIZE - 1; z >= 0; --z) {
      heights[z] = height;
      height = previousHeights[z * states + height];
    }
    result.set(x, heights);
  }
  if (cache) (cache.mixedStepColumnHeights ??= new Map()).set(maxHeight, result);
  return result;
}

function buildStepPhaseBlocks(
  colorGrid: ColorGrid,
  currentSpec: SuppressStepPhase,
  currentBaseY: number,
  previousSpec?: SuppressStepPhase,
  nextSpec?: SuppressStepPhase,
  allowMixStepReuse = false,
  waterDrops?: WaterDrops,
  mixedColumnHeights?: ReadonlyMap<number, Uint8Array>,
  mixedStepPalette?: MixedStepPalette,
): ShapeBlockSet {
  const belowPlatformWater = waterDrops !== undefined;
  const stepBlocks: ShapeBlock[] = [];
  const loweredWaterBlocks: ShapeBlock[] = [];
  const occupied = new Set<ShapeCoordKey>();
  const repeatedNorthShaderColumns = new Set<ColumnCoordKey>();
  const repeatedNorthSharedColumns = new Set<ColumnCoordKey>();
  const repeatedBelowPlatformWaterColumns = new Set<ColumnCoordKey>();
  const shadedByRepeatedNorth = new Set<ColumnCoordKey>();
  const shadedByCurrentNorth = new Set<ColumnCoordKey>();
  const currentPhaseColorYOffsets = new Map<ColumnCoordKey, number>();
  const repeatedPhaseColorYOffsets = new Map<ColumnCoordKey, number>();
  const cellKey = (x: number, z: number) => toColumnCoordKey(x, z);
  const setMaxOffset = (offsets: Map<ColumnCoordKey, number>, key: ColumnCoordKey, offset: number) => {
    offsets.set(key, Math.max(offsets.get(key) ?? 0, offset));
  };
  const getCurrentPhaseBaseY = (x: number, z: number) => currentBaseY + (currentPhaseColorYOffsets.get(cellKey(x, z)) ?? 0);
  const getRepeatedPhaseBaseY = (x: number, z: number) => currentBaseY + (repeatedPhaseColorYOffsets.get(cellKey(x, z)) ?? 0);
  const pushUnique = (block: ShapeBlock) => {
    const coord = toShapeCoordKey(block.x, block.y, block.z);
    if (occupied.has(coord)) return;
    stepBlocks.push(block);
    occupied.add(coord);
  };
  const pushUniqueDroppedWater = (block: ShapeBlock) => {
    const coord = toShapeCoordKey(block.x, block.y, block.z);
    if (occupied.has(coord)) return;
    loweredWaterBlocks.push(block);
    occupied.add(coord);
  };
  const canReuseNorthColumnAsShader = (shadedColor: ShadedColorRef, northColor: ShadedColorRef): boolean => {
    if (isTransparentColor(shadedColor) || isWaterColor(shadedColor)) return false;
    if (isTransparentColor(northColor)) return false;
    if (isWaterColor(northColor)) {
      if (belowPlatformWater) return false;
      if (shadedColor.shade === Shade.Flat) return northColor.shade === Shade.Light;
      if (shadedColor.shade === Shade.Dark) return northColor.shade !== Shade.Light;
      return false;
    }
    if (shadedColor.shade === Shade.Flat) {
      return true;
    }
    return false;
  };
  const canReuseAxisZNorthColumnAsShader = (shadedColor: ShadedColorRef, northColor: ShadedColorRef): boolean => {
    return currentSpec.axis === "z" &&
      !isTransparentColor(shadedColor) &&
      !isWaterColor(shadedColor) &&
      !isTransparentColor(northColor) &&
      !(belowPlatformWater && isWaterColor(northColor) &&
        (getWaterDrop(waterDrops, northColor.shade) !== 0 || shadedColor.shade === Shade.Dark));
  };
  const canReuseCurrentPhaseNorthColumnAsShader = (shadedColor: ShadedColorRef, northColor: ShadedColorRef): boolean => {
    if (canReuseNorthColumnAsShader(shadedColor, northColor)) return true;
    return canReuseAxisZNorthColumnAsShader(shadedColor, northColor);
  };

  const collectRepeatedNorthBlocks = (
    shadedParity: PixelParity,
    northParity: PixelParity,
    adjacentSpec: SuppressStepPhase | undefined,
  ) => {
    if (!adjacentSpec) return;
    const scanX = currentSpec.axis === "x" ? currentSpec.lines : Array.from({ length: MAP_SIZE }, (_, index) => index);
    for (const x of scanX) {
      if (x < 0 || x >= MAP_SIZE) continue;
      if (mixedColumnHeights?.has(x)) continue;
      for (let z = 1; z < MAP_SIZE; ++z) {
        if (!currentSpec.includeAt(x, z) || getPixelParity(x, z) !== shadedParity) continue;
        const color = colorGrid[x][z];
        const northZ = z - 1;
        if (!adjacentSpec.includeAt(x, northZ) || getPixelParity(x, northZ) !== northParity) continue;
        const north = colorGrid[x][northZ];
        if (!canReuseNorthColumnAsShader(color, north) && !canReuseAxisZNorthColumnAsShader(color, north)) continue;
        shadedByRepeatedNorth.add(cellKey(x, z));
        repeatedNorthShaderColumns.add(cellKey(x, northZ));
      }
    }
  };

  const collectSharedNorthColumnsForWater = (
    waterParity: PixelParity,
    northParity: PixelParity,
    adjacentSpec: SuppressStepPhase | undefined,
  ) => {
    if (belowPlatformWater) return;
    if (!adjacentSpec) return;
    const scanX = currentSpec.axis === "x" ? currentSpec.lines : Array.from({ length: MAP_SIZE }, (_, index) => index);
    for (const x of scanX) {
      if (x < 0 || x >= MAP_SIZE) continue;
      for (let z = 1; z < MAP_SIZE; ++z) {
        if (!currentSpec.includeAt(x, z) || getPixelParity(x, z) !== waterParity) continue;
        const color = colorGrid[x][z];
        if (!isWaterColor(color)) continue;
        const northZ = z - 1;
        if (!adjacentSpec.includeAt(x, northZ) || getPixelParity(x, northZ) !== northParity) continue;
        const north = colorGrid[x][northZ];
        if (isTransparentColor(north)) continue;
        repeatedNorthSharedColumns.add(cellKey(x, northZ));
      }
    }
  };

  const collectCurrentPhaseNorthReuse = () => {
    const scanX = currentSpec.axis === "x" ? currentSpec.lines : Array.from({ length: MAP_SIZE }, (_, index) => index);
    for (const x of scanX) {
      if (x < 0 || x >= MAP_SIZE) continue;
      for (let z = 1; z < MAP_SIZE; ++z) {
        if (!currentSpec.includeAt(x, z) || !currentSpec.includeAt(x, z - 1)) continue;
        const color = colorGrid[x][z];
        const north = colorGrid[x][z - 1];
        if (!canReuseCurrentPhaseNorthColumnAsShader(color, north)) continue;
        shadedByCurrentNorth.add(cellKey(x, z));
      }
    }
  };

  const propagateCurrentPhaseYOffsets = () => {
    if (currentSpec.axis !== "z") return;
    const northWaterHeight = (x: number, z: number) => !belowPlatformWater && isWaterColor(colorGrid[x][z])
      ? getWaterDepth(colorGrid[x][z].shade, x, z) - 1 : 0;
    for (let x = 0; x < MAP_SIZE; ++x) {
      for (let z = MAP_SIZE - 1; z >= 1; --z) {
        if (!currentSpec.includeAt(x, z)) continue;
        const color = colorGrid[x][z];
        if (isTransparentColor(color) || isWaterColor(color)) continue;
        if (color.shade !== Shade.Flat && color.shade !== Shade.Dark) continue;
        const southKey = cellKey(x, z);
        const northKey = cellKey(x, z - 1);
        const requiredNorthOffset = (currentPhaseColorYOffsets.get(southKey) ?? 0) +
          (color.shade === Shade.Dark ? 1 : 0) - northWaterHeight(x, z - 1);
        if (shadedByCurrentNorth.has(southKey)) {
          setMaxOffset(currentPhaseColorYOffsets, northKey, requiredNorthOffset);
          continue;
        }
        if (shadedByRepeatedNorth.has(southKey)) {
          setMaxOffset(repeatedPhaseColorYOffsets, northKey, requiredNorthOffset);
        }
      }
    }

    for (let x = 0; x < MAP_SIZE; ++x) {
      for (let z = 1; z < MAP_SIZE; ++z) {
        if (!currentSpec.includeAt(x, z)) continue;
        const color = colorGrid[x][z];
        if (isTransparentColor(color) || isWaterColor(color) || color.shade === Shade.Dark) continue;
        const southKey = cellKey(x, z);
        const northKey = cellKey(x, z - 1);
        // Compare land against the north column's top, including the full water depth.
        const rise = northWaterHeight(x, z - 1) + (color.shade === Shade.Light ? 1 : 0);
        if (shadedByCurrentNorth.has(southKey)) {
          setMaxOffset(currentPhaseColorYOffsets, southKey, (currentPhaseColorYOffsets.get(northKey) ?? 0) + rise);
          continue;
        }
        if (shadedByRepeatedNorth.has(southKey)) {
          setMaxOffset(currentPhaseColorYOffsets, southKey, (repeatedPhaseColorYOffsets.get(northKey) ?? 0) + rise);
        }
      }
    }
  };

  const collectBelowPlatformWaterColumns = () => {
    if (!belowPlatformWater || !allowMixStepReuse) return;
    const scanX = currentSpec.axis === "x" ? currentSpec.lines : Array.from({ length: MAP_SIZE }, (_, index) => index);
    for (const x of scanX) {
      if (x < 0 || x >= MAP_SIZE) continue;
      let repeatSouthWater = false;
      for (let z = MAP_SIZE - 2; z >= 0; --z) {
        const north = colorGrid[x][z];
        if (!isWaterColor(north)) {
          repeatSouthWater = false;
          continue;
        }
        const northWaterDrop = getWaterDrop(waterDrops, north.shade);
        const southZ = z + 1;
        const south = colorGrid[x][southZ];
        const currentSouthNeedsFlatWater =
          currentSpec.includeAt(x, southZ) &&
          !isTransparentColor(south) &&
          !isWaterColor(south) &&
          south.shade === Shade.Flat &&
          northWaterDrop === 0;
        if (currentSouthNeedsFlatWater) shadedByRepeatedNorth.add(cellKey(x, southZ));
        const shouldRepeat: boolean = currentSouthNeedsFlatWater || (repeatSouthWater && isWaterColor(south));
        if (shouldRepeat) repeatedBelowPlatformWaterColumns.add(cellKey(x, z));
        repeatSouthWater = shouldRepeat;
      }
    }
  };

  collectRepeatedNorthBlocks(PixelParity.Dominant, PixelParity.Recessive, previousSpec);
  collectRepeatedNorthBlocks(PixelParity.Recessive, PixelParity.Dominant, nextSpec);
  collectSharedNorthColumnsForWater(PixelParity.Dominant, PixelParity.Recessive, previousSpec);
  collectSharedNorthColumnsForWater(PixelParity.Recessive, PixelParity.Dominant, nextSpec);
  collectCurrentPhaseNorthReuse();
  collectBelowPlatformWaterColumns();
  propagateCurrentPhaseYOffsets();

  if (currentSpec.axis === "x") {
    for (const x of currentSpec.lines) {
      if (x < 0 || x >= MAP_SIZE) continue;
      const heights = mixedColumnHeights?.get(x);
      if (heights) {
        const column = mixedStepPalette ? colorGrid[x].map((color, z) =>
          getMixedStepColor(color, heights[z], colorGrid[x][z + 1], heights[z + 1], mixedStepPalette)) : colorGrid[x];
        for (let z = 0; z < MAP_SIZE; ++z) {
          const color = column[z];
          if (!currentSpec.includeAt(x, z) || isTransparentColor(color)) continue;
          const y = currentBaseY + heights[z];
          pushUnique({ x, y, z, ref: { kind: "color", color } });
          const north = z > 0 ? column[z - 1] : TRANSPARENT_COLOR;
          const northHeight = heights[z - 1];
          const reuse = mixedStepPalette ? getMixedStepReuse(north, northHeight, color, heights[z], mixedStepPalette) : undefined;
          const canReuseNorth = mixedStepPalette ? reuse === "color" : !isTransparentColor(north) && (color.shade === Shade.Flat
            ? northHeight === heights[z] : color.shade === Shade.Dark ? northHeight > heights[z] : northHeight < heights[z]);
          if (canReuseNorth) {
            pushUnique({ x, y: currentBaseY + northHeight, z: z - 1, ref: { kind: "color", color: north } });
          } else if (reuse === "support") {
            pushUnique(makeFillerBlock(x, currentBaseY + northHeight - 1, z - 1, FillerRole.SupportRetained));
          } else if (color.shade !== Shade.Light) {
            pushUnique(makeFillerBlock(x, y + (color.shade === Shade.Dark ? 1 : 0), z - 1, getShadeFillerRole(z - 1)));
            if (reuse === "color-support") pushUnique({ x, y: currentBaseY + northHeight, z: z - 1, ref: { kind: "color", color: north } });
          }
        }
        continue;
      }
      for (let z = 0; z < MAP_SIZE; ++z) {
        if (!currentSpec.includeAt(x, z)) continue;
        const color = colorGrid[x][z];
        if (isTransparentColor(color)) continue;
        if (belowPlatformWater && isWaterColor(color)) {
          // Zero-drop water shares the clearing plane and must be restored when this pixel updates.
          if (getWaterDrop(waterDrops, color.shade) === 0) pushUniqueDroppedWater({ x, y: currentBaseY, z, ref: { kind: "color", color } });
          continue;
        }
        if (shadedByRepeatedNorth.has(cellKey(x, z)) || shadedByCurrentNorth.has(cellKey(x, z))) {
          pushUnique({ x, y: getCurrentPhaseBaseY(x, z), z, ref: { kind: "color", color } });
          continue;
        }
        const heightBefore = stepBlocks.length;
        appendSuppressPixelBlocks(stepBlocks, loweredWaterBlocks, x, getCurrentPhaseBaseY(x, z), z, color, waterDrops);
        for (let i = heightBefore; i < stepBlocks.length; ++i) {
          occupied.add(toShapeCoordKey(stepBlocks[i].x, stepBlocks[i].y, stepBlocks[i].z));
        }
      }
    }
  } else {
    for (const z of currentSpec.lines) {
      if (z < 0 || z >= MAP_SIZE) continue;
      for (let x = 0; x < MAP_SIZE; ++x) {
        if (!currentSpec.includeAt(x, z)) continue;
        const color = colorGrid[x][z];
        if (isTransparentColor(color)) continue;
        if (belowPlatformWater && isWaterColor(color)) {
          if (getWaterDrop(waterDrops, color.shade) === 0) pushUniqueDroppedWater({ x, y: currentBaseY, z, ref: { kind: "color", color } });
          continue;
        }
        if (shadedByRepeatedNorth.has(cellKey(x, z)) || shadedByCurrentNorth.has(cellKey(x, z))) {
          pushUnique({ x, y: getCurrentPhaseBaseY(x, z), z, ref: { kind: "color", color } });
          continue;
        }
        const heightBefore = stepBlocks.length;
        appendSuppressPixelBlocks(stepBlocks, loweredWaterBlocks, x, getCurrentPhaseBaseY(x, z), z, color, waterDrops);
        for (let i = heightBefore; i < stepBlocks.length; ++i) {
          occupied.add(toShapeCoordKey(stepBlocks[i].x, stepBlocks[i].y, stepBlocks[i].z));
        }
      }
    }
  }

  const repeatedNorthBlocks = new Set<ColumnCoordKey>([
    ...repeatedNorthShaderColumns,
    ...repeatedNorthSharedColumns,
  ]);
  for (const key of repeatedNorthBlocks) {
    const [x, z] = parseColumnCoordKey(key);
    const color = colorGrid[x][z];
    if (isWaterColor(color)) {
      const heightBefore = stepBlocks.length;
      appendSuppressPixelBlocks(stepBlocks, loweredWaterBlocks, x, getRepeatedPhaseBaseY(x, z), z, color, waterDrops);
      for (let i = heightBefore; i < stepBlocks.length; ++i) {
        occupied.add(toShapeCoordKey(stepBlocks[i].x, stepBlocks[i].y, stepBlocks[i].z));
      }
      continue;
    }
    pushUnique({ x, y: getRepeatedPhaseBaseY(x, z), z, ref: { kind: "color", color } });
  }

  if (belowPlatformWater) {
    for (const key of repeatedBelowPlatformWaterColumns) {
      const [x, z] = parseColumnCoordKey(key);
      const color = colorGrid[x][z];
      if (!isWaterColor(color)) continue;
      const waterDrop = getWaterDrop(waterDrops, color.shade);
      pushUniqueDroppedWater({ x, y: getRepeatedPhaseBaseY(x, z) - waterDrop, z, ref: { kind: "color", color } });
    }
  }

  return { blocks: stepBlocks, loweredWaterBlocks };
}

function buildStepPhaseParts(
  colorGrid: ColorGrid,
  buildMode: StepwiseBuildMode,
  stepDirection: SuppressStepDirection,
  centerOut: boolean,
  mixSteps: boolean,
  mixedStepMaxHeight: number,
  waterDrops: WaterDrops | undefined,
  skipEmptySuppressSteps: boolean,
  cache?: GridShapeCache,
  mixedStepPalette?: MixedStepPalette,
): StepPhasePartsBuildResult {
  const belowPlatformWater = waterDrops !== undefined;
  const specs = buildSuppressStepPhases(buildMode, stepDirection, centerOut);
  const steps: RawShapePart[] = [];
  let hasAnyEmptyPhase = false;
  const mixedColumnHeights = mixSteps && mixedStepMaxHeight && getSuppressStepAxis(stepDirection) === "x"
    ? getMixedStepColumnHeights(colorGrid, mixedStepMaxHeight, cache, mixedStepPalette)
    : undefined;
  let yOffset = getStepPhaseYOffset(colorGrid, stepDirection, cache, waterDrops);
  if (mixedColumnHeights) {
    for (const [x, heights] of mixedColumnHeights) {
      for (let z = 0; z < MAP_SIZE; ++z) {
        yOffset = Math.max(yOffset, heights[z] + (colorGrid[x][z].shade === Shade.Dark ? 2 : 1));
      }
    }
  }
  const previewWaterBlocks = belowPlatformWater
    ? buildBelowPlatformWaterPreviewBlocks(colorGrid, 0, waterDrops)
    : [];

  if (previewWaterBlocks.length > 0) {
    steps.push(buildShapePart([], [], true, new Set<number>(), previewWaterBlocks));
  }

  // When empty suppress phases are skipped, later phases must reuse the next packed Y slot.
  let outputStepIndex = steps.length;
  for (let stepIndex = 0; stepIndex < specs.length; ++stepIndex) {
    const baseY = outputStepIndex * yOffset;
    const { blocks, loweredWaterBlocks } = buildStepPhaseBlocks(
      colorGrid,
      specs[stepIndex],
      baseY,
      mixSteps ? specs[stepIndex - 1] : undefined,
      mixSteps ? specs[stepIndex + 1] : undefined,
      mixSteps,
      waterDrops,
      mixedColumnHeights,
      mixedStepPalette,
    );
    const part = buildShapePart(blocks, [], true, new Set<number>([baseY - 1]), loweredWaterBlocks);
    const isEmptyPart = part.blocks.length === 0 && part.loweredWaterBlocks.length === 0 && part.fillerCandidates.length === 0;
    // An empty strip may still need a map update after removing the previous phase's shaders.
    const needsClearUpdate = centerOut && isEmptyPart && steps.at(-1)?.blocks.some(block =>
      block.z >= 0 && block.z < MAP_SIZE && specs[stepIndex].includeAt(block.x, block.z),
    );
    if (isEmptyPart) hasAnyEmptyPhase = true;
    if (skipEmptySuppressSteps && isEmptyPart && !needsClearUpdate) {
      continue;
    }
    part.suppressStepIndex = stepIndex;
    steps.push(part);
    outputStepIndex += 1;
  }

  return {
    parts: steps,
    hasAnyEmptyPhase,
  };
}

function finalizeShapePart(part: RawShapePart): ShapePart {
  const cells = new Map<ShapeCoordKey, ShapeCell>();
  // Share repeated palette colors instead of cloning a color object for every block.
  const colorCells = new Map<ShadedColorRef, ShapeColorRef>();
  const getColorCell = (color: ShadedColorRef & ShapeColorRef): ShapeColorRef => {
    let cell = colorCells.get(color);
    if (!cell) {
      cell = { id: color.id, isCustom: color.isCustom };
      if (color.fillerRole) cell.fillerRole = color.fillerRole;
      colorCells.set(color, cell);
    }
    return cell;
  };
  for (const block of part.blocks) {
    const key = toShapeCoordKey(block.x, block.y, block.z);
    cells.set(
      key,
      block.ref.kind === "color"
        ? getColorCell(block.ref.color)
        : [block.ref.role],
    );
  }
  for (const block of part.loweredWaterBlocks) {
    if (block.ref.kind !== "color") continue;
    const key = toShapeCoordKey(block.x, block.y, block.z);
    cells.set(key, getColorCell(block.ref.color));
  }
  for (const candidate of part.fillerCandidates) {
    const key = toShapeCoordKey(candidate.x, candidate.y, candidate.z);
    const existing = cells.get(key);
    if (!existing) {
      cells.set(key, [...candidate.roles]);
      continue;
    }
    if (!Array.isArray(existing)) continue;
    for (const role of candidate.roles) {
      if (!existing.includes(role)) existing.push(role);
    }
  }
  return {
    ...(part.suppressStepIndex === undefined ? {} : { suppressStepIndex: part.suppressStepIndex }),
    cells,
    bounds: part.bounds,
    supportFloorYs: part.supportFloorYs,
  };
}

type ShapeOptions = {
  environmentalPalette?: ReturnType<typeof getEnvironmentalSettings>["palette"];
  buildMode: InternalBuildMode;
  layerGap?: number;
  mixSteps?: boolean;
  mixedStepMaxHeight?: number;
  stepDirection?: SuppressStepDirection;
  centerOut?: boolean;
  paletteSeed?: number;
  waterDrops?: WaterDrops;
  topAlignedWater?: boolean;
  enableWaterConvenience?: boolean;
  buildAtWorldMinY?: boolean;
  skipEmptySuppressSteps?: boolean;
  useCrubTech?: boolean;
  includeTransparentBlocks?: boolean;
  transparentPlacementMode?: BuildMode;
  suppress2LayerLatePairY?: number;
  mixedStepPalette?: MixedStepPalette;
  stepSpacing?: SuppressStepSpacing;
};

function getShapeCacheKeyId({
  buildMode, layerGap = 0, mixSteps = false, mixedStepMaxHeight = 0, mixedStepPalette,
  stepDirection = SuppressStepDirection.EastToWest, centerOut = false, paletteSeed = 0,
  waterDrops, topAlignedWater = false, enableWaterConvenience = true, buildAtWorldMinY = false,
  skipEmptySuppressSteps = true, useCrubTech = false, includeTransparentBlocks = false,
  transparentPlacementMode = buildMode, suppress2LayerLatePairY = layerGap + 1,
}: ShapeOptions): ShapeCacheKeyId {
  const mixedStepHeightKey = mixedStepPalette ? `${mixedStepMaxHeight}:${mixedStepPalette.key}` : mixedStepMaxHeight;
  let id: string = buildMode;
  if (buildModeUsesLayerGap(buildMode)) id += `|gap:${layerGap}`;
  if (isSuppressStepsBuildMode(buildMode)) id += `|dir:${stepDirection}`;
  if (isSuppressStepsBuildMode(buildMode) && centerOut) id += "|center:1";
  if (isSuppressStepsBuildMode(buildMode) && mixSteps) id += "|mixsteps:1";
  if (isSuppressStepsBuildMode(buildMode) && mixSteps && mixedStepHeightKey) id += `|stepheight:${mixedStepHeightKey}`;
  if (isSuppressStepsBuildMode(buildMode)) id += `|skipempty:${skipEmptySuppressSteps ? 1 : 0}`;
  if (useCrubTech && buildModeUsesLayerGap(buildMode)) id += "|crubtech:1";
  if (buildMode === BuildMode.Suppress2LayerLatePairs) id += `|latepairy:${suppress2LayerLatePairY}`;
  if (buildModeUsesPaletteSeed(buildMode)) id += `|seed:${paletteSeed}`;
  if (waterDrops) id += `|waterdrop:${waterDrops[Shade.Light]},${waterDrops[Shade.Flat]},${waterDrops[Shade.Dark]}`;
  else if (topAlignedWater && isStaircaseBuildMode(buildMode)) id += "|watertop:1";
  if (buildAtWorldMinY && buildModeUsesWorldMinYGeometry(buildMode)) id += "|world-min-y:1";
  if (includeTransparentBlocks && isStaircaseBuildMode(buildMode)) id += "|id0:1";
  if (includeTransparentBlocks && transparentPlacementMode !== buildMode) id += `|id0mode:${transparentPlacementMode}`;
  if (isStaircaseBuildMode(buildMode) && buildMode !== BuildMode.StaircaseParty && !waterDrops && !topAlignedWater)
    id += `|waterconv:${enableWaterConvenience ? 1 : 0}`;
  return id as ShapeCacheKeyId;
}

function getCachedRawParts(cache: GridShapeCache, keyId: ShapeCacheKeyId, build: () => RawShapePart[]): RawShapePart[] {
  const cached = cache.rawParts.get(keyId);
  if (cached) return cached;
  const parts = build();
  cache.rawParts.set(keyId, parts);
  return parts;
}

function getStaircaseBaseCacheKey(excludeWater: boolean, topAlignedWater: boolean, buildAtWorldMinY: boolean): number {
  // Three water modes, each with two world-height modes.
  return ((excludeWater ? 2 : topAlignedWater ? 1 : 0) << 1) | (buildAtWorldMinY ? 1 : 0);
}

function getCachedStaircaseBaseBlocks(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  excludeWater: boolean,
  topAlignedWater: boolean,
  buildAtWorldMinY: boolean,
): ShapeBlock[] {
  const cacheKey = getStaircaseBaseCacheKey(excludeWater, topAlignedWater, buildAtWorldMinY);
  const cached = cache.staircaseBaseBlocks.get(cacheKey);
  if (cached) return cached;
  const blocks = buildStaircaseBlocks(colorGrid, excludeWater, topAlignedWater, buildAtWorldMinY);
  cache.staircaseBaseBlocks.set(cacheKey, blocks);
  return blocks;
}

function getStaircaseVariantCacheKey(
  buildMode: StaircaseInternalBuildMode,
  paletteSeed: number,
  excludeWater: boolean,
  topAlignedWater: boolean,
  buildAtWorldMinY: boolean,
): string {
  return [
    getStaircaseBaseCacheKey(excludeWater, topAlignedWater, buildAtWorldMinY),
    buildMode,
    buildModeUsesPaletteSeed(buildMode) ? paletteSeed : 0,
  ].join("|");
}

function getCachedStaircaseVariantBlocks(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: StaircaseInternalBuildMode,
  paletteSeed: number,
  waterDrops?: WaterDrops,
  topAlignedWater = false,
  buildAtWorldMinY = false,
): ShapeBlock[] {
  const excludeWater = waterDrops !== undefined;
  const key = getStaircaseVariantCacheKey(buildMode, paletteSeed, excludeWater, topAlignedWater, buildAtWorldMinY);
  const cached = cache.staircaseVariantBlocks.get(key);
  if (cached) return cached;

  const baseBlocks = buildMode === BuildMode.StaircaseGroup
    ? getCachedStaircaseVariantBlocks(colorGrid, cache, BuildMode.StaircaseValley, paletteSeed, waterDrops, topAlignedWater, buildAtWorldMinY)
    : getCachedStaircaseBaseBlocks(colorGrid, cache, excludeWater, topAlignedWater, buildAtWorldMinY);
  // Northline leaves the base untouched; per-shape changes operate on a separate clone.
  const blocks = buildMode === BuildMode.StaircaseNorthline ? baseBlocks : cloneShapeBlocks(baseBlocks);
  switch (buildMode) {
    case BuildMode.InclineUp:
    case BuildMode.InclineDown:
      throw new Error(`Unexpected incline mode in getCachedStaircaseVariantBlocks: ${buildMode}`);
    case BuildMode.StaircaseNorthline:
      break;
    case BuildMode.StaircaseSouthline:
      break;
    case BuildMode.StaircaseClassic:
      break;
    case BuildMode.StaircaseValley:
      applyStaircaseVariantValley(blocks, colorGrid, cache, excludeWater);
      break;
    case BuildMode.StaircaseGroup:
      applyStaircaseVariantGroupPostProcess(blocks, colorGrid, cache, excludeWater);
      break;
    case BuildMode.StaircaseParty:
      applyStaircaseVariantParty(blocks, colorGrid, paletteSeed, cache, excludeWater);
      break;
    default:
      assertUnhandledBuildMode(buildMode, "getCachedStaircaseVariantBlocks");
  }

  cache.staircaseVariantBlocks.set(key, blocks);
  return blocks;
}

function getCachedStaircaseParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: StaircaseInternalBuildMode,
  paletteSeed: number,
  waterDrops?: WaterDrops,
  topAlignedWater = false,
  enableWaterConvenience = true,
  buildAtWorldMinY = false,
  includeTransparentBlocks = false,
  transparentPlacementMode: TransparentPlacementBuildMode = buildMode,
): RawShapePart[] {
  const belowPlatformWater = waterDrops !== undefined;
  const sourceBuildMode =
    buildMode === BuildMode.StaircaseSouthline || buildMode === BuildMode.StaircaseClassic
      ? BuildMode.StaircaseNorthline
      : buildMode;
  const keyId = getShapeCacheKeyId({
    buildMode, paletteSeed, waterDrops, topAlignedWater, enableWaterConvenience,
    buildAtWorldMinY, includeTransparentBlocks, transparentPlacementMode,
  });
  return getCachedRawParts(cache, keyId, () => {
    if (buildMode === BuildMode.InclineUp || buildMode === BuildMode.InclineDown) {
      const blocks = buildInclineBlocks(colorGrid, buildMode, includeTransparentBlocks);
      return [buildShapePart(blocks)];
    }

    const blocks = cloneShapeBlocks(getCachedStaircaseVariantBlocks(colorGrid, cache, sourceBuildMode, paletteSeed, waterDrops, topAlignedWater, buildAtWorldMinY));
    const waterConvenienceFillerCandidates =
      belowPlatformWater || sourceBuildMode === BuildMode.StaircaseParty || topAlignedWater || !enableWaterConvenience
        ? []
        : addStaircaseWaterConvenienceFillers(blocks, colorGrid, cache);

    if (buildMode === BuildMode.StaircaseSouthline) {
      const southlineOffsets = getStaircaseSouthlineColumnOffsets(blocks, topAlignedWater);
      applyColumnYOffsets(blocks, southlineOffsets);
      applyColumnYOffsets(waterConvenienceFillerCandidates, southlineOffsets);
    } else if (buildMode === BuildMode.StaircaseClassic) {
      const classicOffsets = getStaircaseClassicColumnOffsets(blocks);
      applyColumnYOffsets(blocks, classicOffsets);
      applyColumnYOffsets(waterConvenienceFillerCandidates, classicOffsets);
    }

    if (belowPlatformWater) {
      const { loweredWaterBlocks, supportFloorYs } = buildBelowPlatformWaterBlocks(blocks, colorGrid, waterDrops);
      let suppressedTransparentVsCollisionCount = 0;
      if (includeTransparentBlocks) {
        const transparentResult = buildTransparentStaircaseBlocks(
          colorGrid,
          blocks,
          transparentPlacementMode,
          paletteSeed,
          loweredWaterBlocks,
        );
        blocks.push(...transparentResult.blocks);
        suppressedTransparentVsCollisionCount = transparentResult.suppressedTransparentVsCollisionCount;
      }
      return [buildShapePart(blocks, [], true, supportFloorYs, loweredWaterBlocks, suppressedTransparentVsCollisionCount)];
    }
    let suppressedTransparentVsCollisionCount = 0;
    if (includeTransparentBlocks) {
      const transparentResult = buildTransparentStaircaseBlocks(colorGrid, blocks, transparentPlacementMode, paletteSeed);
      blocks.push(...transparentResult.blocks);
      suppressedTransparentVsCollisionCount = transparentResult.suppressedTransparentVsCollisionCount;
    }
    return [buildShapePart(blocks, waterConvenienceFillerCandidates, true, undefined, [], suppressedTransparentVsCollisionCount)];
  });
}

function getCachedSuppressSplitParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: BuildMode.SuppressSplitRow | BuildMode.SuppressSplitChecker,
  waterDrops?: WaterDrops,
): RawShapePart[] {
  const keyId = getShapeCacheKeyId({ buildMode, waterDrops });
  return getCachedRawParts(cache, keyId, () =>
      buildMode === BuildMode.SuppressSplitRow
        ? buildSuppressSplitRowBlockSets(colorGrid, waterDrops).map(({ blocks, loweredWaterBlocks }) => buildShapePart(blocks, [], true, new Set<number>([-1]), loweredWaterBlocks))
        : buildSuppressSplitCheckerBlockSets(colorGrid, waterDrops).map(({ blocks, loweredWaterBlocks }) => buildShapePart(blocks, [], true, new Set<number>([-1]), loweredWaterBlocks)),
  );
}

function getCachedSuppressStepParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: StepwiseBuildMode,
  stepDirection: SuppressStepDirection,
  centerOut: boolean,
  mixSteps: boolean,
  mixedStepMaxHeight: number,
  skipEmptySuppressSteps: boolean,
  waterDrops?: WaterDrops,
  mixedStepPalette?: MixedStepPalette,
): RawShapePart[] {
  const keyOptions = { buildMode, mixSteps, mixedStepMaxHeight, mixedStepPalette, stepDirection, centerOut, waterDrops, skipEmptySuppressSteps };
  const keyId = getShapeCacheKeyId(keyOptions);
  const cached = cache.rawParts.get(keyId);
  if (cached) return cached;

  const rawPartsBuild = buildStepPhaseParts(colorGrid, buildMode, stepDirection, centerOut, mixSteps, mixedStepMaxHeight, waterDrops, skipEmptySuppressSteps, cache, mixedStepPalette);
  cache.rawParts.set(keyId, rawPartsBuild.parts);
  if (!rawPartsBuild.hasAnyEmptyPhase) {
    const alternateKeyId = getShapeCacheKeyId({ ...keyOptions, skipEmptySuppressSteps: !skipEmptySuppressSteps });
    cache.rawParts.set(alternateKeyId, rawPartsBuild.parts);
  }
  return rawPartsBuild.parts;
}

function getCachedSuppress2LayerParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  layerGap: number,
  buildMode: TwoLayerSuppressBuildMode,
  suppress2LayerLatePairY: number,
  useCrubTech: boolean,
  waterDrops?: WaterDrops,
): RawShapePart[] {
  const keyId = getShapeCacheKeyId({ buildMode, layerGap, waterDrops, useCrubTech, suppress2LayerLatePairY });
  return getCachedRawParts(cache, keyId, () => {
    const { blocks, loweredWaterBlocks, supportFloorYs } = buildSuppressDualLayerBlocks(
      colorGrid,
      layerGap,
      suppress2LayerLatePairY,
      buildMode,
      useCrubTech,
      waterDrops,
    );
    return [buildShapePart(blocks, [], true, supportFloorYs, loweredWaterBlocks, 0, useCrubTech ? Math.max(1, layerGap) : undefined)];
  });
}

function buildRawShapeParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  {
    buildMode, layerGap = 0, mixSteps = false, mixedStepMaxHeight = 0, mixedStepPalette,
    stepDirection = SuppressStepDirection.EastToWest, centerOut = false, paletteSeed = 0,
    waterDrops, topAlignedWater = false, enableWaterConvenience = true, buildAtWorldMinY = false,
    skipEmptySuppressSteps = true, useCrubTech = false, includeTransparentBlocks = false,
    transparentPlacementMode = buildMode, suppress2LayerLatePairY = layerGap + 1,
  }: ShapeOptions,
): RawShapePart[] {
  switch (buildMode) {
    case BuildMode.SuppressSplitRow:
      return getCachedSuppressSplitParts(colorGrid, cache, BuildMode.SuppressSplitRow, waterDrops);
    case BuildMode.SuppressSplitChecker:
      return getCachedSuppressSplitParts(colorGrid, cache, BuildMode.SuppressSplitChecker, waterDrops);
    case BuildMode.SuppressStepPairs:
      return getCachedSuppressStepParts(colorGrid, cache, BuildMode.SuppressStepPairs, stepDirection, centerOut, mixSteps, mixedStepMaxHeight, skipEmptySuppressSteps, waterDrops, mixedStepPalette);
    case BuildMode.SuppressStepChecker:
      return getCachedSuppressStepParts(colorGrid, cache, BuildMode.SuppressStepChecker, stepDirection, centerOut, mixSteps, mixedStepMaxHeight, skipEmptySuppressSteps, waterDrops, mixedStepPalette);
    case BuildMode.Suppress2LayerLateFillers:
      return getCachedSuppress2LayerParts(
        colorGrid,
        cache,
        layerGap,
        BuildMode.Suppress2LayerLateFillers,
        suppress2LayerLatePairY,
        useCrubTech,
        waterDrops,
      );
    case BuildMode.Suppress2LayerLatePairs:
      return getCachedSuppress2LayerParts(
        colorGrid,
        cache,
        layerGap,
        BuildMode.Suppress2LayerLatePairs,
        suppress2LayerLatePairY,
        useCrubTech,
        waterDrops,
      );
    default: {
      return getCachedStaircaseParts(
        colorGrid,
        cache,
        buildMode,
        paletteSeed,
        waterDrops,
        topAlignedWater,
        enableWaterConvenience,
        buildAtWorldMinY,
        includeTransparentBlocks,
        transparentPlacementMode as TransparentPlacementBuildMode,
      );
    }
  }
}

function addEnvironmentalBlocks(part: RawShapePart, palette: NonNullable<ReturnType<typeof getEnvironmentalSettings>["palette"]>): RawShapePart {
  const additions = new Map<ShapeCoordKey, ShapeBlock>();
  let needsCollisionCheck = false;
  for (const block of part.blocks) {
    if (block.ref.kind !== "color" || block.ref.color.fillerRole) continue;
    const role = palette.roles[getColorRefKey(block.ref.color)];
    if (!role) continue;
    const y = block.y + (role === FillerRole.GrowthCover ? 1 : -1);
    const coord = toShapeCoordKey(block.x, y, block.z);
    if (!additions.has(coord)) additions.set(coord, makeFillerBlock(block.x, y, block.z, role));
    if (y >= part.bounds.minY && y <= part.bounds.maxY) needsCollisionCheck = true;
  }
  // An empty phase or placements wholly outside its height range need no collision scan.
  if (!additions.size) return part;
  if (needsCollisionCheck) {
    for (const blocks of [part.blocks, part.loweredWaterBlocks]) for (const block of blocks) {
      additions.delete(toShapeCoordKey(block.x, block.y, block.z));
    }
    if (!additions.size) return part;
  }
  const blocks = part.blocks.concat([...additions.values()]);
  // Original X/Z bounds already include each source column. Only Y can grow.
  if (![...part.supportFloorYs].some(y => y >= part.bounds.minY && y <= part.bounds.maxY)) {
    let { minY, maxY } = part.bounds;
    for (const block of additions.values()) if (!part.supportFloorYs.has(block.y)) {
      minY = Math.min(minY, block.y);
      maxY = Math.max(maxY, block.y);
    }
    return { ...part, blocks, bounds: { ...part.bounds, minY, maxY } };
  }
  return {
    ...part, blocks,
    // Assumed platforms are not part of the printing height, just as for ordinary supports.
    bounds: measureShapeBounds(blocks.filter(block => !part.supportFloorYs.has(block.y)), part.loweredWaterBlocks),
  };
}

function spaceSuppressStepParts(parts: RawShapePart[], { minimum, uniform, keepExtras }: SuppressStepSpacing, environmental = false): RawShapePart[] {
  const phases = parts.filter(part => part.suppressStepIndex !== undefined).map(part => {
    const floor = Math.min(...part.supportFloorYs) + 1;
    const hasBlocks = part.blocks.length > 0 || part.loweredWaterBlocks.length > 0;
    return {
      floor,
      bottom: hasBlocks ? Math.min(0, part.bounds.minY - floor) : 0,
      height: hasBlocks ? Math.max(1, part.bounds.maxY - floor + 1) : 1,
    };
  });
  if (!phases.length) return parts;
  const originalOffset = phases.length > 1 ? phases[1].floor - phases[0].floor : phases[0].floor || phases[0].height;
  const uniformOffset = Math.max(minimum, originalOffset, environmental ? Math.max(...phases.map(phase => phase.height)) - Math.min(...phases.map(phase => phase.bottom)) : 0);
  if (uniform && uniformOffset === originalOffset) return parts;
  // Barriers must reach the same clearance ceiling in every phase, including empty ones.
  const clearanceHeight = keepExtras ? Math.max(...phases.map(phase => phase.height)) : 1;
  let index = 0;
  let floor = 0;
  return parts.map(part => {
    // The initial below-platform water reference is not a movable build phase.
    if (part.suppressStepIndex === undefined) return part;
    const phase = phases[index];
    if (uniform) floor = phase.floor / originalOffset * uniformOffset;
    else if (index === 0) floor = phase.floor ? Math.max(minimum, phase.floor) : 0;
    else floor += Math.max(minimum, Math.max(phases[index - 1].height, clearanceHeight) - phase.bottom);
    ++index;
    const shift = floor - phase.floor;
    // Reject oversized spacing before packed coordinates could wrap into another column.
    for (const y of [floor + phase.bottom - 1, floor + Math.max(phase.height, clearanceHeight) - 1]) {
      if (!Number.isSafeInteger(y) || parseShapeCoordKey(toShapeCoordKey(0, y, 0))[1] !== y) {
        throw new RangeError("Suppression steps exceed the supported schematic height. Reduce the minimum step Y offset.");
      }
    }
    if (shift === 0) return part;
    return {
      ...part,
      blocks: part.blocks.map(block => ({ ...block, y: block.y + shift })),
      loweredWaterBlocks: part.loweredWaterBlocks.map(block => ({ ...block, y: block.y + shift })),
      fillerCandidates: part.fillerCandidates.map(candidate => ({ ...candidate, y: candidate.y + shift })),
      supportFloorYs: new Set([...part.supportFloorYs].map(y => y + shift)),
      bounds: { ...part.bounds, minY: part.bounds.minY + shift, maxY: part.bounds.maxY + shift },
    };
  });
}

function getGeneratedShape(
  colorGrid: ColorGrid,
  options: ShapeOptions,
): CachedGeneratedShape {
  const { buildMode, stepDirection = SuppressStepDirection.EastToWest, centerOut = false, stepSpacing, environmentalPalette } = options;
  const cache = getGridShapeCache(colorGrid);
  let cacheKeyId = getShapeCacheKeyId(options);
  if (stepSpacing) cacheKeyId = `${cacheKeyId}|spacing:${stepSpacing.minimum}:${stepSpacing.uniform ? 1 : 0}:${!stepSpacing.uniform && stepSpacing.keepExtras ? 1 : 0}` as ShapeCacheKeyId;
  if (environmentalPalette) cacheKeyId = `${cacheKeyId}|environment:${environmentalPalette.key}` as ShapeCacheKeyId;
  const cached = cache.shapes.get(cacheKeyId);
  if (cached) return cached;

  const rawParts = buildRawShapeParts(colorGrid, cache, options);
  const environmentalParts = environmentalPalette ? rawParts.map(part => addEnvironmentalBlocks(part, environmentalPalette)) : rawParts;
  const parts = (stepSpacing ? spaceSuppressStepParts(environmentalParts, stepSpacing, !!environmentalPalette) : environmentalParts).map(finalizeShapePart);
  const splitExportNames =
    buildMode === BuildMode.SuppressSplitRow
      ? ["odd_rows", "even_rows"] as [string, string]
      : buildMode === BuildMode.SuppressSplitChecker
        ? ["dominant", "recessive"] as [string, string]
        : null;
  const shape: GeneratedShape = {
    parts,
    ...(buildMode === BuildMode.SuppressStepPairs || buildMode === BuildMode.SuppressStepChecker
      ? { suppressStepLayout: { buildMode, direction: stepDirection, centerOut } } : {}),
    partType:
      buildMode === BuildMode.SuppressStepPairs || buildMode === BuildMode.SuppressStepChecker
        ? ShapePartType.SuppressStepPhases
        : ShapePartType.SingleColumn,
    splitExportNames,
    suppressedTransparentVsCollisionCount: rawParts.reduce(
      (sum, part) => sum + part.suppressedTransparentVsCollisionCount,
      0,
    ),
  };
  const generatedShape = { shape };
  cache.shapes.set(cacheKeyId, generatedShape);
  return generatedShape;
}

// Callers:
// - src/lib/tileGeometry.ts
export function generateShapeMap(
  colorGrid: ColorGrid,
  allSameShade: Shade | undefined,
  hasWater: boolean,
  hasTransparency: boolean,
  requiresTwoLayerLateShading: boolean,
  options: {
    environmentalPalette?: ReturnType<typeof getEnvironmentalSettings>["palette"];
    layerGap: number;
    mixSteps?: boolean;
    suppressCenterOut?: boolean;
    mixedStepMaxHeight?: number;
    mixedStepPalette?: MixedStepPalette;
    paletteSeed?: number;
    waterSetting?: StaircaseWaterSetting;
    enableWaterConvenience?: boolean;
    buildAtWorldMinY?: boolean;
    skipEmptySuppressSteps?: boolean;
    minSuppressStepOffset?: number;
    uniformSuppressStepSpacing?: boolean;
    keepSuppressExtras?: boolean;
    suppress2LayerLatePairY?: number;
    useCrubTech?: boolean;
    includeTransparentBlocks?: boolean;
    collapseStaircaseModes?: boolean;
    includeFlatNorthline?: boolean;
    selectedMode?: BuildMode | null;
    selectedStepDirection: SuppressStepDirection;
  },
): Partial<Record<BuildMode, GeneratedShape>> {
  const mixSteps = options.mixSteps ?? false;
  const mixedStepMaxHeight = options.mixedStepMaxHeight ?? 0;
  if (!Number.isInteger(mixedStepMaxHeight) || mixedStepMaxHeight < 0 || mixedStepMaxHeight > 10) {
    throw new RangeError("Mixed-step height must be an integer from 0 to 10");
  }
  const stepDirection = options.selectedStepDirection;
  const mixedStepPalette = mixSteps && mixedStepMaxHeight > 0 && getSuppressStepAxis(stepDirection) === "x"
    ? options.mixedStepPalette : undefined;
  const paletteSeed = options.paletteSeed ?? 0;
  const waterDrops = options.waterSetting?.kind === "below-platform" ? options.waterSetting.drops : undefined;
  const topAlignedWater = options.waterSetting?.kind === "top-aligned";
  const enableWaterConvenience = hasWater && !options.waterSetting && (options.enableWaterConvenience ?? true);
  const buildAtWorldMinY = options.buildAtWorldMinY ?? false;
  const skipEmptySuppressSteps = options.skipEmptySuppressSteps ?? true;
  const minimumStepOffset = options.minSuppressStepOffset ?? 1;
  const uniformStepSpacing = options.uniformSuppressStepSpacing ?? true;
  if (!Number.isSafeInteger(minimumStepOffset) || minimumStepOffset < 1) {
    throw new RangeError("Minimum step Y offset must be a positive integer");
  }
  const layerGap = Math.max(options.layerGap, options.environmentalPalette?.minimumLayerGap ?? 0);
  const requestedLatePairY = options.suppress2LayerLatePairY ?? Math.max(1, layerGap) + 1;
  const suppress2LayerLatePairY = options.environmentalPalette ? Math.max(layerGap + 1, requestedLatePairY) : requestedLatePairY;
  const useCrubTech = options.useCrubTech ?? false;
  const includeTransparentBlocks = options.includeTransparentBlocks ?? false;
  const collapseStaircaseModes = options.collapseStaircaseModes ?? true;
  const includeFlatNorthline = options.includeFlatNorthline ?? false;
  const selectedMode = options.selectedMode ?? null;
  const requestedModes: BuildMode[] = getRequestedStaircaseModes(
    selectedMode,
    allSameShade,
    hasWater,
    hasTransparency,
    collapseStaircaseModes,
    includeFlatNorthline,
  );
  const suppressVisibleModes: BuildMode[] = requiresTwoLayerLateShading
    ? [...BASE_SUPPRESS_BUILD_MODES, BuildMode.Suppress2LayerLateFillers, BuildMode.Suppress2LayerLatePairs]
    : [...BASE_SUPPRESS_BUILD_MODES, BuildMode.Suppress2Layer];
  if (selectedMode && suppressVisibleModes.includes(selectedMode)) requestedModes.push(selectedMode);
  const seenShapeSignatures = new Set<GeneratedShapeSignatureId>();
  const shapes: Partial<Record<BuildMode, GeneratedShape>> = {};

  for (const buildMode of requestedModes) {
    const internalBuildMode = getCanonicalBuildMode(buildMode);
    const generated = getGeneratedShape(colorGrid, {
      environmentalPalette: options.environmentalPalette,
      buildMode: internalBuildMode, layerGap, mixSteps, mixedStepMaxHeight, stepDirection,
      centerOut: options.suppressCenterOut === true && isSuppressStepsBuildMode(buildMode),
      paletteSeed, waterDrops, topAlignedWater, enableWaterConvenience, buildAtWorldMinY,
      skipEmptySuppressSteps, useCrubTech, includeTransparentBlocks, transparentPlacementMode: buildMode,
      suppress2LayerLatePairY, mixedStepPalette,
      stepSpacing: isSuppressStepsBuildMode(buildMode) && (minimumStepOffset !== 1 || !uniformStepSpacing || !!options.environmentalPalette)
        ? { minimum: minimumStepOffset, uniform: uniformStepSpacing, keepExtras: options.keepSuppressExtras === true }
        : undefined,
    });
    // Single-mode jobs still generate the full shape, but have nothing to deduplicate.
    if (requestedModes.length > 1) {
      const signatureId = generated.signatureId ??= getGeneratedShapeSignatureId(generated.shape);
      if (seenShapeSignatures.has(signatureId)) continue;
      seenShapeSignatures.add(signatureId);
    }
    shapes[buildMode] = generated.shape;
  }

  return shapes;
}
