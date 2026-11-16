/**
 * Staircase block layouts: the base staircase, inclines, transparent placements and the
 * Group, Classic, Southline, Valley and Party variants derived from them.
 *
 * Public API:
 * - StaircaseInternalBuildMode
 * - TransparentPlacementBuildMode
 * - buildStaircaseBlocks()
 * - buildTransparentStaircaseBlocks()
 * - buildInclineBlocks()
 * - addStaircaseWaterConvenienceFillers()
 * - buildBelowPlatformWaterBlocks()
 * - applyStaircaseVariantGroupPostProcess()
 * - getStaircaseClassicColumnOffsets()
 * - getStaircaseSouthlineColumnOffsets()
 * - applyColumnYOffsets()
 * - applyStaircaseVariantValley()
 * - applyStaircaseVariantParty()
 *
 * Callers:
 * - src/lib/shapeGeneration.ts
 */
import { Shade, type ColorGrid } from "@/types/color";
import { BuildMode, FillerRole } from "@/types/conversion";
import type { ShapeCoordKey } from "@/types/shape";
import { MAP_SIZE, TRANSPARENT_COLOR, isTransparentColor, isWaterColor } from "@/utils/color";
import { mulberry32 } from "@/utils/hash";
import {
  buildColumnBlockRows, getCachedColumnPixelInfo, getWaterDepth, getWaterDrop, groupBlocksByColumn, isWaterBlock, makeFillerBlock,
  toColumnCoordKey, type ColumnCoordKey, type ColumnPixelCache, type FillerCandidate, type PositionedEntry, type ShapeBlock, type ShapeRef,
} from "./shapeBlocks";
import { PixelParity, getPixelParity, type WaterDrops } from "./colorGridAnalysis";
import { toShapeCoordKey } from "./shapeModel";

// Callers:
// - src/lib/shapeGeneration.ts
//
// Alias build modes are canonicalized before staircase-mode dispatch.
export type StaircaseInternalBuildMode =
  | BuildMode.InclineUp
  | BuildMode.InclineDown
  | BuildMode.StaircaseNorthline
  | BuildMode.StaircaseSouthline
  | BuildMode.StaircaseClassic
  | BuildMode.StaircaseValley
  | BuildMode.StaircaseGroup
  | BuildMode.StaircaseParty;

// Callers:
// - src/lib/shapeGeneration.ts
export type TransparentPlacementBuildMode = StaircaseInternalBuildMode;

function makeVoidAwareShadeFiller(x: number, y: number, z: number): ShapeBlock {
  if (z < 0) return makeFillerBlock(x, y, z, FillerRole.ShadeNorthRow);
  return makeFillerBlock(
    x,
    y,
    z,
    getPixelParity(x, z) === PixelParity.Recessive ? FillerRole.ShadeVoidRecessive : FillerRole.ShadeVoidDominant,
  );
}

