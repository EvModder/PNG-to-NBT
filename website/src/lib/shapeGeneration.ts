/**
 * Public API:
 * - generateShapeMap()
 *
 * Callers:
 * - src/Index.tsx
 */
import {
  buildModeUsesLayerGap,
  isSuppressStepsBuildMode,
  buildModeUsesPaletteSeed,
} from "@/utils/conversion";
import { FillerRole, BuildMode, SuppressStepDirection } from "@/types/conversion";
import { type ColorGrid, Shade } from "@/types/color";
import type { ShadedColorRef } from "@/types/color";
import type { GeneratedShape, ShapeCell, ShapeCoordKey, ShapePart } from "@/types/shape";
import { MAP_SIZE, TRANSPARENT_COLOR, isTransparentColor, isWaterColor } from "@/utils/color";
import { PixelParity, getPixelParity, type WaterDrops } from "./colorGridAnalysis";
import { ShapePartType } from "@/types/shape";
import { parseShapeCoordKey, toShapeCoordKey } from "./shapeModel";

type PositionedEntry = { x: number; y: number; z: number };
type ShapeRef =
  | { kind: "color"; color: ShadedColorRef }
  | { kind: "filler"; role: FillerRole };
type ShapeBlock = PositionedEntry & { ref: ShapeRef };
type FillerCandidate = PositionedEntry & { roles: FillerRole[] };
type ShapeBounds = ShapePart["bounds"];
type RecessivePlacementOverride = {
  colorY: number;
  fillerY?: number;
};
type StepPhaseSpec = {
  axis: "x" | "z";
  lines: readonly number[];
  includeAt: (x: number, z: number) => boolean;
};
type ShapeBlockSet = {
  blocks: ShapeBlock[];
  loweredWaterBlocks: ShapeBlock[];
};
interface RawShapePart {
  blocks: ShapeBlock[];
  loweredWaterBlocks: ShapeBlock[];
  fillerCandidates: FillerCandidate[];
  bounds: ShapeBounds;
  supportFloorYs: ReadonlySet<number>;
}

type StepwiseBuildMode = BuildMode.SuppressStepPairs | BuildMode.SuppressStepChecker;
type TwoLayerSuppressBuildMode = BuildMode.Suppress2LayerLateFillers | BuildMode.Suppress2LayerLatePairs;
type InternalBuildMode =
  | BuildMode.StaircaseNorthline
  | BuildMode.StaircaseSouthline
  | BuildMode.StaircaseClassic
  | BuildMode.StaircaseValley
  | BuildMode.StaircaseGrouped
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
  signatureId: GeneratedShapeSignatureId;
};
// Alias build modes are canonicalized before staircase-mode dispatch.
type StaircaseInternalBuildMode =
  | BuildMode.StaircaseNorthline
  | BuildMode.StaircaseSouthline
  | BuildMode.StaircaseClassic
  | BuildMode.StaircaseValley
  | BuildMode.StaircaseGrouped
  | BuildMode.StaircaseParty;

type ColumnPixelCell = { shade: Shade; isWater: boolean };
type ColumnCoordKey = number;

const DEFAULT_STAIRCASE_BUILD_MODES: InternalBuildMode[] = [
  BuildMode.StaircaseNorthline,
  BuildMode.StaircaseSouthline,
  BuildMode.StaircaseClassic,
  BuildMode.StaircaseValley,
  BuildMode.StaircaseGrouped,
  BuildMode.StaircaseParty,
];

const BASE_SUPPRESS_BUILD_MODES: InternalBuildMode[] = [
  BuildMode.SuppressSplitRow,
  BuildMode.SuppressSplitChecker,
  BuildMode.SuppressStepPairs,
  BuildMode.SuppressStepChecker,
];

const COLUMN_COORD_Z_OFFSET = 256;
const COLUMN_COORD_Z_SIZE = 512;

function assertUnhandledBuildMode(buildMode: never, context: string): never {
  throw new Error(`Unhandled BuildMode in ${context}: ${String(buildMode)}`);
}

function getCanonicalBuildMode(buildMode: BuildMode): InternalBuildMode {
  switch (buildMode) {
    case BuildMode.Flat:
    case BuildMode.InclineUp:
    case BuildMode.InclineDown:
      return BuildMode.StaircaseNorthline;
    case BuildMode.Suppress2Layer:
      return BuildMode.Suppress2LayerLateFillers;
    default:
      return buildMode;
  }
}

function toColumnCoordKey(x: number, z: number): ColumnCoordKey {
  return (x + 1) * COLUMN_COORD_Z_SIZE + (z + COLUMN_COORD_Z_OFFSET);
}

function parseColumnCoordKey(key: ColumnCoordKey): [number, number] {
  return [Math.floor(key / COLUMN_COORD_Z_SIZE) - 1, (key % COLUMN_COORD_Z_SIZE) - COLUMN_COORD_Z_OFFSET];
}

interface GridShapeCache {
  shapes: Map<ShapeCacheKeyId, CachedGeneratedShape>;
  rawParts: Map<ShapeCacheKeyId, RawShapePart[]>;
  // Per-X non-transparent source-pixel lookup used by staircase transforms.
  columnPixelsByZ: Map<number, Map<number, ColumnPixelCell>>;
  // Water-filtered variant of the same lookup, for below-platform staircase shaping.
  columnNonWaterPixelsByZ: Map<number, Map<number, ColumnPixelCell>>;
  staircaseBaseBlocks: Map<string, ShapeBlock[]>;
  // Per-mode staircase layouts before water convenience fillers or lowered-water overlays are added.
  staircaseVariantBlocks: Map<string, ShapeBlock[]>;
  // Cached vertical spacing between suppress step phases for this image.
  stepPhaseYOffsets: Map<string, number>;
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

type HashState = [number, number, number, number];

function createHashState(): HashState {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
}

function mixUint32(state: HashState, value: number): void {
  const v = value >>> 0;
  state[0] = Math.imul((state[0] ^ v) >>> 0, 0x01000193) >>> 0;
  state[1] = Math.imul((state[1] + v + 0x7f4a7c15) >>> 0, 0x27d4eb2d) >>> 0;
  state[2] = Math.imul((state[2] ^ ((v << 16) | (v >>> 16))) >>> 0, 0x165667b1) >>> 0;
  state[3] = Math.imul((state[3] + (v ^ 0x9e3779b9)) >>> 0, 0x85ebca77) >>> 0;
}

function mixString(state: HashState, value: string): void {
  for (let i = 0; i < value.length; ++i) mixUint32(state, value.charCodeAt(i));
  mixUint32(state, 0xff);
}

function getGeneratedShapeSignatureId(shape: GeneratedShape): GeneratedShapeSignatureId {
  const state = createHashState();
  mixString(state, shape.partType);
  mixString(state, shape.splitExportNames?.[0] ?? "");
  mixString(state, shape.splitExportNames?.[1] ?? "");
  mixUint32(state, shape.parts.length);

  for (const part of shape.parts) {
    mixUint32(state, part.bounds.minY);
    mixUint32(state, part.bounds.maxY);
    mixUint32(state, part.bounds.minZ);
    mixUint32(state, part.bounds.maxZ);
    const floorYs = [...part.supportFloorYs].sort((a, b) => a - b);
    mixUint32(state, floorYs.length);
    for (const floorY of floorYs) mixUint32(state, floorY);

    const cells = [...part.cells.entries()].sort(([coordA], [coordB]) => coordA - coordB);
    mixUint32(state, cells.length);
    for (const [coord, cell] of cells) {
      mixUint32(state, coord);
      if (!Array.isArray(cell)) {
        mixUint32(state, 0);
        mixUint32(state, cell.isCustom ? 1 : 0);
        mixUint32(state, cell.id);
        continue;
      }

      mixUint32(state, 1);
      const roles = [...cell].sort();
      mixUint32(state, roles.length);
      for (const role of roles) mixString(state, role);
    }
  }

  return state.map(part => part.toString(16).padStart(8, "0")).join("") as GeneratedShapeSignatureId;
}

function getCachedColumnPixelInfo(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  x: number,
  excludeWater = false,
): Map<number, ColumnPixelCell> {
  const targetCache = excludeWater ? cache.columnNonWaterPixelsByZ : cache.columnPixelsByZ;
  const cached = targetCache.get(x);
  if (cached) return cached;
  const info = new Map<number, { shade: number; isWater: boolean }>();
  for (let z = 0; z < MAP_SIZE; ++z) {
    const color = colorGrid[x][z];
    if (isTransparentColor(color)) continue;
    if (excludeWater && isWaterColor(color)) continue;
    info.set(z, { shade: color.shade, isWater: isWaterColor(color) });
  }
  targetCache.set(x, info);
  return info;
}

function makeFillerBlock(x: number, y: number, z: number, role: FillerRole): ShapeBlock {
  return { x, y, z, ref: { kind: "filler", role } };
}

function cloneShapeBlocks(blocks: ShapeBlock[]): ShapeBlock[] {
  return blocks.map(block => ({
    x: block.x,
    y: block.y,
    z: block.z,
    ref: block.ref.kind === "color" ? { kind: "color", color: block.ref.color } : { kind: "filler", role: block.ref.role },
  }));
}

function groupBlocksByColumn<T extends PositionedEntry>(blocks: T[]): T[][] {
  const columns = Array.from({ length: MAP_SIZE }, () => [] as T[]);
  for (const block of blocks) columns[block.x].push(block);
  return columns;
}

interface ColumnBlockRows<T extends PositionedEntry> {
  rowBlocks: (T[] | undefined)[];
  rowMinY: number[];
  rowMaxY: number[];
  rowPresent: boolean[];
  zValues: number[];
}

function buildColumnBlockRows<T extends PositionedEntry>(colBlocks: T[]): ColumnBlockRows<T> {
  const rowBlocks = new Array<T[] | undefined>(MAP_SIZE + 1);
  const rowMinY = new Array<number>(MAP_SIZE + 1).fill(Infinity);
  const rowMaxY = new Array<number>(MAP_SIZE + 1).fill(-Infinity);
  const rowPresent = new Array<boolean>(MAP_SIZE + 1).fill(false);
  const zValues: number[] = [];

  for (const block of colBlocks) {
    const idx = block.z + 1;
    let row = rowBlocks[idx];
    if (!row) {
      row = [];
      rowBlocks[idx] = row;
      rowPresent[idx] = true;
      zValues.push(block.z);
    }
    row.push(block);
    if (block.y < rowMinY[idx]) rowMinY[idx] = block.y;
    if (block.y > rowMaxY[idx]) rowMaxY[idx] = block.y;
  }

  return { rowBlocks, rowMinY, rowMaxY, rowPresent, zValues };
}

function getWaterDepth(shade: Shade, x: number, z: number): number {
  switch (shade) {
    case Shade.Light:
      return 1;
    case Shade.Flat:
      return getPixelParity(x, z) === PixelParity.Recessive ? 5 : 3;
    case Shade.Dark:
      return getPixelParity(x, z) === PixelParity.Recessive ? 10 : 7;
    default:
      throw new Error(`Unexpected water shade for depth lookup: ${shade}`);
  }
}

function getWaterDrop(waterDrops: WaterDrops, shade: Shade): number {
  const waterDrop = (waterDrops as readonly (number | undefined)[])[shade];
  if (waterDrop === undefined) throw new Error(`Unexpected water shade for drop lookup: ${shade}`);
  return waterDrop;
}

function isWaterBlock(block: ShapeBlock): boolean {
  return block.ref.kind === "color" && isWaterColor(block.ref.color);
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
    const [ax, az] = parseColumnCoordKey(a[0]);
    const [bx, bz] = parseColumnCoordKey(b[0]);
    return ax !== bx ? ax - bx : bz - az;
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
    if (block.ref.kind === "color" && !isWaterColor(block.ref.color)) {
      const candidate = ensureCandidate(block.x, block.y - 1, block.z);
      if (candidate) {
        if (!candidate.roles.includes(FillerRole.SupportFragile)) candidate.roles.push(FillerRole.SupportFragile);
      }
    }
    if (!isWaterBlock(block)) continue;
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

  return [...byCoord.values()];
}

function buildBelowOnlyWaterFillerCandidates(blocks: ShapeBlock[], occupiedExtraBlocks: ShapeBlock[] = []): FillerCandidate[] {
  const occupied = new Set<ShapeCoordKey>();
  const waterBottoms = new Map<ColumnCoordKey, PositionedEntry>();

  for (const block of blocks) {
    occupied.add(toShapeCoordKey(block.x, block.y, block.z));
    if (!isWaterBlock(block)) continue;
    const coord = toColumnCoordKey(block.x, block.z);
    const current = waterBottoms.get(coord);
    if (!current || block.y < current.y) waterBottoms.set(coord, { x: block.x, y: block.y, z: block.z });
  }
  for (const block of occupiedExtraBlocks) occupied.add(toShapeCoordKey(block.x, block.y, block.z));

  const candidates: FillerCandidate[] = [];
  for (const bottom of waterBottoms.values()) {
    const belowKey = toShapeCoordKey(bottom.x, bottom.y - 1, bottom.z);
    if (occupied.has(belowKey)) continue;
    candidates.push({ x: bottom.x, y: bottom.y - 1, z: bottom.z, roles: [FillerRole.SupportWaterBase] });
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
): RawShapePart {
  assertShapeBlockZRange(blocks);
  assertShapeBlockZRange(loweredWaterBlocks);
  const bounds = measureShapeBounds(blocks, loweredWaterBlocks);
  const fillerCandidates = includeDefaultFillerCandidates
    ? [...buildFillerCandidates(blocks, loweredWaterBlocks), ...buildBelowOnlyWaterFillerCandidates(blocks, loweredWaterBlocks), ...extraFillerCandidates]
    : extraFillerCandidates;
  return {
    blocks,
    loweredWaterBlocks,
    fillerCandidates,
    bounds,
    supportFloorYs: supportFloorYs ?? new Set<number>([bounds.minY - 1]),
  };
}

function getShadeFillerRole(z: number): FillerRole {
  return z < 0 ? FillerRole.ShadeNorthRow : FillerRole.ShadeSuppress;
}

function makeVoidAwareShadeFiller(x: number, y: number, z: number): ShapeBlock {
  if (z < 0) return makeFillerBlock(x, y, z, FillerRole.ShadeNorthRow);
  return makeFillerBlock(
    x,
    y,
    z,
    getPixelParity(x, z) === PixelParity.Recessive ? FillerRole.ShadeVoidRecessive : FillerRole.ShadeVoidDominant,
  );
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
  cache?: GridShapeCache,
  waterDrops?: WaterDrops,
): number {
  const belowPlatformWater = waterDrops !== undefined;
  const cacheKey = belowPlatformWater ? "below" : "default";
  const cached = cache?.stepPhaseYOffsets.get(cacheKey);
  if (cached !== undefined) return cached;
  let yOffset = 1;
  let hasDarkNonWater = false;
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) continue;
      if (isWaterColor(color)) {
        if (belowPlatformWater) continue;
        if (color.shade !== Shade.Light) yOffset = Math.max(yOffset, getWaterDepth(color.shade, x, z));
        continue;
      }
      if (color.shade === Shade.Dark) {
        if (belowPlatformWater) hasDarkNonWater = true;
        else yOffset = Math.max(yOffset, 2);
      }
    }
  }
  if (belowPlatformWater) yOffset = Math.max(yOffset, hasDarkNonWater ? 2 : 1);
  if (cache) cache.stepPhaseYOffsets.set(cacheKey, yOffset);
  return yOffset;
}

