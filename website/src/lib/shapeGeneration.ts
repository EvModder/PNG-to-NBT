/**
 * Public API:
 * - GeneratedShape
 * - generateShapeMap()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/nbtExport.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeSubstitution.ts
 */
import {
  BuildMode,
  buildModeUsesLayerGap,
  buildModeUsesPaletteSeed,
  isStaircaseBuildMode,
} from "./conversionTypes";
import { FillerRole } from "./conversionTypes";
import { MAP_SIZE, type ColorData, type ColorGrid, getColorCell, isTransparentColor, isWaterColor } from "./colorGridTypes";
import { PixelParity, UniformNonFlatDirection, getPixelParity } from "./colorGridAnalysis";
import { ShapePartType, type ShapeCell, type ShapeColor, type ShapeCoordKey, type ShapePart, parseShapeCoordKey, toShapeCoordKey } from "./shapeTypes";

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeSubstitution.ts
export interface GeneratedShape {
  parts: ShapePart[];
  partType: ShapePartType;
  splitExportNames: [string, string] | null;
}

type PositionedEntry = { x: number; y: number; z: number };
type ShapeRef =
  | { kind: "color"; color: ColorData }
  | { kind: "filler"; role: FillerRole };
type ShapeBlock = PositionedEntry & { ref: ShapeRef };
type FillerCandidate = PositionedEntry & { roles: FillerRole[] };
type ShapeBounds = ShapePart["bounds"];
interface RawShapePart {
  blocks: ShapeBlock[];
  fillerCandidates: FillerCandidate[];
  bounds: ShapeBounds;
}
interface ShapeGenerationStats {
  hasWater: boolean;
  hasTransparency: boolean;
  uniformNonFlatDirection: UniformNonFlatDirection;
  hasTwoLayerLateVoidNeed: boolean;
}

type StepwiseBuildMode = BuildMode.SuppressPairsEW | BuildMode.SuppressCheckerEW;
type TwoLayerSuppressBuildMode = BuildMode.Suppress2LayerLateFillers | BuildMode.Suppress2LayerLatePairs;
type InternalBuildMode =
  | BuildMode.StaircaseNorthline
  | BuildMode.StaircaseSouthline
  | BuildMode.StaircaseClassic
  | BuildMode.StaircaseGrouped
  | BuildMode.StaircaseValley
  | BuildMode.StaircaseParty
  | BuildMode.SuppressSplitRow
  | BuildMode.SuppressSplitChecker
  | BuildMode.SuppressCheckerEW
  | BuildMode.SuppressPairsEW
  | BuildMode.Suppress2LayerLateFillers
  | BuildMode.Suppress2LayerLatePairs;
type ShapeCacheKey = Readonly<{
  buildMode: InternalBuildMode;
  layerGap: number;
  paletteSeed: number;
  waterFillerOffset: boolean;
}>;
type ShapeCacheKeyId = string & { readonly __shapeCacheKeyId: unique symbol };
type StaircaseBaseBlocksCache = { // Shared northline-style staircase block layouts before per-mode reshaping.
  base?: ShapeBlock[];
  waterOffset?: ShapeBlock[];
};
// Alias build modes are canonicalized before staircase-mode dispatch.
type StaircaseInternalBuildMode =
  | BuildMode.StaircaseNorthline
  | BuildMode.StaircaseSouthline
  | BuildMode.StaircaseClassic
  | BuildMode.StaircaseGrouped
  | BuildMode.StaircaseValley
  | BuildMode.StaircaseParty;

type ColumnPixelCell = { shade: number; isWater: boolean };
type ColumnCoordKey = number;

const DEFAULT_STAIRCASE_BUILD_MODES: InternalBuildMode[] = [
  BuildMode.StaircaseValley,
  BuildMode.StaircaseClassic,
  BuildMode.StaircaseGrouped,
  BuildMode.StaircaseNorthline,
  BuildMode.StaircaseSouthline,
  BuildMode.StaircaseParty,
];

const BASE_SUPPRESS_BUILD_MODES: InternalBuildMode[] = [
  BuildMode.SuppressSplitRow,
  BuildMode.SuppressSplitChecker,
  BuildMode.SuppressCheckerEW,
  BuildMode.SuppressPairsEW,
];

const ALL_VISIBLE_BUILD_MODE_SET = new Set<BuildMode>([
  BuildMode.Flat,
  BuildMode.InclineDown,
  BuildMode.InclineUp,
  ...DEFAULT_STAIRCASE_BUILD_MODES,
  ...BASE_SUPPRESS_BUILD_MODES,
  BuildMode.Suppress2Layer,
  BuildMode.Suppress2LayerLateFillers,
  BuildMode.Suppress2LayerLatePairs,
]);

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
  shapes: Map<ShapeCacheKeyId, GeneratedShape>;
  rawParts: Map<ShapeCacheKeyId, RawShapePart[]>;
   // Per-X non-transparent source-pixel lookup used by staircase transforms.
  columnPixelInfo: Map<number, Map<number, ColumnPixelCell>>;
  staircaseBaseBlocks: StaircaseBaseBlocksCache;
  // Cached vertical spacing between suppress step parts for this image.
  stepVariantYOffset?: number;
}