// Callers:
// - src/lib/shapeGeneration.ts
export function buildStaircaseBlocks(
  colorGrid: ColorGrid,
  omitWater: boolean,
  topAlignedWater: boolean,
  buildAtWorldMinY: boolean,
): ShapeBlock[] {
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
        const northIsWater = north.waterBottom !== undefined;
        const anchorY = northIsWater
          ? (topAlignedWater ? north.y : north.waterBottom!)
          : north.y;
        const bottom = topAlignedWater ? anchorY - depth + 1 : anchorY;
        const top = bottom + depth - 1;
        for (let d = 0; d < depth; ++d) addBlock(x, bottom + d, z, colorRef);
        north = { y: top, transparent: false, waterBottom: bottom };
        continue;
      }

      if (north.transparent) {
        let colorY = north.y;
        switch (color.shade) {
          case Shade.Dark:
            if (z === 0)  colorY = north.y - 1;
            addVoidShadowFiller(x, colorY + 1, z - 1);
            break;
          case Shade.Flat:
            if (!buildAtWorldMinY) addVoidShadowFiller(x, north.y, z - 1);
            break;
          case Shade.Light:
            if (buildAtWorldMinY || (topRowHasNorthlineFiller && z === 0)) colorY = north.y + 1;
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
            // Preserve bottom alignment for deep water, but always drop below its top.
            const useY = !topAlignedWater && north.waterBottom !== undefined
              ? Math.min(north.waterBottom, north.y - 1)
              : north.y - 1;
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

// Callers:
// - src/lib/shapeGeneration.ts
export function buildTransparentStaircaseBlocks(
  colorGrid: ColorGrid,
  blocks: ShapeBlock[],
  buildMode: TransparentPlacementBuildMode,
  paletteSeed: number,
  occupiedExtraBlocks: ShapeBlock[] = [],
): { blocks: ShapeBlock[]; suppressedTransparentVsCollisionCount: number } {
  let hasTransparency = false;
  for (let x = 0; x < MAP_SIZE && !hasTransparency; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      if (isTransparentColor(colorGrid[x][z])) {
        hasTransparency = true;
        break;
      }
    }
  }
  if (!hasTransparency) return { blocks: [], suppressedTransparentVsCollisionCount: 0 };

  const occupiedRefsByCell = new Map<ColumnCoordKey, Map<number, ShapeRef>>();
  const rowTopYByColumn = Array.from({ length: MAP_SIZE }, () => new Map<number, number>());
  let globalMinY = Infinity;
  let globalMaxY = -Infinity;

  const markOccupied = (entry: ShapeBlock) => {
    const coord = toColumnCoordKey(entry.x, entry.z);
    let occupiedRefs = occupiedRefsByCell.get(coord);
    if (!occupiedRefs) {
      occupiedRefs = new Map<number, ShapeRef>();
      occupiedRefsByCell.set(coord, occupiedRefs);
    }
    occupiedRefs.set(entry.y, entry.ref);
  };

  for (const block of [...blocks, ...occupiedExtraBlocks]) {
    markOccupied(block);
    if (block.ref.kind !== "color" || isTransparentColor(block.ref.color)) continue;
    const rowTopY = rowTopYByColumn[block.x];
    const currentTopY = rowTopY.get(block.z);
    if (currentTopY === undefined || block.y > currentTopY) rowTopY.set(block.z, block.y);
    if (block.y < globalMinY) globalMinY = block.y;
    if (block.y > globalMaxY) globalMaxY = block.y;
  }

  if (!Number.isFinite(globalMinY) || !Number.isFinite(globalMaxY)) {
    globalMinY = 0;
    globalMaxY = 0;
  }

  const claimTransparentY = (x: number, z: number, preferredY: number): number | null => {
    const coord = toColumnCoordKey(x, z);
    let occupiedRefs = occupiedRefsByCell.get(coord);
    if (!occupiedRefs) {
      occupiedRefs = new Map<number, ShapeRef>();
      occupiedRefsByCell.set(coord, occupiedRefs);
    }
    const occupyingRef = occupiedRefs.get(preferredY);
    if (
      occupyingRef?.kind === "filler" &&
      (occupyingRef.role === FillerRole.ShadeVoidDominant || occupyingRef.role === FillerRole.ShadeVoidRecessive)
    ) {
      return null;
    }
    let y = preferredY;
    if (occupyingRef?.kind === "filler") {
      while (occupiedRefs.has(y)) --y;
    } else {
      while (occupiedRefs.has(y)) ++y;
    }
    occupiedRefs.set(y, { kind: "color", color: TRANSPARENT_COLOR });
    return y;
  };

  const randomFor = (x: number, z: number) =>
    mulberry32((((x + 1) * 73856093) ^ ((z + 1) * 19349663) ^ ((paletteSeed + 1) * 83492791)) >>> 0)();

  const transparentBlocks: ShapeBlock[] = [];
  let suppressedTransparentVsCollisionCount = 0;

  for (let x = 0; x < MAP_SIZE; ++x) {
    const rowTopY = rowTopYByColumn[x];
    const nextSeenY = new Array<number | undefined>(MAP_SIZE);
    const nextSeenZ = new Array<number | undefined>(MAP_SIZE);
    let southSeenY: number | undefined;
    let southSeenZ: number | undefined;
    for (let z = MAP_SIZE - 1; z >= 0; --z) {
      const topY = rowTopY.get(z);
      if (topY !== undefined) southSeenY = topY;
      if (topY !== undefined) southSeenZ = z;
      nextSeenY[z] = southSeenY;
      nextSeenZ[z] = southSeenZ;
    }

    let northSeenY: number | undefined;
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      const topY = rowTopY.get(z);
      if (topY !== undefined) northSeenY = topY;
      if (!isTransparentColor(color)) continue;

      let preferredY: number;
      switch (buildMode) {
        case BuildMode.StaircaseValley:
          preferredY = 0;
          break;
        case BuildMode.StaircaseGroup:
          preferredY = Math.max(0, northSeenY ?? nextSeenY[z] ?? 0);
          break;
        case BuildMode.StaircaseParty:
          preferredY = globalMinY + Math.floor(randomFor(x, z) * (globalMaxY - globalMinY + 1));
          break;
        default:
          preferredY = northSeenY ?? nextSeenY[z] ?? 0;
          break;
      }

      const y = claimTransparentY(x, z, preferredY);
      if (y === null) {
        ++suppressedTransparentVsCollisionCount;
        continue;
      }
      transparentBlocks.push({
        x,
        y,
        z,
        ref: { kind: "color", color },
      });
    }
  }

  return { blocks: transparentBlocks, suppressedTransparentVsCollisionCount };
}