function buildStaircaseBlocks(colorGrid: ColorGrid, omitWater: boolean): ShapeBlock[] {
  const blocks: ShapeBlock[] = [];
  const baseY = 64;
  const topRowHasNorthlineFiller = (() => {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const color = colorGrid[x][0];
      if (!isTransparentColor(color) && !isWaterColor(color) && color.shade !== Shade.Light) return true;
    }
    return false;
  })();

  interface ColState {
    y: number;
    transparent: boolean;
    waterBottom?: number;
    waterDepth?: number;
  }

  const addBlock = (x: number, y: number, z: number, ref: ShapeRef) => {
    blocks.push({ x, y, z, ref });
  };
  const addVoidShadowFiller = (x: number, y: number, z: number) => addBlock(x, y, z, makeVoidAwareShadeFiller(x, y, z).ref);

  for (let x = 0; x < MAP_SIZE; ++x) {
    let north: ColState = { y: baseY, transparent: true };
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) {
        north = { y: north.y, transparent: true };
        continue;
      }

      const colorRef: ShapeRef = { kind: "color", color };
      if (isWaterColor(color)) {
        if (omitWater) {
          north = { y: north.y, transparent: true };
          continue;
        }
        const depth = getWaterDepth(color.shade, x, z);
        let bottom = north.waterBottom !== undefined ? north.waterBottom : north.y;
        const top = bottom + depth - 1;
        for (let d = 0; d < depth; ++d) addBlock(x, bottom + d, z, colorRef);
        north = { y: top, transparent: false, waterBottom: bottom, waterDepth: depth };
        continue;
      }

      if (north.transparent) {
        let colorY = north.y;
        switch (color.shade) {
          case Shade.Dark:
            addVoidShadowFiller(x, north.y + (z === 0 ? 0 : 1), z - 1);
            if (z === 0) colorY = north.y - 1;
            break;
          case Shade.Flat:
            addVoidShadowFiller(x, north.y, z - 1);
            break;
          case Shade.Light:
            if (z === 0 && topRowHasNorthlineFiller) colorY = north.y + 1;
            break;
          // case Shade.Darkest:
          //   break; // Unreachable: the darkest shade should never survive color conversion.
          default:
            throw new Error(`Unexpected staircase shade: ${color.shade}`);
        }
        addBlock(x, colorY, z, colorRef);
        north = { y: colorY, transparent: false };
        continue;
      }

      switch (color.shade) {
        case Shade.Dark:
          {
            const northIsDeepWater = north.waterBottom !== undefined && (north.waterDepth ?? 0) > 1;
            const useY = northIsDeepWater
              ? north.waterBottom!
              : (north.waterBottom !== undefined ? north.waterBottom : north.y) - 1;
            addBlock(x, useY, z, colorRef);
            north = { y: useY, transparent: false };
          }
          break;
        case Shade.Flat:
          addBlock(x, north.y, z, colorRef);
          north = { y: north.y, transparent: false };
          break;
        case Shade.Light:
          addBlock(x, north.y + 1, z, colorRef);
          north = { y: north.y + 1, transparent: false };
          break;
        // case Shade.Darkest:
        //   break; // Unreachable: the darkest shade should never survive color conversion.
        default:
          throw new Error(`Unexpected staircase shade: ${color.shade}`);
      }
    }
  }

  return blocks;
}