const SHAPE_CACHE = new WeakMap<ColorGrid, GridShapeCache>();

function getGridShapeCache(colorGrid: ColorGrid): GridShapeCache {
  let cache = SHAPE_CACHE.get(colorGrid);
  if (cache) return cache;
  cache = {
    shapes: new Map(),
    rawParts: new Map(),
    columnPixelInfo: new Map(),
    staircaseBaseBlocks: {},
  };
  SHAPE_CACHE.set(colorGrid, cache);
  return cache;
}

function getPixelColor(colorGrid: ColorGrid, x: number, z: number): ColorData {
  return getColorCell(colorGrid, x, z);
}

function getCachedColumnPixelInfo(colorGrid: ColorGrid, cache: GridShapeCache, x: number): Map<number, ColumnPixelCell> {
  const cached = cache.columnPixelInfo.get(x);
  if (cached) return cached;
  const info = new Map<number, { shade: number; isWater: boolean }>();
  for (let z = 0; z < MAP_SIZE; ++z) {
    const color = getPixelColor(colorGrid, x, z);
    if (!isTransparentColor(color)) info.set(z, { shade: color.shade, isWater: isWaterColor(color) });
  }
  cache.columnPixelInfo.set(x, info);
  return info;
}

function toColorRef(color: ColorData): ShapeRef {
  return { kind: "color", color };
}

function makeColorBlock(x: number, y: number, z: number, color: ColorData): ShapeBlock {
  return { x, y, z, ref: toColorRef(color) };
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
  rowPresent: Uint8Array;
  zValues: number[];
}

function buildColumnBlockRows<T extends PositionedEntry>(colBlocks: T[]): ColumnBlockRows<T> {
  const rowBlocks = new Array<T[] | undefined>(MAP_SIZE + 1);
  const rowMinY = new Array<number>(MAP_SIZE + 1).fill(Infinity);
  const rowMaxY = new Array<number>(MAP_SIZE + 1).fill(-Infinity);
  const rowPresent = new Uint8Array(MAP_SIZE + 1);
  const zValues: number[] = [];

  for (const block of colBlocks) {
    const idx = block.z + 1;
    let row = rowBlocks[idx];
    if (!row) {
      row = [];
      rowBlocks[idx] = row;
      rowPresent[idx] = 1;
      zValues.push(block.z);
    }
    row.push(block);
    if (block.y < rowMinY[idx]) rowMinY[idx] = block.y;
    if (block.y > rowMaxY[idx]) rowMaxY[idx] = block.y;
  }

  return { rowBlocks, rowMinY, rowMaxY, rowPresent, zValues };
}

function getWaterDepth(shade: number, x: number, z: number): number {
  const isRecessive = getPixelParity(x, z) === PixelParity.Recessive;
  switch (shade) {
    case 2:
      return 1;
    case 1:
      return isRecessive ? 5 : 3;
    default:
      return isRecessive ? 10 : 7;
  }
}

function isDarkShade(shade: number): boolean {
  return shade === 0 || shade === 3;
}

function isWaterBlock(block: ShapeBlock): boolean {
  return block.ref.kind === "color" && isWaterColor(block.ref.color);
}