// Callers:
// - src/lib/shapeGeneration.ts
export function buildInclineBlocks(
  colorGrid: ColorGrid,
  buildMode: BuildMode.InclineUp | BuildMode.InclineDown,
  includeTransparentBlocks: boolean,
): ShapeBlock[] {
  const blocks: ShapeBlock[] = [];
  const yDelta = buildMode === BuildMode.InclineUp ? -1 : 1;
  const expectedShade = buildMode === BuildMode.InclineUp ? Shade.Dark : Shade.Light;
  const startY = buildMode === BuildMode.InclineUp ? 63 : 64;

  for (let x = 0; x < MAP_SIZE; ++x) {
    let y = startY;
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) {
        if (includeTransparentBlocks) {
          blocks.push({ x, y, z, ref: { kind: "color", color } });
          y += yDelta;
        }
        continue;
      }

      if (isWaterColor(color)) {
        throw new Error(`Unexpected water pixel in ${buildMode}`);
      }
      if (color.shade !== expectedShade) {
        throw new Error(`Unexpected non-${expectedShade} incline shade in ${buildMode}: ${color.shade}`);
      }

      blocks.push({ x, y, z, ref: { kind: "color", color } });
      y += yDelta;
    }
  }

  return blocks;
}

// Callers:
// - src/lib/shapeGeneration.ts
export function addStaircaseWaterConvenienceFillers(
  blocks: ShapeBlock[],
  colorGrid: ColorGrid,
  cache: ColumnPixelCache,
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
      const anchorZ = runEndZ + 1;
      const anchorInfo = pixelInfo.get(anchorZ);
      if (anchorZ >= MAP_SIZE || !anchorInfo || !rowPresent[anchorZ + 1]) {
        continue;
      }

      const anchorIsWater = anchorInfo.isWater;
      if (!anchorIsWater && anchorInfo.shade !== Shade.Dark) continue;

      const anchorY = anchorIsWater ? rowMinY[anchorZ + 1] : rowMaxY[anchorZ + 1];
      let tailEndZ = anchorZ;
      while (tailEndZ + 1 < MAP_SIZE && primaryPresent[tailEndZ + 1]) ++tailEndZ;

      const liftWaterDelta = anchorY - waterBottom;
      const canLiftWater =
        liftWaterDelta > 0 &&
        waterTop + liftWaterDelta <= overallMaxY;

      const lowerTailDelta = waterBottom - anchorY;
      const canLowerTail = lowerTailDelta < 0;

      let targetSupportY: number | undefined;
      if (canLowerTail) {
        shiftRows(anchorZ, tailEndZ, lowerTailDelta);
        targetSupportY = waterBottom;
      } else if (canLiftWater) {
        shiftRows(waterZPos, waterZPos, liftWaterDelta);
        targetSupportY = anchorY;
      } else {
        continue;
      }

      for (let z = waterZPos + 1; z < anchorZ; ++z) {
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

// Callers:
// - src/lib/shapeGeneration.ts
export function buildBelowPlatformWaterBlocks(
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

// Callers:
// - src/lib/shapeGeneration.ts
export function applyStaircaseVariantGroupPostProcess<T extends PositionedEntry>(
  blocks: T[],
  colorGrid: ColorGrid,
  cache: ColumnPixelCache,
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
  interface GroupSegment {
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
  const primaryZByColumn = new Map<number, number[]>();
  const segments: GroupSegment[] = [];

  for (let x = 0; x < MAP_SIZE; ++x) {
    const primaryInfo = pixelByColumn.get(x);
    const zRows = columnRows.get(x);
    if (!primaryInfo || !zRows) continue;

    const allPrimaryZ = [...primaryInfo.keys()].sort((a, b) => a - b);
    const topY = new Map<number, number>();
    for (const z of allPrimaryZ) {
      const row = zRows.get(z);
      if (!row) continue;
      topY.set(z, row.maxY);
    }

    const primaryZ = allPrimaryZ.filter(z => topY.has(z));
    if (primaryZ.length > 0) primaryZByColumn.set(x, primaryZ);
    for (const z of primaryZ) {
      primaryTopY.set(rowKey(x, z), topY.get(z)!);
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
      const segment: GroupSegment = {
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

  const isGroupShadeSafe = (
    movingPrimaryRows: ReadonlySet<ColumnCoordKey>,
    affectedColumns: ReadonlySet<number>,
    delta: number,
  ): boolean => {
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

      const movingPrimaryRows = new Set<ColumnCoordKey>();
      const affectedColumns = new Set<number>();
      for (const segmentId of groupIds) {
        const segment = segments[segmentId];
        affectedColumns.add(segment.x);
        for (const z of segment.primaryZ) movingPrimaryRows.add(rowKey(segment.x, z));
      }

      let chosenDelta = 0;
      for (const delta of collectCandidateDeltas(groupIds, maxLift)) {
        if (!isGroupShadeSafe(movingPrimaryRows, affectedColumns, delta)) continue;
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

// Callers:
// - src/lib/shapeGeneration.ts
export function getStaircaseClassicColumnOffsets<T extends PositionedEntry>(blocks: T[]): number[] {
  const offsets = new Array<number>(MAP_SIZE).fill(0);
  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    let minY = Infinity;
    for (const block of colBlocks) if (block.y < minY) minY = block.y;
    offsets[x] = -minY;
  }
  return offsets;
}

// Callers:
// - src/lib/shapeGeneration.ts
export function getStaircaseSouthlineColumnOffsets(blocks: ShapeBlock[], topAlignedWater: boolean): number[] {
  const offsets = new Array<number>(MAP_SIZE).fill(0);
  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    const { rowBlocks, rowMinY, rowMaxY, zValues } = buildColumnBlockRows(colBlocks);
    let maxZ = -Infinity;
    for (const z of zValues) if (z > maxZ) maxZ = z;
    const southRow = rowBlocks[maxZ + 1];
    if (!southRow) continue;
    const southHasWater = southRow.some(isWaterBlock);
    const southY = southHasWater && !topAlignedWater ? rowMinY[maxZ + 1] : rowMaxY[maxZ + 1];
    offsets[x] = -southY;
  }
  return offsets;
}

// Callers:
// - src/lib/shapeGeneration.ts
export function applyColumnYOffsets<T extends PositionedEntry>(entries: T[], offsets: readonly number[]) {
  for (const entry of entries) {
    const delta = offsets[entry.x];
    if (delta !== 0) entry.y += delta;
  }
}

// Callers:
// - src/lib/shapeGeneration.ts
export function applyStaircaseVariantValley<T extends PositionedEntry>(
  blocks: T[],
  colorGrid: ColorGrid,
  cache: ColumnPixelCache,
  excludeWater = false,
) {
  const minimumWaterBottom = 0;
  const columns = groupBlocksByColumn(blocks);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const colBlocks = columns[x];
    if (colBlocks.length === 0) continue;
    const pixelShade = getCachedColumnPixelInfo(colorGrid, cache, x, excludeWater);
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

// Callers:
// - src/lib/shapeGeneration.ts
export function applyStaircaseVariantParty<T extends PositionedEntry>(
  blocks: T[],
  colorGrid: ColorGrid,
  paletteSeed = 0,
  cache: ColumnPixelCache,
  excludeWater = false,
) {
  const seedBase = (42 ^ paletteSeed) >>> 0;

  // Reuse per-column heights; undefined distinguishes missing rows from height zero.
  const origMaxY = Array<number | undefined>(MAP_SIZE);
  const depthByZ = Array<number | undefined>(MAP_SIZE);
  const prefTopY = Array<number | undefined>(MAP_SIZE);
  const minFeas = Array<number | undefined>(MAP_SIZE);
  const maxFeas = Array<number | undefined>(MAP_SIZE);
  const assignedTopY = Array<number | undefined>(MAP_SIZE);
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

    const pixelInfo = getCachedColumnPixelInfo(colorGrid, cache, x, excludeWater);

    const zToBlocks = new Map<number, T[]>();
    for (const block of colBlocks) {
      if (!zToBlocks.has(block.z)) zToBlocks.set(block.z, []);
      zToBlocks.get(block.z)!.push(block);
    }

    const primaryZs = [...pixelInfo.keys()].sort((a, b) => a - b);
    if (primaryZs.length === 0) continue;

    origMaxY.fill(undefined);
    depthByZ.fill(undefined);
    for (const z of primaryZs) {
      const rowBlocks = zToBlocks.get(z);
      if (!rowBlocks) continue;
      const maxY = Math.max(...rowBlocks.map(block => block.y));
      const minY = Math.min(...rowBlocks.map(block => block.y));
      origMaxY[z] = maxY;
      depthByZ[z] = maxY - minY + 1;
    }

    const lowerBound = (z: number) => (pixelInfo.get(z)?.isWater ? (depthByZ[z] ?? 1) - 1 : 0);
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
    const isColumnValid = (topY: readonly (number | undefined)[]): boolean => {
      for (const z of primaryZs) {
        const y = topY[z];
        if (y === undefined || y < lowerBound(z) || y > upperBound(z)) return false;
      }
      for (let northZ = 0; northZ < MAP_SIZE - 1; ++northZ) {
        const rel = edgeRel(northZ);
        if (rel === null) continue;
        const southZ = northZ + 1;
        const yN = topY[northZ];
        const yS = topY[southZ];
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
    prefTopY.fill(undefined);

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
        for (const z of groups[i]) prefTopY[z] = values[i];
      }
      endpointHints.push({ zList: [...lowGroup], type: "lower" });
      endpointHints.push({ zList: [...highGroup], type: "upper" });
    };

    for (const segment of segments) applySegmentPreference(segment);
    for (const z of primaryZs) if (prefTopY[z] === undefined) prefTopY[z] = randomInt(lowerBound(z), upperBound(z));

    minFeas.fill(undefined);
    maxFeas.fill(undefined);
    for (const z of primaryZs) {
      minFeas[z] = lowerBound(z);
      maxFeas[z] = upperBound(z);
    }

    for (let northZ = MAP_SIZE - 2; northZ >= 0; --northZ) {
      if (!hasPrimary(northZ)) continue;
      let lo = minFeas[northZ] ?? lowerBound(northZ);
      let hi = maxFeas[northZ] ?? upperBound(northZ);
      const southZ = northZ + 1;
      const rel = edgeRel(northZ);
      if (rel !== null && hasPrimary(southZ)) {
        const sLo = minFeas[southZ] ?? lowerBound(southZ);
        const sHi = maxFeas[southZ] ?? upperBound(southZ);
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
        const p = prefTopY[northZ] ?? lowerBound(northZ);
        const clamped = Math.min(Math.max(p, lowerBound(northZ)), upperBound(northZ));
        lo = clamped;
        hi = clamped;
      }
      minFeas[northZ] = lo;
      maxFeas[northZ] = hi;
    }

    assignedTopY.fill(undefined);
    for (let z = 0; z < MAP_SIZE; ++z) {
      if (!hasPrimary(z)) continue;
      let lo = minFeas[z] ?? lowerBound(z);
      let hi = maxFeas[z] ?? upperBound(z);
      const northZ = z - 1;
      if (northZ >= 0 && hasPrimary(northZ) && assignedTopY[northZ] !== undefined) {
        const rel = edgeRel(northZ);
        if (rel !== null) {
          const northY = assignedTopY[northZ]!;
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
        y = Math.min(Math.max(prefTopY[z] ?? lo, lowerBound(z)), upperBound(z));
      } else {
        const pref = prefTopY[z] ?? randomInt(lo, hi);
        y = pref < lo || pref > hi ? Math.min(Math.max(pref, lo), hi) : pref;
      }
      assignedTopY[z] = y;
    }

    const uniqueEndpoints = new Map<string, { zList: number[]; type: "lower" | "upper" }>();
    for (const endpoint of endpointHints) {
      const key = `${endpoint.type}:${[...endpoint.zList].sort((a, b) => a - b).join(",")}`;
      uniqueEndpoints.set(key, endpoint);
    }

    for (const endpoint of uniqueEndpoints.values()) {
      const zList = endpoint.zList.filter(z => assignedTopY[z] !== undefined);
      if (zList.length === 0) continue;
      const snapshot = new Map<number, number>();
      for (const z of zList) snapshot.set(z, assignedTopY[z]!);
      const minY = Math.max(...zList.map(z => lowerBound(z)));
      const maxY = Math.min(...zList.map(z => upperBound(z)));

      const direction = endpoint.type === "upper" ? -1 : 1;
      let limit = Math.floor(direction < 0
        ? Math.min(...snapshot.values()) - minY
        : maxY - Math.max(...snapshot.values()));
      let maxMove = 0;
      if (limit >= 1) {
        for (const z of zList) assignedTopY[z] = snapshot.get(z)! + direction;
        // Rigid translation gives linear bounds: after d=1 passes, valid distances form a prefix.
        if (isColumnValid(assignedTopY)) {
          maxMove = 1;
          while (maxMove < limit) {
            const distance = Math.ceil((maxMove + limit) / 2);
            for (const z of zList) assignedTopY[z] = snapshot.get(z)! + direction * distance;
            if (isColumnValid(assignedTopY)) maxMove = distance;
            else limit = distance - 1;
          }
        }
      }
      const chosen = randomInt(0, maxMove);
      for (const z of zList) assignedTopY[z] = snapshot.get(z)! + direction * chosen;
    }

    if (!isColumnValid(assignedTopY)) {
      assignedTopY.fill(undefined);
      for (let z = 0; z < MAP_SIZE; ++z) {
        if (!hasPrimary(z)) continue;
        let lo = minFeas[z] ?? lowerBound(z);
        let hi = maxFeas[z] ?? upperBound(z);
        const northZ = z - 1;
        if (northZ >= 0 && hasPrimary(northZ) && assignedTopY[northZ] !== undefined) {
          const rel = edgeRel(northZ);
          if (rel !== null) {
            const northY = assignedTopY[northZ]!;
            if (rel === 0) lo = hi = northY;
            else if (rel === 1) lo = Math.max(lo, northY + 1);
            else hi = Math.min(hi, northY - 1);
          }
        }
        if (lo > hi) assignedTopY[z] = Math.min(Math.max(prefTopY[z] ?? lo, lowerBound(z)), upperBound(z));
        else assignedTopY[z] = randomInt(lo, hi);
      }
    }

    if (!isColumnValid(assignedTopY)) {
      assignedTopY.fill(undefined);
      for (const z of primaryZs) {
        const y = origMaxY[z];
        if (y !== undefined) assignedTopY[z] = y;
      }
    }

    const deltaApplied = new Map<number, number>();
    for (const z of primaryZs) {
      const origTop = origMaxY[z];
      const newTop = assignedTopY[z];
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