function addStaircaseWaterConvenienceFillers(
  blocks: ShapeBlock[],
  colorGrid: ColorGrid,
  cache: GridShapeCache,
) {
  const fillerCandidates: FillerCandidate[] = [];
  const occupied = new Set<ShapeCoordKey>();
  let overallMaxY = -Infinity;
  for (const block of blocks) occupied.add(toShapeCoordKey(block.x, block.y, block.z));
  for (const block of blocks) if (block.y > overallMaxY) overallMaxY = block.y;

  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    const { rowBlocks, rowMinY, rowMaxY, rowPresent } = buildColumnBlockRows(colBlocks);
    const pixelInfo = getCachedColumnPixelInfo(colorGrid, cache, x);
    const primaryPresent = new Array<boolean>(MAP_SIZE).fill(false);
    const waterZ = new Array<boolean>(MAP_SIZE).fill(false);
    let hasPrimary = false;
    for (let z = 0; z < MAP_SIZE; ++z) {
      const info = pixelInfo.get(z);
      if (!info) continue;
      hasPrimary = true;
      primaryPresent[z] = true;
      if (info.isWater) waterZ[z] = true;
    }
    if (!hasPrimary) continue;

    const shiftRows = (zStart: number, zEnd: number, delta: number) => {
      if (delta === 0) return;
      for (let z = zStart; z <= zEnd; ++z) {
        const row = rowBlocks[z + 1];
        if (!row) continue;
        for (const block of row) {
          occupied.delete(toShapeCoordKey(block.x, block.y, block.z));
          block.y += delta;
          occupied.add(toShapeCoordKey(block.x, block.y, block.z));
        }
        rowMinY[z + 1] += delta;
        rowMaxY[z + 1] += delta;
      }
    };

    for (let waterZPos = 0; waterZPos < MAP_SIZE; ++waterZPos) {
      if (!waterZ[waterZPos] || !rowPresent[waterZPos + 1]) continue;

      const waterInfo = pixelInfo.get(waterZPos);
      if (!waterInfo || !waterInfo.isWater || waterInfo.shade === Shade.Light) continue;

      const waterBottom = rowMinY[waterZPos + 1];
      const waterTop = rowMaxY[waterZPos + 1];
      const waterDepth = waterTop - waterBottom + 1;
      if (waterDepth <= 1 || waterBottom === 0) continue;

      let runEndZ = waterZPos;
      while (runEndZ + 1 < MAP_SIZE) {
        const nextInfo = pixelInfo.get(runEndZ + 1);
        if (!nextInfo || nextInfo.isWater) break;
        if (nextInfo.shade !== Shade.Flat && nextInfo.shade !== Shade.Light) break;
        ++runEndZ;
      }

      const runLength = runEndZ - waterZPos;
      if (runLength <= 0 || runLength >= waterDepth) continue;

      const darkZ = runEndZ + 1;
      const darkInfo = pixelInfo.get(darkZ);
      if (darkZ >= MAP_SIZE || !darkInfo || darkInfo.isWater || darkInfo.shade !== Shade.Dark || !rowPresent[darkZ + 1]) {
        // throw new Error(`Invalid staircase water convenience segment at x=${x}, z=${waterZPos}`);
        continue;
      }

      const darkY = rowMaxY[darkZ + 1];
      const westSupportY = (() => {
        if (x <= 0) return undefined;
        for (let y = waterBottom + 1; y <= overallMaxY; ++y) {
          if (occupied.has(toShapeCoordKey(x - 1, y, waterZPos))) return y;
        }
        return undefined;
      })();
      const candidates: ({
        targetWaterBottom: number;
        requiredSupportDistance: number;
        kind: "south" | "west";
      })[] = [];
      candidates.push({
        kind: "south",
        targetWaterBottom: darkY,
        requiredSupportDistance: runLength,
      });
      if (westSupportY !== undefined) {
        candidates.push({
          kind: "west",
          targetWaterBottom: westSupportY,
          requiredSupportDistance: 0,
        });
      }

      let chosen: typeof candidates[number] | undefined;
      for (const candidate of candidates) {
        if (candidate.requiredSupportDistance >= waterDepth) continue;
        const delta = candidate.targetWaterBottom - waterBottom;
        if (delta <= 0) continue;
        if (waterTop + delta > overallMaxY) continue;
        if (
          !chosen ||
          candidate.requiredSupportDistance < chosen.requiredSupportDistance ||
          (candidate.requiredSupportDistance === chosen.requiredSupportDistance && candidate.targetWaterBottom < chosen.targetWaterBottom)
        ) {
          chosen = candidate;
        }
      }
      if (!chosen) continue;

      const targetWaterBottom = chosen.targetWaterBottom;
      const delta = targetWaterBottom - waterBottom;
      // If the pillar is already anchored to a real north-row block at this bottom Y,
      // lifting it would create floating water rather than fixing a missing support path.
      const northRowAlreadyAnchorsWaterBottom =
        waterZPos > 0 &&
        rowPresent[waterZPos] &&
        rowMinY[waterZPos] <= waterBottom &&
        waterBottom <= rowMaxY[waterZPos];
      if (delta > 0 && northRowAlreadyAnchorsWaterBottom) continue;

      shiftRows(waterZPos, runEndZ, delta);

      if (chosen.kind !== "south") continue;
      const targetSupportY = targetWaterBottom;
      for (let z = waterZPos + 1; z < darkZ; ++z) {
        const coord = toShapeCoordKey(x, targetSupportY, z);
        if (occupied.has(coord)) continue;
        fillerCandidates.push({
          x,
          y: targetSupportY,
          z,
          roles: [FillerRole.SupportAll, FillerRole.StairStep, FillerRole.WaterPath],
        });
      }
    }
  }
  return fillerCandidates;
}

function buildBelowPlatformWaterBlocks(
  blocks: ShapeBlock[],
  colorGrid: ColorGrid,
  waterDrops: WaterDrops,
): { loweredWaterBlocks: ShapeBlock[]; supportFloorYs: ReadonlySet<number> } {
  let floorY = Infinity;
  for (const block of blocks) {
    if (block.ref.kind === "color" && !isWaterColor(block.ref.color) && block.y < floorY) floorY = block.y;
  }
  if (floorY === Infinity) floorY = 0;

  const byCoord = new Map<ShapeCoordKey, number>();
  for (let i = 0; i < blocks.length; ++i) {
    byCoord.set(toShapeCoordKey(blocks[i].x, blocks[i].y, blocks[i].z), i);
  }
  const removedIndexes = new Set<number>();
  const loweredWaterBlocks: ShapeBlock[] = [];

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (!isWaterColor(color)) continue;
      const waterDrop = getWaterDrop(waterDrops, color.shade);
      const waterY = floorY - waterDrop;
      const coord = toShapeCoordKey(x, waterY, z);
      const existingIndex = byCoord.get(coord);
      if (existingIndex !== undefined) {
        const existingBlock = blocks[existingIndex];
        if (existingBlock.ref.kind !== "filler") continue;
        removedIndexes.add(existingIndex);
        byCoord.delete(coord);
      }
      loweredWaterBlocks.push({ x, y: waterY, z, ref: { kind: "color", color } });
    }
  }

  if (removedIndexes.size > 0) {
    const keptBlocks = blocks.filter((_, index) => !removedIndexes.has(index));
    blocks.length = 0;
    blocks.push(...keptBlocks);
  }

  return {
    loweredWaterBlocks,
    supportFloorYs: new Set<number>([floorY - 1]),
  };
}