function buildFillerCandidates(blocks: ShapeBlock[]): FillerCandidate[] {
  const occupied = new Set<ShapeCoordKey>();
  for (const block of blocks) occupied.add(toShapeCoordKey(block.x, block.y, block.z));

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

  const topY = new Map<ColumnCoordKey, number>();
  const maxColorY = new Map<ColumnCoordKey, number>();
  const waterRange = new Map<ColumnCoordKey, { minY: number; maxY: number }>();
  for (const block of blocks) {
    const coord = toColumnCoordKey(block.x, block.z);
    const current = topY.get(coord);
    if (current === undefined || block.y > current) topY.set(coord, block.y);
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

  for (const [coord, y] of topY) {
    const [x, z] = parseColumnCoordKey(coord);
    const northY = topY.get(toColumnCoordKey(x, z - 1));
    const southY = topY.get(toColumnCoordKey(x, z + 1));
    const westY = topY.get(toColumnCoordKey(x - 1, z));
    let needsStepSupport = northY !== undefined && y === northY + 1;
    if (needsStepSupport) {
      const northWater = waterRange.get(toColumnCoordKey(x, z - 1));
      if (northWater && northWater.minY <= y && y <= northWater.maxY) needsStepSupport = false;
    }
    if (!needsStepSupport && southY !== undefined && y === southY + 1) needsStepSupport = true;
    if (needsStepSupport && westY !== undefined && westY === y) needsStepSupport = false;
    if (needsStepSupport) addCandidate(x, y - 1, z, FillerRole.StairStep);
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

function buildBelowOnlyWaterFillerCandidates(blocks: ShapeBlock[]): FillerCandidate[] {
  const occupied = new Set<ShapeCoordKey>();
  const waterBottoms = new Map<ColumnCoordKey, PositionedEntry>();

  for (const block of blocks) {
    occupied.add(toShapeCoordKey(block.x, block.y, block.z));
    if (!isWaterBlock(block)) continue;
    const coord = toColumnCoordKey(block.x, block.z);
    const current = waterBottoms.get(coord);
    if (!current || block.y < current.y) waterBottoms.set(coord, { x: block.x, y: block.y, z: block.z });
  }

  const candidates: FillerCandidate[] = [];
  for (const bottom of waterBottoms.values()) {
    const belowKey = toShapeCoordKey(bottom.x, bottom.y - 1, bottom.z);
    if (occupied.has(belowKey)) continue;
    candidates.push({ x: bottom.x, y: bottom.y - 1, z: bottom.z, roles: [FillerRole.SupportWaterBase] });
  }
  return candidates;
}

function measureShapeBounds(blocks: ShapeBlock[]): ShapeBounds {
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

function buildShapePart(blocks: ShapeBlock[], extraFillerCandidates: FillerCandidate[] = [], includeDefaultFillerCandidates = true): RawShapePart {
  assertShapeBlockZRange(blocks);
  const fillerCandidates = includeDefaultFillerCandidates
    ? [...buildFillerCandidates(blocks), ...buildBelowOnlyWaterFillerCandidates(blocks), ...extraFillerCandidates]
    : extraFillerCandidates;
  return {
    blocks,
    fillerCandidates,
    bounds: measureShapeBounds(blocks),
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

function appendSuppressPixelBlocks(blocks: ShapeBlock[], x: number, baseY: number, z: number, color: ColorData): number {
  if (isWaterColor(color)) {
    const depth = getWaterDepth(color.shade, x, z);
    for (let d = 0; d < depth; ++d) blocks.push(makeColorBlock(x, baseY + d, z, color));
    return baseY + depth - 1;
  }

  blocks.push(makeColorBlock(x, baseY, z, color));
  if (color.shade === 1) {
    blocks.push(makeFillerBlock(x, baseY, z - 1, getShadeFillerRole(z - 1)));
    return baseY;
  }
  if (color.shade !== 2) {
    blocks.push(makeFillerBlock(x, baseY + 1, z - 1, getShadeFillerRole(z - 1)));
    return baseY + 1;
  }
  return baseY;
}

function getStepVariantYOffset(colorGrid: ColorGrid, cache?: GridShapeCache): number {
  if (cache?.stepVariantYOffset !== undefined) return cache.stepVariantYOffset;
  let yOffset = 1;
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = getPixelColor(colorGrid, x, z);
      if (isTransparentColor(color)) continue;
      if (isWaterColor(color)) {
        if (color.shade !== 2) yOffset = Math.max(yOffset, getWaterDepth(color.shade, x, z));
        continue;
      }
      if (isDarkShade(color.shade)) yOffset = Math.max(yOffset, 2);
    }
  }
  if (cache) cache.stepVariantYOffset = yOffset;
  return yOffset;
}

function buildStaircaseBlocks(colorGrid: ColorGrid, waterFillerOffset: boolean): ShapeBlock[] {
  const blocks: ShapeBlock[] = [];
  const baseY = 64;

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
      const color = getPixelColor(colorGrid, x, z);
      if (isTransparentColor(color)) {
        north = { y: north.y, transparent: true };
        continue;
      }

      const colorRef = toColorRef(color);
      if (isWaterColor(color)) {
        const depth = getWaterDepth(color.shade, x, z);
        let bottom = north.waterBottom !== undefined ? north.waterBottom : north.y;
        if (waterFillerOffset && color.shade !== 2 && north.waterBottom === undefined) ++bottom;
        const top = bottom + depth - 1;
        for (let d = 0; d < depth; ++d) addBlock(x, bottom + d, z, colorRef);
        north = { y: top, transparent: false, waterBottom: bottom, waterDepth: depth };
        continue;
      }

      if (north.transparent) {
        switch (color.shade) {
          case 1:
            addVoidShadowFiller(x, north.y, z - 1);
            break;
          case 2:
            break;
          case 0:
            addVoidShadowFiller(x, north.y + 1, z - 1);
            break;
          // case 3:
          //   break; // Unreachable: the darkest shade should never survive color conversion.
          default:
            throw new Error(`Unexpected staircase shade: ${color.shade}`);
        }
        addBlock(x, north.y, z, colorRef);
        north = { y: north.y, transparent: false };
        continue;
      }

      switch (color.shade) {
        case 1:
          addBlock(x, north.y, z, colorRef);
          north = { y: north.y, transparent: false };
          break;
        case 2:
          addBlock(x, north.y + 1, z, colorRef);
          north = { y: north.y + 1, transparent: false };
          break;
        case 0:
          {
            const northIsDeepWater = north.waterBottom !== undefined && (north.waterDepth ?? 0) > 1;
            const useY = northIsDeepWater
              ? north.waterBottom!
              : (north.waterBottom !== undefined ? north.waterBottom : north.y) - 1;
            addBlock(x, useY, z, colorRef);
            north = { y: useY, transparent: false };
          }
          break;
        // case 3:
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
  waterFillerOffset: boolean,
) {
  const fillerCandidates: FillerCandidate[] = [];
  const occupied = new Set<ShapeCoordKey>();
  for (const block of blocks) occupied.add(toShapeCoordKey(block.x, block.y, block.z));

  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    const { rowBlocks, rowMinY, rowMaxY, rowPresent } = buildColumnBlockRows(colBlocks);
    const pixelInfo = getCachedColumnPixelInfo(colorGrid, cache, x);
    const primaryPresent = new Uint8Array(MAP_SIZE);
    const waterZ = new Uint8Array(MAP_SIZE);
    let hasPrimary = false;
    for (let z = 0; z < MAP_SIZE; ++z) {
      const info = pixelInfo.get(z);
      if (!info) continue;
      hasPrimary = true;
      primaryPresent[z] = 1;
      if (info.isWater) waterZ[z] = 1;
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
      if (!waterInfo || !waterInfo.isWater || waterInfo.shade === 2) continue;

      const waterBottom = rowMinY[waterZPos + 1];
      const waterTop = rowMaxY[waterZPos + 1];
      const waterDepth = waterTop - waterBottom + 1;
      if (waterDepth <= 1 || waterBottom === 0) continue;

      let runEndZ = waterZPos;
      while (runEndZ + 1 < MAP_SIZE) {
        const nextInfo = pixelInfo.get(runEndZ + 1);
        if (!nextInfo || nextInfo.isWater) break;
        if (nextInfo.shade !== 1 && nextInfo.shade !== 2) break;
        ++runEndZ;
      }

      const runLength = runEndZ - waterZPos;
      if (runLength <= 0 || runLength >= waterDepth) continue;

      const darkZ = runEndZ + 1;
      const darkInfo = pixelInfo.get(darkZ);
      if (darkZ >= MAP_SIZE || !darkInfo || darkInfo.isWater || !isDarkShade(darkInfo.shade) || !rowPresent[darkZ + 1]) {
        // throw new Error(`Invalid staircase water convenience segment at x=${x}, z=${waterZPos}`);
        continue;
      }

      const darkY = rowMaxY[darkZ + 1];
      const targetWaterBottom = darkY + (waterFillerOffset ? 1 : 0);
      const delta = targetWaterBottom - waterBottom;

      shiftRows(waterZPos, runEndZ, delta);

      for (let z = waterZPos + 1; z < darkZ; ++z) {
        const coord = toShapeCoordKey(x, darkY, z);
        if (occupied.has(coord)) continue;
        fillerCandidates.push({
          x,
          y: darkY,
          z,
          roles: [FillerRole.SupportAll, FillerRole.StairStep, FillerRole.WaterPath],
        });
      }
    }
  }
  return fillerCandidates;
}

function applyStaircaseVariantGrouped<T extends PositionedEntry>(blocks: T[], colorGrid: ColorGrid, cache: GridShapeCache) {
  const rowKey = (x: number, z: number) => toColumnCoordKey(x, z);
  type PixelInfo = { shade: number; isWater: boolean };
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
    minY: number;
    maxY: number;
  }

  const pixelByColumn = new Map<number, Map<number, PixelInfo>>();
  for (let x = 0; x < MAP_SIZE; ++x) {
    const zInfo = getCachedColumnPixelInfo(colorGrid, cache, x);
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
      let segMaxY = -Infinity;
      for (const z of moveRows) {
        const row = zRows.get(z);
        if (!row) continue;
        segmentRows.push(row);
        if (row.maxY > segMaxY) segMaxY = row.maxY;
      }

      let segMin = Infinity;
      for (const z of primaryZList) segMin = Math.min(segMin, minY.get(z)!);
      const segment: GroupedSegment = {
        id: segments.length,
        x,
        primaryZ: primaryZList,
        rows: segmentRows,
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

        if (info.shade === 2 && !(y > northY)) return false;
        if (info.shade === 1 && y !== northY) return false;
        if ((info.shade === 0 || info.shade === 3) && !(y < northY)) return false;
      }
    }

    return true;
  };

  const moveGroup = (groupIds: Set<number>, delta: number) => {
    for (const segmentId of groupIds) {
      const segment = segments[segmentId];
      for (const row of segment.rows) {
        row.minY += delta;
        row.maxY += delta;
        for (let i = 0; i < row.yValues.length; ++i) row.yValues[i] += delta;
        for (const block of row.blocks) block.y += delta;
      }
      segment.minY += delta;
      segment.maxY += delta;
      for (const z of segment.primaryZ) {
        const coord = rowKey(segment.x, z);
        primaryTopY.set(coord, primaryTopY.get(coord)! + delta);
        primaryMinY.set(coord, primaryMinY.get(coord)! + delta);
      }
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
) {
  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    const pixelShade = cache
      ? getCachedColumnPixelInfo(colorGrid, cache, x)
      : getCachedColumnPixelInfo(colorGrid, getGridShapeCache(colorGrid), x);
    const { rowBlocks, rowMinY, rowMaxY, zValues } = buildColumnBlockRows(colBlocks);
    const waterZ = new Uint8Array(MAP_SIZE);
    const primaryPresent = new Uint8Array(MAP_SIZE);
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
      primaryPresent[z] = 1;
      if (info.isWater) waterZ[z] = 1;
      currentMaxY[z] = rowMaxY[z + 1];
    }

    const processed = new Uint8Array(MAP_SIZE);
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
        processed[northZ] = 1;
      }
      for (let z = startZ; z <= endZ; ++z) processed[z] = 1;
      segments.push({ zStart, zEnd: endZ, topY, firstNonWaterZ: startZ, waterZPos, waterDepth });
    }

    for (let z = 0; z < MAP_SIZE; ++z) {
      if (!waterZ[z] || processed[z]) continue;
      processed[z] = 1;
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
      if (!southInfo || southInfo.isWater || southInfo.shade === 2) {
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
          if (segmentInfo.shade === 2) targetTopY = Math.max(targetTopY, northY + 1);
          else if (segmentInfo.shade === 1) targetTopY = Math.max(targetTopY, northY);
        }
      }

      if (segment.waterDepth !== undefined && segment.waterDepth > 1) {
        const waterBottom = targetTopY - (segment.waterDepth - 1);
        if (waterBottom < 0) targetTopY += -waterBottom;
      }

      const waterZPos = segment.waterZPos;
      const waterInfo = waterZPos !== undefined ? pixelShade.get(waterZPos) : undefined;
      const isDarkMediumWater = !!waterInfo && (waterInfo.shade === 0 || waterInfo.shade === 1 || waterInfo.shade === 3);
      if (isDarkMediumWater && segment.waterDepth !== undefined && segment.waterDepth > 1) {
        const waterBottomAfter = targetTopY - (segment.waterDepth - 1);
        if (segment.zStart === segment.zEnd) {
          const southShade = pixelShade.get(southZ);
          if (southShade && (southShade.shade === 0 || southShade.shade === 3) && waterBottomAfter !== 0) {
            const southY = southZ < MAP_SIZE && primaryPresent[southZ] ? currentMaxY[southZ] : undefined;
            if (southY !== undefined) targetTopY = southY + (segment.waterDepth - 1);
          }
        } else if (waterBottomAfter !== 0) {
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

function applyStaircaseVariantParty<T extends PositionedEntry>(blocks: T[], colorGrid: ColorGrid, paletteSeed = 0, cache?: GridShapeCache) {
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

    const pixelInfo = cache ? getCachedColumnPixelInfo(colorGrid, cache, x) : getCachedColumnPixelInfo(colorGrid, getGridShapeCache(colorGrid), x);

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
      if (south.shade === 2) return 1;
      if (south.shade === 1) return 0;
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

function buildSuppressSplitRowBlockSets(colorGrid: ColorGrid): ShapeBlock[][] {
  const buildHalf = (startRow: 0 | 1): ShapeBlock[] => {
    const blocks: ShapeBlock[] = [];
    for (let x = 0; x < MAP_SIZE; ++x) {
      for (let z = 0; z < MAP_SIZE; ++z) {
        if (z % 2 !== startRow) continue;
        const color = getPixelColor(colorGrid, x, z);
        if (isTransparentColor(color)) continue;
        appendSuppressPixelBlocks(blocks, x, 0, z, color);
      }
    }
    return blocks;
  };

  return [buildHalf(0), buildHalf(1)];
}

function buildSuppressSplitCheckerBlockSets(colorGrid: ColorGrid): ShapeBlock[][] {
  const buildHalf = (useDominant: boolean): ShapeBlock[] => {
    const blocks: ShapeBlock[] = [];
    for (let x = 0; x < MAP_SIZE; ++x) {
      for (let z = 0; z < MAP_SIZE; ++z) {
        const isDominant = getPixelParity(x, z) === PixelParity.Dominant;
        if (isDominant !== useDominant) continue;
        const color = getPixelColor(colorGrid, x, z);
        if (isTransparentColor(color)) continue;
        if (isWaterColor(color)) {
          const depth = getWaterDepth(color.shade, x, z);
          for (let d = 0; d < depth; ++d) blocks.push(makeColorBlock(x, -1 - d, z, color));
          continue;
        }
        appendSuppressPixelBlocks(blocks, x, 0, z, color);
      }
    }
    return blocks;
  };

  return [buildHalf(true), buildHalf(false)];
}

function buildSuppressDualLayerBlocks(
  colorGrid: ColorGrid,
  layerGap: number | undefined,
  buildMode: TwoLayerSuppressBuildMode,
): ShapeBlock[] {
  const topYGrid: (number | undefined)[][] = Array.from({ length: MAP_SIZE }, () => new Array<number | undefined>(MAP_SIZE).fill(undefined));
  const blocks: ShapeBlock[] = [];
  const occupied = new Set<ShapeCoordKey>();
  const lowerY = 0;
  const upperY = Math.max(1, layerGap ?? 5);
  const lateY = upperY + 2;
  const loweredRecessive = new Set<ColumnCoordKey>();
  const lateDominant = new Set<ColumnCoordKey>();
  const cellKey = (x: number, z: number) => toColumnCoordKey(x, z);
  const isRecessive = (x: number, z: number) => getPixelParity(x, z) === PixelParity.Recessive;
  const isDominant = (x: number, z: number) => getPixelParity(x, z) === PixelParity.Dominant;
  const isDarkShade = (shade: number) => shade === 0 || shade === 3;
  const shadeDeltaFromSouth = (shade: number) => (shade === 2 ? 1 : shade === 1 ? 0 : -1);
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
      const dom = getPixelColor(colorGrid, x, domZ);
      const rec = getPixelColor(colorGrid, x, recZ);
      if (isTransparentColor(dom) || isTransparentColor(rec) || isWaterColor(dom) || isWaterColor(rec) || dom.shade !== 1) continue;
      const northZ = recZ - 1;
      const north = getPixelColor(colorGrid, x, northZ);
      let canLower = false;
      if (isDarkShade(rec.shade)) canLower = recZ === 0;
      else if (rec.shade === 1) {
        const hasRegularNorthDominant = northZ >= 0 && isDominant(x, northZ) && !isTransparentColor(north) && !isWaterColor(north);
        canLower = recZ === 0 || hasRegularNorthDominant;
      } else if (rec.shade === 2) {
        canLower = isTransparentColor(north);
      }
      if (canLower) loweredRecessive.add(cellKey(x, recZ));
    }
  }

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = MAP_SIZE - 1; z >= 0; --z) {
      const color = getPixelColor(colorGrid, x, z);
      if (isTransparentColor(color)) continue;
      if (isWaterColor(color)) {
        const south = getPixelColor(colorGrid, x, z + 1);
        const southTopY = z < MAP_SIZE - 1 ? topYGrid[x][z + 1] : undefined;
        let topY = lowerY - 1;
        if (isRecessive(x, z) && !isTransparentColor(south) && !isWaterColor(south) && southTopY !== undefined) {
          topY = southTopY + shadeDeltaFromSouth(color.shade);
        }
        const depth = getWaterDepth(color.shade, x, z);
        for (let d = 0; d < depth; ++d) addBlock(x, topY - d, z, toColorRef(color));
        topYGrid[x][z] = topY;
        continue;
      }

      let y = isDominant(x, z) || loweredRecessive.has(cellKey(x, z)) ? lowerY : upperY;
      if (buildMode === BuildMode.Suppress2LayerLatePairs && isDominant(x, z) && color.shade === 1 && z > 0 && isTransparentColor(getPixelColor(colorGrid, x, z - 1))) {
        y = lateY;
        lateDominant.add(cellKey(x, z));
      }
      addBlock(x, y, z, toColorRef(color));
      topYGrid[x][z] = y;
    }
  }

  const fillerPlacements = new Map<ShapeCoordKey, ShapeRef>();
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = getPixelColor(colorGrid, x, z);
      if (isTransparentColor(color) || isWaterColor(color) || color.shade === 2) continue;
      const topY = topYGrid[x][z];
      if (topY === undefined) continue;
      const fillY = topY + (isDarkShade(color.shade) ? 1 : 0);
      const fillZ = z - 1;
      const coord = toShapeCoordKey(x, fillY, fillZ);
      if (occupied.has(coord)) continue;
      const lateSuppressDominantVoid = isDominant(x, z) && fillZ >= 0 && isTransparentColor(getPixelColor(colorGrid, x, fillZ));
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
    for (const key of loweredRecessive) {
      const [x, z] = parseColumnCoordKey(key);
      const color = getPixelColor(colorGrid, x, z);
      if (isTransparentColor(color) || isWaterColor(color) || color.shade !== 1) continue;
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

  return blocks;
}

function buildStepVariantParts(colorGrid: ColorGrid, buildMode: StepwiseBuildMode, cache?: GridShapeCache): RawShapePart[] {
  const steps: RawShapePart[] = [];
  let baseY = 0;
  const yOffset = getStepVariantYOffset(colorGrid, cache);

  const emitStep = (cols: number[], includeAt: (x: number, z: number) => boolean) => {
    const stepBlocks: ShapeBlock[] = [];

    for (const x of cols) {
      if (x < 0 || x >= MAP_SIZE) continue;
      for (let z = 0; z < MAP_SIZE; ++z) {
        if (!includeAt(x, z)) continue;
        const color = getPixelColor(colorGrid, x, z);
        if (isTransparentColor(color)) continue;

        appendSuppressPixelBlocks(stepBlocks, x, baseY, z, color);
      }
    }

    steps.push(buildShapePart(stepBlocks));
    baseY += yOffset;
  };

  if (buildMode === BuildMode.SuppressPairsEW) {
    let anchor = MAP_SIZE - 1;
    let step = 0;
    while (anchor >= 0) {
      const cols = step === 0 ? [MAP_SIZE - 1] : [anchor + 1, anchor];
      emitStep(cols, (_x, z) => (step % 2 === 0 ? z % 2 === 1 : z % 2 === 0));
      --anchor;
      ++step;
    }
    emitStep([0], (_x, z) => (step % 2 === 0 ? z % 2 === 1 : z % 2 === 0));
    return steps;
  }

  emitStep([MAP_SIZE - 1, MAP_SIZE - 2], (x, z) => getPixelParity(x, z) === PixelParity.Recessive);
  for (let start = MAP_SIZE - 4; start >= 0; start -= 2) {
    const dominantCols = new Set<number>([start + 3, start + 2]);
    const recessiveCols = new Set<number>([start + 1, start]);
    emitStep([start + 3, start + 2, start + 1, start], (x, z) => {
      const isDominant = getPixelParity(x, z) === PixelParity.Dominant;
      return isDominant ? dominantCols.has(x) : recessiveCols.has(x);
    });
  }
  emitStep([1, 0], (x, z) => getPixelParity(x, z) === PixelParity.Dominant);
  return steps;
}

function toShapeColor(color: ColorData): ShapeColor {
  return { id: color.id, isCustom: color.isCustom };
}

function finalizeShapePart(part: RawShapePart): ShapePart {
  const cells = new Map<ShapeCoordKey, ShapeCell>();
  for (const block of part.blocks) {
    const key = toShapeCoordKey(block.x, block.y, block.z);
    cells.set(
      key,
      block.ref.kind === "color"
        ? toShapeColor(block.ref.color)
        : [block.ref.role],
    );
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
  };
}

function toInternalBuildMode(buildMode: BuildMode): InternalBuildMode {
  return getCanonicalBuildMode(buildMode);
}

function getShapeCacheKey(
  buildMode: InternalBuildMode,
  layerGap: number,
  paletteSeed: number,
  waterFillerOffset: boolean,
): ShapeCacheKey {
  return { buildMode, layerGap, paletteSeed, waterFillerOffset };
}

function getShapeCacheKeyId(key: ShapeCacheKey): ShapeCacheKeyId {
  let id: string = key.buildMode;
  if (buildModeUsesLayerGap(key.buildMode)) id += `|gap:${key.layerGap}`;
  if (buildModeUsesPaletteSeed(key.buildMode)) id += `|seed:${key.paletteSeed}`;
  if (isStaircaseBuildMode(key.buildMode) && key.waterFillerOffset) id += "|wateroffset:1";
  return id as ShapeCacheKeyId;
}

function getCachedRawParts(cache: GridShapeCache, key: ShapeCacheKey, build: () => RawShapePart[]): RawShapePart[] {
  const keyId = getShapeCacheKeyId(key);
  const cached = cache.rawParts.get(keyId);
  if (cached) return cached;
  const parts = build();
  cache.rawParts.set(keyId, parts);
  return parts;
}

function getCachedStaircaseBaseBlocks(colorGrid: ColorGrid, cache: GridShapeCache, waterFillerOffset: boolean): ShapeBlock[] {
  const cached = waterFillerOffset ? cache.staircaseBaseBlocks.waterOffset : cache.staircaseBaseBlocks.base;
  if (cached) return cached;
  const blocks = buildStaircaseBlocks(colorGrid, waterFillerOffset);
  if (waterFillerOffset) cache.staircaseBaseBlocks.waterOffset = blocks;
  else cache.staircaseBaseBlocks.base = blocks;
  return blocks;
}

function getCachedStaircaseParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: StaircaseInternalBuildMode,
  paletteSeed: number,
  waterFillerOffset: boolean,
): RawShapePart[] {
  const modeKey = getShapeCacheKey(buildMode, 0, paletteSeed, waterFillerOffset);
  return getCachedRawParts(cache, modeKey, () => {
    const blocks = cloneShapeBlocks(getCachedStaircaseBaseBlocks(colorGrid, cache, waterFillerOffset));
    switch (buildMode) {
      case BuildMode.StaircaseNorthline:
        // No special handling.
        // Just (potentially) adding water convenience fillers (below).
        break;
      case BuildMode.StaircaseSouthline:
        applyStaircaseVariantSouthline(blocks);
        break;
      case BuildMode.StaircaseClassic:
        applyStaircaseVariantClassic(blocks);
        break;
      case BuildMode.StaircaseValley:
        applyStaircaseVariantValley(blocks, colorGrid, cache);
        break;
      case BuildMode.StaircaseGrouped:
        applyStaircaseVariantValley(blocks, colorGrid, cache);
        applyStaircaseVariantGrouped(blocks, colorGrid, cache);
        break;
      case BuildMode.StaircaseParty:
        applyStaircaseVariantParty(blocks, colorGrid, paletteSeed, cache);
        break;
      default:
        assertUnhandledBuildMode(buildMode, "getCachedStaircaseParts");
    }
    const extraFillerCandidates = addStaircaseWaterConvenienceFillers(blocks, colorGrid, cache, waterFillerOffset);
    return [buildShapePart(blocks, extraFillerCandidates)];
  });
}

function getCachedSuppressSplitParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: BuildMode.SuppressSplitRow | BuildMode.SuppressSplitChecker,
): RawShapePart[] {
  const key = getShapeCacheKey(buildMode, 0, 0, false);
  return getCachedRawParts(cache, key, () =>
    buildMode === BuildMode.SuppressSplitRow
      ? buildSuppressSplitRowBlockSets(colorGrid).map(blocks => buildShapePart(blocks))
      : buildSuppressSplitCheckerBlockSets(colorGrid).map(blocks => buildShapePart(blocks)),
  );
}