function applyStaircaseVariantGroupedPostProcess<T extends PositionedEntry>(
  blocks: T[],
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  excludeWater = false,
) {
  const rowKey = (x: number, z: number) => toColumnCoordKey(x, z);
  type PixelInfo = { shade: Shade; isWater: boolean };
  interface RowRecord {
    x: number;
    z: number;
    blocks: T[];
    yValues: number[];
    minY: number;
    maxY: number;
    segmentId?: number;
    neighbors: RowRecord[];
  }
  interface GroupedSegment {
    id: number;
    x: number;
    primaryZ: number[];
    rows: RowRecord[];
    liftRows: RowRecord[];
    minY: number;
    maxY: number;
  }

  const pixelByColumn = new Map<number, Map<number, PixelInfo>>();
  for (let x = 0; x < MAP_SIZE; ++x) {
    const zInfo = getCachedColumnPixelInfo(colorGrid, cache, x, excludeWater);
    if (zInfo.size > 0) pixelByColumn.set(x, zInfo);
  }

  const columnRows = new Map<number, Map<number, RowRecord>>();
  for (const block of blocks) {
    if (!columnRows.has(block.x)) columnRows.set(block.x, new Map());
    const zMap = columnRows.get(block.x)!;
    let row = zMap.get(block.z);
    if (!row) {
      row = { x: block.x, z: block.z, blocks: [], yValues: [], minY: Infinity, maxY: -Infinity, neighbors: [] };
      zMap.set(block.z, row);
    }
    row.blocks.push(block);
    row.yValues.push(block.y);
    if (block.y < row.minY) row.minY = block.y;
    if (block.y > row.maxY) row.maxY = block.y;
  }
  for (const zMap of columnRows.values()) {
    for (const row of zMap.values()) row.yValues.sort((a, b) => a - b);
  }

  let valleyMaxY = -Infinity;
  for (const block of blocks) valleyMaxY = Math.max(valleyMaxY, block.y);
  if (!Number.isFinite(valleyMaxY)) return;

  const primaryTopY = new Map<ColumnCoordKey, number>();
  const primaryMinY = new Map<ColumnCoordKey, number>();
  const primaryZByColumn = new Map<number, number[]>();
  const segments: GroupedSegment[] = [];

  for (let x = 0; x < MAP_SIZE; ++x) {
    const primaryInfo = pixelByColumn.get(x);
    const zRows = columnRows.get(x);
    if (!primaryInfo || !zRows) continue;

    const allPrimaryZ = [...primaryInfo.keys()].sort((a, b) => a - b);
    const topY = new Map<number, number>();
    const minY = new Map<number, number>();
    for (const z of allPrimaryZ) {
      const row = zRows.get(z);
      if (!row) continue;
      minY.set(z, row.minY);
      topY.set(z, row.maxY);
    }

    const primaryZ = allPrimaryZ.filter(z => topY.has(z) && minY.has(z));
    if (primaryZ.length > 0) primaryZByColumn.set(x, primaryZ);
    for (const z of primaryZ) {
      primaryTopY.set(rowKey(x, z), topY.get(z)!);
      primaryMinY.set(rowKey(x, z), minY.get(z)!);
    }
    if (primaryZ.length === 0) continue;

    const waterZ = new Set<number>();
    for (const z of primaryZ) if (primaryInfo.get(z)?.isWater) waterZ.add(z);
    const nonWaterPrimary = primaryZ.filter(z => !waterZ.has(z));

    let i = 0;
    while (i < nonWaterPrimary.length) {
      const startZ = nonWaterPrimary[i];
      const runTop = topY.get(startZ)!;
      let j = i + 1;
      while (
        j < nonWaterPrimary.length &&
        nonWaterPrimary[j] === nonWaterPrimary[j - 1] + 1 &&
        topY.get(nonWaterPrimary[j]) === runTop
      ) {
        ++j;
      }
      const primaryZList = nonWaterPrimary.slice(i, j);
      const moveRows = new Set<number>(primaryZList);
      for (const z of primaryZList) {
        const fillerZ = z - 1;
        if (!primaryInfo.has(fillerZ) && zRows.has(fillerZ)) moveRows.add(fillerZ);
      }

      const segmentRows: RowRecord[] = [];
      for (const z of moveRows) {
        const row = zRows.get(z);
        if (!row) continue;
        segmentRows.push(row);
      }

      const liftRows = [...segmentRows];
      const movedRowCoords = new Set(liftRows.map(row => rowKey(row.x, row.z)));
      for (const z of primaryZList) {
        const northZ = z - 1;
        const northInfo = primaryInfo.get(northZ);
        const southRow = zRows.get(z);
        const northRow = zRows.get(northZ);
        if (!northInfo?.isWater || !southRow || !northRow || northRow.minY === 0) continue;
        const bottomDelta = northRow.minY - southRow.maxY;
        if (bottomDelta !== 0 && bottomDelta !== 1) continue;
        const northCoord = rowKey(northRow.x, northRow.z);
        if (movedRowCoords.has(northCoord)) continue;
        liftRows.push(northRow);
        movedRowCoords.add(northCoord);
      }

      let segMin = Infinity;
      let segMaxY = -Infinity;
      for (const row of liftRows) {
        if (row.minY < segMin) segMin = row.minY;
        if (row.maxY > segMaxY) segMaxY = row.maxY;
      }
      const segment: GroupedSegment = {
        id: segments.length,
        x,
        primaryZ: primaryZList,
        rows: segmentRows,
        liftRows,
        minY: segMin,
        maxY: segMaxY,
      };
      segments.push(segment);
      for (const row of segmentRows) row.segmentId = segment.id;
      i = j;
    }
  }

  if (segments.length === 0) return;

  for (const zMap of columnRows.values()) {
    for (const row of zMap.values()) {
      if (row.x > 0) {
        const left = columnRows.get(row.x - 1)?.get(row.z);
        if (left) row.neighbors.push(left);
      }
      if (row.x < MAP_SIZE - 1) {
        const right = columnRows.get(row.x + 1)?.get(row.z);
        if (right) row.neighbors.push(right);
      }
    }
  }

  const rowsShareY = (a: RowRecord, b: RowRecord) => {
    if (a.maxY < b.minY || b.maxY < a.minY) return false;
    let i = 0;
    let j = 0;
    while (i < a.yValues.length && j < b.yValues.length) {
      const ay = a.yValues[i];
      const by = b.yValues[j];
      if (ay === by) return true;
      if (ay < by) ++i;
      else ++j;
    }
    return false;
  };

  const unfinished = new Set<number>(segments.map(segment => segment.id));
  const segmentVisitOrder = [...segments].sort((a, b) => b.minY - a.minY).map(segment => segment.id);

  const expandGroup = (seedGroup: Set<number>) => {
    const groupIds = new Set<number>(seedGroup);
    const queue = [...groupIds];
    let touchesFrozen = false;

    while (queue.length > 0) {
      const segment = segments[queue.pop()!];
      for (const row of segment.rows) {
        for (const neighborRow of row.neighbors) {
          if (!rowsShareY(row, neighborRow)) continue;
          const otherSegmentId = neighborRow.segmentId;
          if (otherSegmentId === undefined) {
            touchesFrozen = true;
            continue;
          }
          if (groupIds.has(otherSegmentId)) continue;
          if (unfinished.has(otherSegmentId)) {
            groupIds.add(otherSegmentId);
            queue.push(otherSegmentId);
          } else {
            touchesFrozen = true;
          }
        }
      }
    }

    return { groupIds, touchesFrozen };
  };

  const collectCandidateDeltas = (groupIds: Set<number>, maxLift: number): number[] => {
    let groupMinY = Infinity;
    for (const segmentId of groupIds) groupMinY = Math.min(groupMinY, segments[segmentId].minY);
    const deltas = new Set<number>();

    for (const segmentId of groupIds) {
      const segment = segments[segmentId];
      for (const row of segment.rows) {
        for (const neighborRow of row.neighbors) {
          const otherSegmentId = neighborRow.segmentId;
          if (otherSegmentId !== undefined && groupIds.has(otherSegmentId)) continue;
          const targetMinY = otherSegmentId !== undefined ? segments[otherSegmentId].minY : neighborRow.minY;
          const delta = targetMinY - groupMinY;
          if (delta > 0 && delta <= maxLift) deltas.add(delta);
        }
      }
    }

    return [...deltas].sort((a, b) => a - b);
  };

  const isGroupShadeSafe = (groupIds: Set<number>, delta: number): boolean => {
    const movingPrimaryRows = new Set<ColumnCoordKey>();
    const affectedColumns = new Set<number>();

    for (const segmentId of groupIds) {
      const segment = segments[segmentId];
      affectedColumns.add(segment.x);
      for (const z of segment.primaryZ) movingPrimaryRows.add(rowKey(segment.x, z));
    }

    for (const x of affectedColumns) {
      const primaryInfo = pixelByColumn.get(x);
      const primaryZ = primaryZByColumn.get(x);
      if (!primaryInfo || !primaryZ) continue;

      for (const z of primaryZ) {
        const info = primaryInfo.get(z);
        if (!info || info.isWater) continue;
        const northZ = z - 1;
        if (!primaryInfo.has(northZ)) continue;

        const yKey = rowKey(x, z);
        const northKey = rowKey(x, northZ);
        const y = primaryTopY.get(yKey)! + (movingPrimaryRows.has(yKey) ? delta : 0);
        const northY = primaryTopY.get(northKey)! + (movingPrimaryRows.has(northKey) ? delta : 0);

        if (info.shade === Shade.Light && !(y > northY)) return false;
        if (info.shade === Shade.Flat && y !== northY) return false;
        if (info.shade === Shade.Dark && !(y < northY)) return false;
      }
    }

    return true;
  };

  const moveGroup = (groupIds: Set<number>, delta: number) => {
    for (const segmentId of groupIds) {
      const segment = segments[segmentId];
      for (const row of segment.liftRows) {
        row.minY += delta;
        row.maxY += delta;
        for (let i = 0; i < row.yValues.length; ++i) row.yValues[i] += delta;
        for (const block of row.blocks) block.y += delta;
        const coord = rowKey(row.x, row.z);
        if (primaryTopY.has(coord)) primaryTopY.set(coord, primaryTopY.get(coord)! + delta);
        if (primaryMinY.has(coord)) primaryMinY.set(coord, primaryMinY.get(coord)! + delta);
      }
      segment.minY += delta;
      segment.maxY += delta;
    }
  };

  for (const seedId of segmentVisitOrder) {
    if (!unfinished.has(seedId)) continue;
    let { groupIds, touchesFrozen } = expandGroup(new Set([seedId]));
    while (!touchesFrozen) {
      let groupMaxY = -Infinity;
      for (const segmentId of groupIds) groupMaxY = Math.max(groupMaxY, segments[segmentId].maxY);
      const maxLift = valleyMaxY - groupMaxY;
      if (maxLift <= 0) break;

      let chosenDelta = 0;
      for (const delta of collectCandidateDeltas(groupIds, maxLift)) {
        if (!isGroupShadeSafe(groupIds, delta)) continue;
        moveGroup(groupIds, delta);
        const expanded = expandGroup(groupIds);
        if (expanded.groupIds.size > groupIds.size || expanded.touchesFrozen) {
          chosenDelta = delta;
          groupIds = expanded.groupIds;
          touchesFrozen = expanded.touchesFrozen;
          break;
        }
        moveGroup(groupIds, -delta);
      }
      if (chosenDelta <= 0) break;
    }

    for (const segmentId of groupIds) unfinished.delete(segmentId);
  }
}

function applyStaircaseVariantClassic<T extends PositionedEntry>(blocks: T[]) {
  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    let minY = Infinity;
    for (const block of colBlocks) if (block.y < minY) minY = block.y;
    for (const block of colBlocks) block.y -= minY;
  }
}

function applyStaircaseVariantSouthline<T extends PositionedEntry>(blocks: T[]) {
  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    let maxZ = -Infinity;
    let southY = 0;
    for (const block of colBlocks) {
      if (block.z > maxZ) {
        maxZ = block.z;
        southY = block.y;
      }
    }
    for (const block of colBlocks) block.y -= southY;
  }
}

function applyStaircaseVariantValley<T extends PositionedEntry>(
  blocks: T[],
  colorGrid: ColorGrid,
  cache?: GridShapeCache,
  excludeWater = false,
) {
  const minimumWaterBottom = 0;
  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    const pixelShade = cache
      ? getCachedColumnPixelInfo(colorGrid, cache, x, excludeWater)
      : getCachedColumnPixelInfo(colorGrid, getGridShapeCache(colorGrid), x, excludeWater);
    const { rowBlocks, rowMinY, rowMaxY, zValues } = buildColumnBlockRows(colBlocks);
    const waterZ = new Array<boolean>(MAP_SIZE).fill(false);
    const primaryPresent = new Array<boolean>(MAP_SIZE).fill(false);
    const currentMaxY = new Array<number>(MAP_SIZE).fill(0);
    const deltaApplied = new Array<number>(MAP_SIZE).fill(0);

    interface ValleySegment {
      zStart: number;
      zEnd: number;
      topY: number;
      firstNonWaterZ: number;
      waterZPos?: number;
      waterDepth?: number;
    }

    for (let z = 0; z < MAP_SIZE; ++z) {
      const info = pixelShade.get(z);
      if (!info) continue;
      primaryPresent[z] = true;
      if (info.isWater) waterZ[z] = true;
      currentMaxY[z] = rowMaxY[z + 1];
    }

    const processed = new Array<boolean>(MAP_SIZE).fill(false);
    const segments: ValleySegment[] = [];
    for (let startZ = 0; startZ < MAP_SIZE; ++startZ) {
      if (!primaryPresent[startZ] || waterZ[startZ] || processed[startZ]) continue;
      const topY = rowMaxY[startZ + 1];
      let endZ = startZ;
      while (endZ + 1 < MAP_SIZE && primaryPresent[endZ + 1] && !waterZ[endZ + 1] && !processed[endZ + 1] && rowMaxY[endZ + 2] === topY) ++endZ;

      let zStart = startZ;
      let waterZPos: number | undefined;
      let waterDepth: number | undefined;
      const northZ = startZ - 1;
      if (northZ >= 0 && waterZ[northZ] && rowMaxY[northZ + 1] === topY) {
        zStart = northZ;
        waterZPos = northZ;
        waterDepth = rowMaxY[northZ + 1] - rowMinY[northZ + 1] + 1;
        processed[northZ] = true;
      }
      for (let z = startZ; z <= endZ; ++z) processed[z] = true;
      segments.push({ zStart, zEnd: endZ, topY, firstNonWaterZ: startZ, waterZPos, waterDepth });
    }

    for (let z = 0; z < MAP_SIZE; ++z) {
      if (!waterZ[z] || processed[z]) continue;
      processed[z] = true;
      segments.push({
        zStart: z,
        zEnd: z,
        topY: rowMaxY[z + 1],
        firstNonWaterZ: -1,
        waterZPos: z,
        waterDepth: rowMaxY[z + 1] - rowMinY[z + 1] + 1,
      });
    }

    segments.sort((a, b) => a.topY - b.topY);

    for (const segment of segments) {
      const southZ = segment.zEnd + 1;
      const southInfo = pixelShade.get(southZ);
      let targetTopY: number;
      if (!southInfo || southInfo.isWater || southInfo.shade === Shade.Light) {
        targetTopY = 0;
      } else {
        const southY = southZ < MAP_SIZE && primaryPresent[southZ] ? currentMaxY[southZ] : undefined;
        targetTopY = southY !== undefined ? southY + 1 : 0;
      }

      if (segment.firstNonWaterZ >= 0) {
        const northOfSegment = segment.firstNonWaterZ - 1;
        const segmentInfo = pixelShade.get(segment.firstNonWaterZ);
        if (segmentInfo && northOfSegment >= 0 && northOfSegment < segment.zStart && primaryPresent[northOfSegment]) {
          const northY = currentMaxY[northOfSegment];
          if (segmentInfo.shade === Shade.Light) targetTopY = Math.max(targetTopY, northY + 1);
          else if (segmentInfo.shade === Shade.Flat) targetTopY = Math.max(targetTopY, northY);
        }
      }

      if (segment.waterDepth !== undefined && segment.waterDepth > 1) {
        const waterBottom = targetTopY - (segment.waterDepth - 1);
        if (waterBottom < minimumWaterBottom) targetTopY += minimumWaterBottom - waterBottom;
      }

      const waterZPos = segment.waterZPos;
      const waterInfo = waterZPos !== undefined ? pixelShade.get(waterZPos) : undefined;
      const isDarkMediumWater = !!waterInfo && (waterInfo.shade === Shade.Dark || waterInfo.shade === Shade.Flat);
      if (isDarkMediumWater && segment.waterDepth !== undefined && segment.waterDepth > 1) {
        const waterBottomAfter = targetTopY - (segment.waterDepth - 1);
        if (segment.zStart === segment.zEnd) {
          const southShade = pixelShade.get(southZ);
          if (southShade && southShade.shade === Shade.Dark && waterBottomAfter !== minimumWaterBottom) {
            const southY = southZ < MAP_SIZE && primaryPresent[southZ] ? currentMaxY[southZ] : undefined;
            if (southY !== undefined) targetTopY = southY + (segment.waterDepth - 1);
          }
        } else if (waterBottomAfter !== minimumWaterBottom) {
          const southY = southZ < MAP_SIZE && primaryPresent[southZ] ? currentMaxY[southZ] : undefined;
          if (southY !== undefined) {
            const delta = southY + (segment.waterDepth - 1) - segment.topY;
            for (let z = segment.zStart; z <= segment.zEnd; ++z) {
              const segmentRowBlocks = rowBlocks[z + 1];
              if (segmentRowBlocks) for (const block of segmentRowBlocks) block.y += delta;
              if (primaryPresent[z]) {
                currentMaxY[z] += delta;
                deltaApplied[z] += delta;
              }
            }
            continue;
          }
        }
      }

      const delta = targetTopY - segment.topY;
      if (delta !== 0) {
        for (let z = segment.zStart; z <= segment.zEnd; ++z) {
          const segmentRowBlocks = rowBlocks[z + 1];
          if (segmentRowBlocks) for (const block of segmentRowBlocks) block.y += delta;
          if (primaryPresent[z]) {
            currentMaxY[z] += delta;
            deltaApplied[z] += delta;
          }
        }
      }
    }

    for (const z of zValues) {
      if (z >= 0 && z < MAP_SIZE && primaryPresent[z]) continue;
      const supportedZ = z + 1;
      const fillerRowBlocks = rowBlocks[z + 1]!;
      if (supportedZ >= 0 && supportedZ < MAP_SIZE && primaryPresent[supportedZ]) {
        const delta = deltaApplied[supportedZ];
        if (delta !== 0) for (const block of fillerRowBlocks) block.y += delta;
      } else {
        const minY = rowMinY[z + 1];
        for (const block of fillerRowBlocks) block.y -= minY;
      }
    }
  }
}