function getCachedSuppressStepParts(colorGrid: ColorGrid, cache: GridShapeCache, buildMode: StepwiseBuildMode): RawShapePart[] {
  const key = getShapeCacheKey(buildMode, 0, 0, false);
  return getCachedRawParts(cache, key, () => buildStepVariantParts(colorGrid, buildMode, cache));
}

function getCachedSuppress2LayerParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  layerGap: number,
  buildMode: TwoLayerSuppressBuildMode,
): RawShapePart[] {
  const key = getShapeCacheKey(buildMode, layerGap, 0, false);
  return getCachedRawParts(cache, key, () => [buildShapePart(buildSuppressDualLayerBlocks(colorGrid, layerGap, buildMode))]);
}

function buildGeneratedShapeParts(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: InternalBuildMode,
  layerGap: number,
  paletteSeed: number,
  waterFillerOffset: boolean,
): RawShapePart[] {
  switch (buildMode) {
    case BuildMode.SuppressSplitRow:
      return getCachedSuppressSplitParts(colorGrid, cache, BuildMode.SuppressSplitRow);
    case BuildMode.SuppressSplitChecker:
      return getCachedSuppressSplitParts(colorGrid, cache, BuildMode.SuppressSplitChecker);
    case BuildMode.SuppressPairsEW:
      return getCachedSuppressStepParts(colorGrid, cache, BuildMode.SuppressPairsEW);
    case BuildMode.SuppressCheckerEW:
      return getCachedSuppressStepParts(colorGrid, cache, BuildMode.SuppressCheckerEW);
    case BuildMode.Suppress2LayerLateFillers:
      return getCachedSuppress2LayerParts(colorGrid, cache, layerGap, BuildMode.Suppress2LayerLateFillers);
    case BuildMode.Suppress2LayerLatePairs:
      return getCachedSuppress2LayerParts(colorGrid, cache, layerGap, BuildMode.Suppress2LayerLatePairs);
    default: {
      return getCachedStaircaseParts(colorGrid, cache, buildMode, paletteSeed, waterFillerOffset);
    }
  }
}