function applyStaircaseVariantParty<T extends PositionedEntry>(
  blocks: T[],
  colorGrid: ColorGrid,
  paletteSeed = 0,
  cache?: GridShapeCache,
  excludeWater = false,
) {
  const seedBase = (42 ^ paletteSeed) >>> 0;
  const mulberry32 = (seed: number) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    const rand = mulberry32((x * 7919 + seedBase) >>> 0);
    const randomInt = (lo: number, hi: number) => (hi <= lo ? lo : lo + Math.floor(rand() * (hi - lo + 1)));
    const sampleUniqueSorted = (lo: number, hi: number, count: number): number[] => {
      if (count <= 0 || hi < lo) return [];
      const span = hi - lo + 1;
      if (count >= span) return Array.from({ length: span }, (_, i) => lo + i);
      const pool = Array.from({ length: span }, (_, i) => lo + i);
      for (let i = pool.length - 1; i > 0; --i) {
        const j = Math.floor(rand() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, count).sort((a, b) => a - b);
    };

    const pixelInfo = cache
      ? getCachedColumnPixelInfo(colorGrid, cache, x, excludeWater)
      : getCachedColumnPixelInfo(colorGrid, getGridShapeCache(colorGrid), x, excludeWater);

    const zToBlocks = new Map<number, T[]>();
    for (const block of colBlocks) {
      if (!zToBlocks.has(block.z)) zToBlocks.set(block.z, []);
      zToBlocks.get(block.z)!.push(block);
    }

    const primaryZs = [...pixelInfo.keys()].sort((a, b) => a - b);
    if (primaryZs.length === 0) continue;

    const origMaxY = new Map<number, number>();
    const origMinY = new Map<number, number>();
    const depthByZ = new Map<number, number>();
    for (const z of primaryZs) {
      const rowBlocks = zToBlocks.get(z);
      if (!rowBlocks) continue;
      const maxY = Math.max(...rowBlocks.map(block => block.y));
      const minY = Math.min(...rowBlocks.map(block => block.y));
      origMaxY.set(z, maxY);
      origMinY.set(z, minY);
      depthByZ.set(z, maxY - minY + 1);
    }

    const lowerBound = (z: number) => (pixelInfo.get(z)?.isWater ? (depthByZ.get(z) ?? 1) - 1 : 0);
    const upperBound = (_z: number) => MAP_SIZE - 1;
    const hasPrimary = (z: number) => pixelInfo.has(z);
    const edgeRel = (northZ: number): -1 | 0 | 1 | null => {
      const southZ = northZ + 1;
      const north = pixelInfo.get(northZ);
      const south = pixelInfo.get(southZ);
      if (!north || !south || south.isWater) return null;
      if (south.shade === Shade.Light) return 1;
      if (south.shade === Shade.Flat) return 0;
      return -1;
    };
    const isColumnValid = (topY: Map<number, number>): boolean => {
      for (const z of primaryZs) {
        const y = topY.get(z);
        if (y === undefined || y < lowerBound(z) || y > upperBound(z)) return false;
      }
      for (let northZ = 0; northZ < MAP_SIZE - 1; ++northZ) {
        const rel = edgeRel(northZ);
        if (rel === null) continue;
        const southZ = northZ + 1;
        const yN = topY.get(northZ);
        const yS = topY.get(southZ);
        if (yN === undefined || yS === undefined) continue;
        if (rel === 0 && yS !== yN) return false;
        if (rel === 1 && !(yS > yN)) return false;
        if (rel === -1 && !(yS < yN)) return false;
      }
      return true;
    };

    interface Segment { start: number; end: number; dir: -1 | 1 }
    const segments: Segment[] = [];
    const endpointHints: { zList: number[]; type: "lower" | "upper" }[] = [];
    const prefTopY = new Map<number, number>();

    let segStart: number | null = null;
    let segDir: -1 | 1 | null = null;
    let prevZ: number | null = null;
    const flush = (endZ: number | null) => {
      if (segStart !== null && segDir !== null && endZ !== null && endZ > segStart) {
        segments.push({ start: segStart, end: endZ, dir: segDir });
      }
      segStart = null;
      segDir = null;
    };

    for (let z = 0; z < MAP_SIZE; ++z) {
      if (!hasPrimary(z)) {
        flush(prevZ);
        prevZ = null;
        continue;
      }
      if (prevZ === null) {
        prevZ = z;
        continue;
      }
      if (z !== prevZ + 1) {
        flush(prevZ);
        prevZ = z;
        continue;
      }
      const rel = edgeRel(prevZ);
      if (rel === null) {
        flush(prevZ);
        prevZ = z;
        continue;
      }
      if (rel === 0) {
        if (segStart === null) segStart = prevZ;
        prevZ = z;
        continue;
      }
      if (segStart === null) {
        segStart = prevZ;
        segDir = rel;
      } else if (segDir === null) {
        segDir = rel;
      } else if (rel !== segDir) {
        if (prevZ > segStart) segments.push({ start: segStart, end: prevZ, dir: segDir });
        segStart = prevZ;
        segDir = rel;
      }
      prevZ = z;
    }
    flush(prevZ);

    const applySegmentPreference = (segment: Segment) => {
      const path: number[] = [];
      if (segment.dir === 1) for (let z = segment.start; z <= segment.end; ++z) path.push(z);
      else for (let z = segment.end; z >= segment.start; --z) path.push(z);
      if (path.length < 2) return;

      const groups: number[][] = [[path[0]]];
      for (let i = 1; i < path.length; ++i) {
        const a = path[i - 1];
        const b = path[i];
        const rel = a < b ? edgeRel(a) : edgeRel(b);
        if (rel === 0) groups[groups.length - 1].push(b);
        else groups.push([b]);
      }
      if (groups.length < 2) return;

      const lowGroup = groups[0];
      const highGroup = groups[groups.length - 1];
      let lowY = Math.max(...lowGroup.map(z => lowerBound(z)));
      const highY = Math.min(...highGroup.map(z => upperBound(z)));
      const minGap = groups.length - 1;
      if (highY - lowY < minGap) lowY = Math.max(lowY, highY - minGap);

      const strictSteps = groups.length - 1;
      const interior = sampleUniqueSorted(lowY + 1, highY - 1, Math.max(0, strictSteps - 1));
      const values = interior.length === Math.max(0, strictSteps - 1)
        ? [lowY, ...interior, highY]
        : Array.from({ length: groups.length }, (_, i) => Math.min(highY, lowY + i));

      for (let i = 0; i < groups.length; ++i) {
        for (const z of groups[i]) prefTopY.set(z, values[i]);
      }
      endpointHints.push({ zList: [...lowGroup], type: "lower" });
      endpointHints.push({ zList: [...highGroup], type: "upper" });
    };

    for (const segment of segments) applySegmentPreference(segment);
    for (const z of primaryZs) if (!prefTopY.has(z)) prefTopY.set(z, randomInt(lowerBound(z), upperBound(z)));

    const minFeas = new Map<number, number>();
    const maxFeas = new Map<number, number>();
    for (const z of primaryZs) {
      minFeas.set(z, lowerBound(z));
      maxFeas.set(z, upperBound(z));
    }

    for (let northZ = MAP_SIZE - 2; northZ >= 0; --northZ) {
      if (!hasPrimary(northZ)) continue;
      let lo = minFeas.get(northZ) ?? lowerBound(northZ);
      let hi = maxFeas.get(northZ) ?? upperBound(northZ);
      const southZ = northZ + 1;
      const rel = edgeRel(northZ);
      if (rel !== null && hasPrimary(southZ)) {
        const sLo = minFeas.get(southZ) ?? lowerBound(southZ);
        const sHi = maxFeas.get(southZ) ?? upperBound(southZ);
        if (rel === 0) {
          lo = Math.max(lo, sLo);
          hi = Math.min(hi, sHi);
        } else if (rel === 1) {
          hi = Math.min(hi, sHi - 1);
        } else {
          lo = Math.max(lo, sLo + 1);
        }
      }
      if (lo > hi) {
        const p = prefTopY.get(northZ) ?? lowerBound(northZ);
        const clamped = Math.min(Math.max(p, lowerBound(northZ)), upperBound(northZ));
        lo = clamped;
        hi = clamped;
      }
      minFeas.set(northZ, lo);
      maxFeas.set(northZ, hi);
    }

    const assignedTopY = new Map<number, number>();
    for (let z = 0; z < MAP_SIZE; ++z) {
      if (!hasPrimary(z)) continue;
      let lo = minFeas.get(z) ?? lowerBound(z);
      let hi = maxFeas.get(z) ?? upperBound(z);
      const northZ = z - 1;
      if (northZ >= 0 && hasPrimary(northZ) && assignedTopY.has(northZ)) {
        const rel = edgeRel(northZ);
        if (rel !== null) {
          const northY = assignedTopY.get(northZ)!;
          if (rel === 0) {
            lo = Math.max(lo, northY);
            hi = Math.min(hi, northY);
          } else if (rel === 1) {
            lo = Math.max(lo, northY + 1);
          } else {
            hi = Math.min(hi, northY - 1);
          }
        }
      }
      let y: number;
      if (lo > hi) {
        y = Math.min(Math.max(prefTopY.get(z) ?? lo, lowerBound(z)), upperBound(z));
      } else {
        const pref = prefTopY.get(z) ?? randomInt(lo, hi);
        y = pref < lo || pref > hi ? Math.min(Math.max(pref, lo), hi) : pref;
      }
      assignedTopY.set(z, y);
    }

    const uniqueEndpoints = new Map<string, { zList: number[]; type: "lower" | "upper" }>();
    for (const endpoint of endpointHints) {
      const key = `${endpoint.type}:${[...endpoint.zList].sort((a, b) => a - b).join(",")}`;
      uniqueEndpoints.set(key, endpoint);
    }

    for (const endpoint of uniqueEndpoints.values()) {
      const zList = endpoint.zList.filter(z => assignedTopY.has(z));
      if (zList.length === 0) continue;
      const snapshot = new Map<number, number>();
      for (const z of zList) snapshot.set(z, assignedTopY.get(z)!);
      const minY = Math.max(...zList.map(z => lowerBound(z)));
      const maxY = Math.min(...zList.map(z => upperBound(z)));

      if (endpoint.type === "upper") {
        let maxDown = 0;
        const currTop = Math.min(...zList.map(z => snapshot.get(z)!));
        for (let d = 1; currTop - d >= minY; ++d) {
          for (const z of zList) assignedTopY.set(z, snapshot.get(z)! - d);
          if (isColumnValid(assignedTopY)) maxDown = d;
          else break;
        }
        const chosen = randomInt(0, maxDown);
        for (const z of zList) assignedTopY.set(z, snapshot.get(z)! - chosen);
      } else {
        let maxUp = 0;
        const currBottom = Math.max(...zList.map(z => snapshot.get(z)!));
        for (let d = 1; currBottom + d <= maxY; ++d) {
          for (const z of zList) assignedTopY.set(z, snapshot.get(z)! + d);
          if (isColumnValid(assignedTopY)) maxUp = d;
          else break;
        }
        const chosen = randomInt(0, maxUp);
        for (const z of zList) assignedTopY.set(z, snapshot.get(z)! + chosen);
      }
    }

    if (!isColumnValid(assignedTopY)) {
      assignedTopY.clear();
      for (let z = 0; z < MAP_SIZE; ++z) {
        if (!hasPrimary(z)) continue;
        let lo = minFeas.get(z) ?? lowerBound(z);
        let hi = maxFeas.get(z) ?? upperBound(z);
        const northZ = z - 1;
        if (northZ >= 0 && hasPrimary(northZ) && assignedTopY.has(northZ)) {
          const rel = edgeRel(northZ);
          if (rel !== null) {
            const northY = assignedTopY.get(northZ)!;
            if (rel === 0) lo = hi = northY;
            else if (rel === 1) lo = Math.max(lo, northY + 1);
            else hi = Math.min(hi, northY - 1);
          }
        }
        if (lo > hi) assignedTopY.set(z, Math.min(Math.max(prefTopY.get(z) ?? lo, lowerBound(z)), upperBound(z)));
        else assignedTopY.set(z, randomInt(lo, hi));
      }
    }

    if (!isColumnValid(assignedTopY)) {
      assignedTopY.clear();
      for (const z of primaryZs) {
        const y = origMaxY.get(z);
        if (y !== undefined) assignedTopY.set(z, y);
      }
    }

    const deltaApplied = new Map<number, number>();
    for (const z of primaryZs) {
      const origTop = origMaxY.get(z);
      const newTop = assignedTopY.get(z);
      if (origTop === undefined || newTop === undefined) continue;
      const delta = newTop - origTop;
      deltaApplied.set(z, delta);
      const rowBlocks = zToBlocks.get(z);
      if (rowBlocks) for (const block of rowBlocks) block.y += delta;
    }

    for (const z of [...zToBlocks.keys()].sort((a, b) => a - b)) {
      if (pixelInfo.has(z)) continue;
      const supportedZ = z + 1;
      const delta = deltaApplied.get(supportedZ);
      if (delta !== undefined && delta !== 0) {
        for (const block of zToBlocks.get(z)!) block.y += delta;
      }
    }
  }
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
  buildMode: TwoLayerSuppressBuildMode,
  waterDrops?: WaterDrops,
): { blocks: ShapeBlock[]; loweredWaterBlocks: ShapeBlock[]; supportFloorYs: ReadonlySet<number> } {
  const belowPlatformWater = waterDrops !== undefined;
  const topYGrid: (number | undefined)[][] = Array.from({ length: MAP_SIZE }, () => new Array<number | undefined>(MAP_SIZE).fill(undefined));
  const blocks: ShapeBlock[] = [];
  const loweredWaterBlocks: ShapeBlock[] = [];
  const occupied = new Set<ShapeCoordKey>();
  const lowerY = 0;
  const upperY = Math.max(1, layerGap ?? 5);
  const lateY = upperY + 2;
  const recessiveOverrides = new Map<ColumnCoordKey, RecessivePlacementOverride>();
  const lateDominant = new Set<ColumnCoordKey>();
  const cellKey = (x: number, z: number) => toColumnCoordKey(x, z);
  const isRecessive = (x: number, z: number) => getPixelParity(x, z) === PixelParity.Recessive;
  const isDominant = (x: number, z: number) => getPixelParity(x, z) === PixelParity.Dominant;
  const shadeDeltaFromSouth = (shade: Shade) => (shade === Shade.Light ? 1 : shade === Shade.Flat ? 0 : -1);
  const isLatePairDominantColor = (x: number, z: number, color: ShadedColorRef) =>
    buildMode === BuildMode.Suppress2LayerLatePairs &&
    isDominant(x, z) &&
    color.shade === Shade.Flat &&
    z > 0 &&
    isTransparentColor(colorGrid[x][z - 1]);
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
          topY = southTopY + shadeDeltaFromSouth(color.shade);
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
      const lateSuppressDominantVoid = isDominant(x, z) && fillZ >= 0 && isTransparentColor(colorGrid[x][fillZ]);
      if (lateSuppressDominantVoid) {
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

  for (const [coord, ref] of fillerPlacements.entries()) {
    if (occupied.has(coord)) continue;
    const [x, y, z] = parseShapeCoordKey(coord);
    blocks.push({ x, y, z, ref });
    occupied.add(coord);
  }

  const supportFloorYs = new Set<number>();
  for (const block of blocks) {
    if (isWaterBlock(block)) continue;
    if (block.y !== lowerY && block.y !== upperY && block.y !== lateY) continue;
    supportFloorYs.add(block.y - 1);
  }

  return { blocks, loweredWaterBlocks, supportFloorYs };
}

function getOrderedStepLines(
  direction: SuppressStepDirection,
): { axis: "x" | "z"; lines: number[] } {
  const axis = (
    direction === SuppressStepDirection.NorthToSouth ||
    direction === SuppressStepDirection.SouthToNorth
  ) ? "z" : "x";
  const ascending = (
    direction === SuppressStepDirection.WestToEast ||
    direction === SuppressStepDirection.NorthToSouth
  );
  const lines = Array.from({ length: MAP_SIZE }, (_, index) => ascending ? index : MAP_SIZE - 1 - index);
  return { axis, lines };
}

function makeStepPhaseSpec(
  axis: "x" | "z",
  lines: readonly number[],
  includeAt: (x: number, z: number) => boolean,
): StepPhaseSpec {
  return { axis, lines, includeAt };
}

function buildStepPhaseSpecsForDirection(
  buildMode: StepwiseBuildMode,
  direction: SuppressStepDirection,
): StepPhaseSpec[] {
  const specs: StepPhaseSpec[] = [];
  const { axis, lines } = getOrderedStepLines(direction);
  const getLine = (x: number, z: number) => axis === "x" ? x : z;
  const makeSingleLineParitySpec = (line: number, parity: PixelParity) =>
    makeStepPhaseSpec(axis, [line], (x, z) => getLine(x, z) === line && getPixelParity(x, z) === parity);
  const makeDualParitySpec = (
    dominantLines: readonly number[],
    recessiveLines: readonly number[],
  ) => {
    const dominantSet = new Set(dominantLines);
    const recessiveSet = new Set(recessiveLines);
    return makeStepPhaseSpec(axis, [...dominantLines, ...recessiveLines], (x, z) => {
      const line = getLine(x, z);
      const parity = getPixelParity(x, z);
      return (
        (dominantSet.has(line) && parity === PixelParity.Dominant) ||
        (recessiveSet.has(line) && parity === PixelParity.Recessive)
      );
    });
  };

  if (buildMode === BuildMode.SuppressStepPairs) {
    specs.push(makeSingleLineParitySpec(lines[0], PixelParity.Recessive));
    for (let i = 1; i < lines.length; ++i) {
      specs.push(makeDualParitySpec([lines[i - 1]], [lines[i]]));
    }
    specs.push(makeSingleLineParitySpec(lines[lines.length - 1], PixelParity.Dominant));
    return specs;
  }

  const linePairs: number[][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const first = lines[i];
    const second = lines[i + 1];
    if (second === undefined) break;
    linePairs.push([first, second]);
  }
  specs.push(makeStepPhaseSpec(axis, linePairs[0] ?? [], (x, z) => {
    const line = getLine(x, z);
    return (linePairs[0]?.includes(line) ?? false) && getPixelParity(x, z) === PixelParity.Recessive;
  }));
  for (let i = 1; i < linePairs.length; ++i) {
    specs.push(makeDualParitySpec(linePairs[i - 1], linePairs[i]));
  }
  const lastPair = linePairs[linePairs.length - 1] ?? [];
  specs.push(makeStepPhaseSpec(axis, lastPair, (x, z) => {
    const line = getLine(x, z);
    return lastPair.includes(line) && getPixelParity(x, z) === PixelParity.Dominant;
  }));
  return specs;
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

function buildStepPhaseBlocks(
  colorGrid: ColorGrid,
  currentSpec: StepPhaseSpec,
  currentBaseY: number,
  previousSpec?: StepPhaseSpec,
  nextSpec?: StepPhaseSpec,
  allowMixStepReuse = false,
  waterDrops?: WaterDrops,
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
  const canReuseCurrentPhaseNorthColumnAsShader = (shadedColor: ShadedColorRef, northColor: ShadedColorRef): boolean => {
    if (canReuseNorthColumnAsShader(shadedColor, northColor)) return true;
    return currentSpec.axis === "z" && !isWaterColor(northColor) && shadedColor.shade === Shade.Dark;
  };

  const collectRepeatedNorthBlocks = (
    shadedParity: PixelParity,
    northParity: PixelParity,
    adjacentSpec: StepPhaseSpec | undefined,
  ) => {
    if (!adjacentSpec) return;
    const scanX = currentSpec.axis === "x" ? currentSpec.lines : Array.from({ length: MAP_SIZE }, (_, index) => index);
    for (const x of scanX) {
      if (x < 0 || x >= MAP_SIZE) continue;
      for (let z = 1; z < MAP_SIZE; ++z) {
        if (!currentSpec.includeAt(x, z) || getPixelParity(x, z) !== shadedParity) continue;
        const color = colorGrid[x][z];
        const northZ = z - 1;
        if (!adjacentSpec.includeAt(x, northZ) || getPixelParity(x, northZ) !== northParity) continue;
        const north = colorGrid[x][northZ];
        if (!canReuseNorthColumnAsShader(color, north)) continue;
        shadedByRepeatedNorth.add(cellKey(x, z));
        repeatedNorthShaderColumns.add(cellKey(x, northZ));
      }
    }
  };

  const collectSharedNorthColumnsForWater = (
    waterParity: PixelParity,
    northParity: PixelParity,
    adjacentSpec: StepPhaseSpec | undefined,
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
    for (let x = 0; x < MAP_SIZE; ++x) {
      for (let z = MAP_SIZE - 1; z >= 1; --z) {
        if (!currentSpec.includeAt(x, z)) continue;
        const color = colorGrid[x][z];
        if (isTransparentColor(color)) continue;
        if (color.shade !== Shade.Flat && color.shade !== Shade.Dark) continue;
        const southKey = cellKey(x, z);
        const northKey = cellKey(x, z - 1);
        const requiredNorthOffset = (currentPhaseColorYOffsets.get(southKey) ?? 0) + (color.shade === Shade.Dark ? 1 : 0);
        if (shadedByCurrentNorth.has(southKey)) {
          currentPhaseColorYOffsets.set(
            northKey,
            Math.max(currentPhaseColorYOffsets.get(northKey) ?? 0, requiredNorthOffset),
          );
          continue;
        }
        if (shadedByRepeatedNorth.has(southKey)) {
          repeatedPhaseColorYOffsets.set(
            northKey,
            Math.max(repeatedPhaseColorYOffsets.get(northKey) ?? 0, requiredNorthOffset),
          );
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
        const shouldRepeat = currentSouthNeedsFlatWater || (repeatSouthWater && isWaterColor(south));
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
      for (let z = 0; z < MAP_SIZE; ++z) {
        if (!currentSpec.includeAt(x, z)) continue;
        const color = colorGrid[x][z];
        if (isTransparentColor(color)) continue;
        if (belowPlatformWater && isWaterColor(color)) continue;
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
        if (belowPlatformWater && isWaterColor(color)) continue;
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

  for (const key of repeatedBelowPlatformWaterColumns) {
    const [x, z] = parseColumnCoordKey(key);
    const color = colorGrid[x][z];
    if (!isWaterColor(color)) continue;
    const waterDrop = getWaterDrop(waterDrops, color.shade);
    pushUniqueDroppedWater({ x, y: getRepeatedPhaseBaseY(x, z) - waterDrop, z, ref: { kind: "color", color } });
  }

  return { blocks: stepBlocks, loweredWaterBlocks };
}

function buildStepPhaseParts(
  colorGrid: ColorGrid,
  buildMode: StepwiseBuildMode,
  stepDirection: SuppressStepDirection,
  mixSteps: boolean,
  waterDrops: WaterDrops | undefined,
  cache?: GridShapeCache,
): RawShapePart[] {
  const belowPlatformWater = waterDrops !== undefined;
  const specs = buildStepPhaseSpecsForDirection(buildMode, stepDirection);
  const steps: RawShapePart[] = [];
  const yOffset = getStepPhaseYOffset(colorGrid, cache, waterDrops);
  const previewWaterBlocks = belowPlatformWater
    ? buildBelowPlatformWaterPreviewBlocks(colorGrid, 0, waterDrops)
    : [];

  if (previewWaterBlocks.length > 0) {
    steps.push(buildShapePart([], [], true, new Set<number>(), previewWaterBlocks));
  }

  for (let stepIndex = 0; stepIndex < specs.length; ++stepIndex) {
    const baseY = (stepIndex + (previewWaterBlocks.length > 0 ? 1 : 0)) * yOffset;
    const { blocks, loweredWaterBlocks } = buildStepPhaseBlocks(
      colorGrid,
      specs[stepIndex],
      baseY,
      mixSteps ? specs[stepIndex - 1] : undefined,
      mixSteps ? specs[stepIndex + 1] : undefined,
      mixSteps,
      waterDrops,
    );
    steps.push(buildShapePart(blocks, [], true, new Set<number>([baseY - 1]), loweredWaterBlocks));
  }

  return steps;
}

function finalizeShapePart(part: RawShapePart): ShapePart {
  const cells = new Map<ShapeCoordKey, ShapeCell>();
  for (const block of part.blocks) {
    const key = toShapeCoordKey(block.x, block.y, block.z);
    cells.set(
      key,
      block.ref.kind === "color"
        ? { id: block.ref.color.id, isCustom: block.ref.color.isCustom }
        : [block.ref.role],
    );
  }
  for (const block of part.loweredWaterBlocks) {
    if (block.ref.kind !== "color") continue;
    const key = toShapeCoordKey(block.x, block.y, block.z);
    cells.set(key, { id: block.ref.color.id, isCustom: block.ref.color.isCustom });
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
    cells,
    bounds: part.bounds,
    supportFloorYs: part.supportFloorYs,
  };
}

function getShapeCacheKeyId(
  buildMode: InternalBuildMode,
  layerGap: number,
  mixSteps: boolean,
  stepDirection: SuppressStepDirection,
  paletteSeed: number,
  waterDrops?: WaterDrops,
): ShapeCacheKeyId {
  let id: string = buildMode;
  if (buildModeUsesLayerGap(buildMode)) id += `|gap:${layerGap}`;
  if (isSuppressStepsBuildMode(buildMode)) id += `|dir:${stepDirection}`;
  if (isSuppressStepsBuildMode(buildMode) && mixSteps) id += "|mixsteps:1";
  if (buildModeUsesPaletteSeed(buildMode)) id += `|seed:${paletteSeed}`;
  if (waterDrops) id += `|waterdrop:${waterDrops[Shade.Light]},${waterDrops[Shade.Flat]},${waterDrops[Shade.Dark]}`;
  return id as ShapeCacheKeyId;
}

function getCachedRawParts(cache: GridShapeCache, keyId: ShapeCacheKeyId, build: () => RawShapePart[]): RawShapePart[] {
  const cached = cache.rawParts.get(keyId);
  if (cached) return cached;
  const parts = build();
  cache.rawParts.set(keyId, parts);
  return parts;
}

function getCachedStaircaseBaseBlocks(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  excludeWater: boolean,
): ShapeBlock[] {
  const cacheKey = excludeWater ? "exclude-water" : "default";
  const cached = cache.staircaseBaseBlocks.get(cacheKey);
  if (cached) return cached;
  const blocks = buildStaircaseBlocks(colorGrid, excludeWater);
  cache.staircaseBaseBlocks.set(cacheKey, blocks);
  return blocks;
}

function getStaircaseVariantCacheKey(
  buildMode: StaircaseInternalBuildMode,
  paletteSeed: number,
  excludeWater: boolean,
): string {
  const modeKey = buildModeUsesPaletteSeed(buildMode) ? `${buildMode}|seed:${paletteSeed}` : buildMode;
  return `${excludeWater ? "exclude-water" : "default"}|${modeKey}`;
}

function getCachedStaircaseVariantBlocks(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: StaircaseInternalBuildMode,
  paletteSeed: number,
  waterDrops?: WaterDrops,
): ShapeBlock[] {
  const excludeWater = waterDrops !== undefined;
  const key = getStaircaseVariantCacheKey(buildMode, paletteSeed, excludeWater);
  const cached = cache.staircaseVariantBlocks.get(key);
  if (cached) return cached;

  const baseBlocks = buildMode === BuildMode.StaircaseGrouped
    ? getCachedStaircaseVariantBlocks(colorGrid, cache, BuildMode.StaircaseValley, paletteSeed, waterDrops)
    : getCachedStaircaseBaseBlocks(colorGrid, cache, excludeWater);
  const blocks = cloneShapeBlocks(baseBlocks);
  switch (buildMode) {
    case BuildMode.StaircaseNorthline:
      break;
    case BuildMode.StaircaseSouthline:
      applyStaircaseVariantSouthline(blocks);
      break;
    case BuildMode.StaircaseClassic:
      applyStaircaseVariantClassic(blocks);
      break;
    case BuildMode.StaircaseValley:
      applyStaircaseVariantValley(blocks, colorGrid, cache, excludeWater);
      break;
    case BuildMode.StaircaseGrouped:
      applyStaircaseVariantGroupedPostProcess(blocks, colorGrid, cache, excludeWater);
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
): RawShapePart[] {
  const belowPlatformWater = waterDrops !== undefined;
  const keyId = getShapeCacheKeyId(buildMode, 0, false, SuppressStepDirection.EastToWest, paletteSeed, waterDrops);
  return getCachedRawParts(cache, keyId, () => {
    const blocks = cloneShapeBlocks(getCachedStaircaseVariantBlocks(colorGrid, cache, buildMode, paletteSeed, waterDrops));
    if (belowPlatformWater) {
      const { loweredWaterBlocks, supportFloorYs } = buildBelowPlatformWaterBlocks(blocks, colorGrid, waterDrops);
      return [buildShapePart(blocks, [], true, supportFloorYs, loweredWaterBlocks)];
    }
    const waterConvenienceFillerCandidates = addStaircaseWaterConvenienceFillers(blocks, colorGrid, cache);
    return [buildShapePart(blocks, waterConvenienceFillerCandidates)];
  });
}

function getCachedSuppressSplitParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: BuildMode.SuppressSplitRow | BuildMode.SuppressSplitChecker,
  waterDrops?: WaterDrops,
): RawShapePart[] {
  const keyId = getShapeCacheKeyId(buildMode, 0, false, SuppressStepDirection.EastToWest, 0, waterDrops);
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
  mixSteps: boolean,
  waterDrops?: WaterDrops,
): RawShapePart[] {
  const keyId = getShapeCacheKeyId(buildMode, 0, mixSteps, stepDirection, 0, waterDrops);
  return getCachedRawParts(cache, keyId, () => buildStepPhaseParts(colorGrid, buildMode, stepDirection, mixSteps, waterDrops, cache));
}

function getCachedSuppress2LayerParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  layerGap: number,
  buildMode: TwoLayerSuppressBuildMode,
  waterDrops?: WaterDrops,
): RawShapePart[] {
  const keyId = getShapeCacheKeyId(buildMode, layerGap, false, SuppressStepDirection.EastToWest, 0, waterDrops);
  return getCachedRawParts(cache, keyId, () => {
    const { blocks, loweredWaterBlocks, supportFloorYs } = buildSuppressDualLayerBlocks(colorGrid, layerGap, buildMode, waterDrops);
    return [buildShapePart(blocks, [], true, supportFloorYs, loweredWaterBlocks)];
  });
}

function buildRawShapeParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: InternalBuildMode,
  layerGap: number,
  mixSteps: boolean,
  stepDirection: SuppressStepDirection,
  paletteSeed: number,
  waterDrops?: WaterDrops,
): RawShapePart[] {
  switch (buildMode) {
    case BuildMode.SuppressSplitRow:
      return getCachedSuppressSplitParts(colorGrid, cache, BuildMode.SuppressSplitRow, waterDrops);
    case BuildMode.SuppressSplitChecker:
      return getCachedSuppressSplitParts(colorGrid, cache, BuildMode.SuppressSplitChecker, waterDrops);
    case BuildMode.SuppressStepPairs:
      return getCachedSuppressStepParts(colorGrid, cache, BuildMode.SuppressStepPairs, stepDirection, mixSteps, waterDrops);
    case BuildMode.SuppressStepChecker:
      return getCachedSuppressStepParts(colorGrid, cache, BuildMode.SuppressStepChecker, stepDirection, mixSteps, waterDrops);
    case BuildMode.Suppress2LayerLateFillers:
      return getCachedSuppress2LayerParts(colorGrid, cache, layerGap, BuildMode.Suppress2LayerLateFillers, waterDrops);
    case BuildMode.Suppress2LayerLatePairs:
      return getCachedSuppress2LayerParts(colorGrid, cache, layerGap, BuildMode.Suppress2LayerLatePairs, waterDrops);
    default: {
      return getCachedStaircaseParts(colorGrid, cache, buildMode, paletteSeed, waterDrops);
    }
  }
}

function getGeneratedShape(
  colorGrid: ColorGrid,
  buildMode: InternalBuildMode,
  layerGap: number,
  mixSteps: boolean,
  stepDirection: SuppressStepDirection,
  paletteSeed: number,
  waterDrops?: WaterDrops,
): CachedGeneratedShape {
  const cache = getGridShapeCache(colorGrid);
  const cacheKeyId = getShapeCacheKeyId(buildMode, layerGap, mixSteps, stepDirection, paletteSeed, waterDrops);
  const cached = cache.shapes.get(cacheKeyId);
  if (cached) return cached;

  const rawParts = buildRawShapeParts(colorGrid, cache, buildMode, layerGap, mixSteps, stepDirection, paletteSeed, waterDrops);
  const parts = rawParts.map(finalizeShapePart);
  const splitExportNames =
    buildMode === BuildMode.SuppressSplitRow
      ? ["odd_rows", "even_rows"] as [string, string]
      : buildMode === BuildMode.SuppressSplitChecker
        ? ["dominant", "recessive"] as [string, string]
        : null;
  const shape = {
    parts,
    partType:
      buildMode === BuildMode.SuppressStepPairs || buildMode === BuildMode.SuppressStepChecker
        ? ShapePartType.SuppressStepPhases
        : ShapePartType.SingleColumn,
    splitExportNames,
  };
  const generatedShape = {
    shape,
    signatureId: getGeneratedShapeSignatureId(shape),
  };
  cache.shapes.set(cacheKeyId, generatedShape);
  return generatedShape;
}

// Callers:
// - src/Index.tsx
export function generateShapeMap(
  colorGrid: ColorGrid,
  allSameShade: Shade | undefined,
  hasWater: boolean,
  hasTransparency: boolean,
  hasTwoLayerLateVoidNeed: boolean,
  options: {
    layerGap: number;
    mixSteps?: boolean;
    paletteSeed?: number;
    waterDrops?: WaterDrops;
    selectedMode?: BuildMode | null;
    selectedStepDirection: SuppressStepDirection;
  },
): Partial<Record<BuildMode, GeneratedShape>> {
  const mixSteps = options.mixSteps ?? false;
  const stepDirection = options.selectedStepDirection;
  const paletteSeed = options.paletteSeed ?? 0;
  const waterDrops = options.waterDrops;
  const staircaseVisibleModes: BuildMode[] =
    !hasTransparency && !hasWater &&
    (allSameShade === Shade.Dark || allSameShade === Shade.Light)
      ? [allSameShade === Shade.Dark ? BuildMode.InclineUp : BuildMode.InclineDown]
      : [...DEFAULT_STAIRCASE_BUILD_MODES];
  const suppressVisibleModes: BuildMode[] = hasTwoLayerLateVoidNeed
    ? [...BASE_SUPPRESS_BUILD_MODES, BuildMode.Suppress2LayerLateFillers, BuildMode.Suppress2LayerLatePairs]
    : [...BASE_SUPPRESS_BUILD_MODES, BuildMode.Suppress2Layer];
  const seenShapeSignatures = new Set<GeneratedShapeSignatureId>();
  const shapes: Partial<Record<BuildMode, GeneratedShape>> = {};

  for (const buildMode of staircaseVisibleModes) {
    const internalBuildMode = getCanonicalBuildMode(buildMode);
    const { shape, signatureId } = getGeneratedShape(
      colorGrid,
      internalBuildMode,
      options.layerGap,
      mixSteps,
      stepDirection,
      paletteSeed,
      waterDrops,
    );
    if (seenShapeSignatures.has(signatureId)) continue;
    seenShapeSignatures.add(signatureId);
    shapes[buildMode] = shape;
  }

  const selectedMode = options.selectedMode ?? null;
  if (selectedMode && suppressVisibleModes.includes(selectedMode)) {
    const { shape, signatureId } = getGeneratedShape(
      colorGrid,
      getCanonicalBuildMode(selectedMode),
      options.layerGap,
      mixSteps,
      stepDirection,
      paletteSeed,
      waterDrops,
    );
    if (!seenShapeSignatures.has(signatureId)) {
      seenShapeSignatures.add(signatureId);
      shapes[selectedMode] = shape;
    }
  }

  return shapes;
}