function getGeneratedShape(
  colorGrid: ColorGrid,
  cache: GridShapeCache,
  buildMode: InternalBuildMode,
  layerGap: number,
  paletteSeed: number,
  waterFillerOffset: boolean,
): GeneratedShape {
  const cacheKey = getShapeCacheKey(buildMode, layerGap, paletteSeed, waterFillerOffset);
  const cacheKeyId = getShapeCacheKeyId(cacheKey);
  const cached = cache.shapes.get(cacheKeyId);
  if (cached) return cached;

  const rawParts = buildGeneratedShapeParts(colorGrid, cache, buildMode, layerGap, paletteSeed, waterFillerOffset);
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
      buildMode === BuildMode.SuppressCheckerEW || buildMode === BuildMode.SuppressPairsEW
        ? ShapePartType.SuppressStepColumns
        : ShapePartType.SingleColumn,
    splitExportNames,
  };
  cache.shapes.set(cacheKeyId, shape);
  return shape;
}

// Callers:
// - src/Index.tsx
export function generateShapeMap(
  colorGrid: ColorGrid,
  options: { layerGap: number; paletteSeed?: number; waterFillerOffset?: boolean },
  modeStats?: ShapeGenerationStats,
): Partial<Record<BuildMode, GeneratedShape>> {
  const cache = getGridShapeCache(colorGrid);
  const paletteSeed = options.paletteSeed ?? 0;
  const waterFillerOffset = options.waterFillerOffset ?? false;
  const twoLayerHasLateVoidNeed = modeStats?.hasTwoLayerLateVoidNeed ?? false;
  const staircaseVisibleModes: BuildMode[] =
    modeStats && !modeStats.hasTransparency && !modeStats.hasWater &&
    (modeStats.uniformNonFlatDirection !== UniformNonFlatDirection.Mixed)
      ? [
          BuildMode.StaircaseValley,
          BuildMode.StaircaseClassic,
          BuildMode.StaircaseGrouped,
          modeStats.uniformNonFlatDirection === UniformNonFlatDirection.AllLight ? BuildMode.InclineDown : BuildMode.InclineUp,
          BuildMode.StaircaseSouthline,
          BuildMode.StaircaseParty,
        ]
      : [...DEFAULT_STAIRCASE_BUILD_MODES];
  const suppressVisibleModes: BuildMode[] = twoLayerHasLateVoidNeed
    ? [...BASE_SUPPRESS_BUILD_MODES, BuildMode.Suppress2LayerLateFillers, BuildMode.Suppress2LayerLatePairs]
    : [...BASE_SUPPRESS_BUILD_MODES, BuildMode.Suppress2Layer];
  const visibleModes = new Set<BuildMode>([...staircaseVisibleModes, ...suppressVisibleModes]);

  const shapes = new Proxy({} as Partial<Record<BuildMode, GeneratedShape>>, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      if (!ALL_VISIBLE_BUILD_MODE_SET.has(prop as BuildMode)) return Reflect.get(target, prop, receiver);
      if (!visibleModes.has(prop as BuildMode)) return undefined;
      let shape = target[prop as BuildMode];
      if (!shape) {
        shape = getGeneratedShape(colorGrid, cache, toInternalBuildMode(prop as BuildMode), options.layerGap, paletteSeed, waterFillerOffset);
        target[prop as BuildMode] = shape;
      }
      return shape;
    },
    ownKeys() {
      return [...visibleModes];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && visibleModes.has(prop as BuildMode)) {
        return {
          enumerable: true,
          configurable: true,
          value: target[prop as BuildMode],
          writable: false,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });

  return shapes;
}
