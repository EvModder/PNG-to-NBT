/**
 * Block layouts for suppress builds: split rows and checkers, 2-layer builds and step phases.
 *
 * Public API:
 * - TwoLayerSuppressBuildMode
 * - getSuppressStepAxis()
 * - buildSuppressSplitRowBlockSets()
 * - buildSuppressSplitCheckerBlockSets()
 * - buildSuppressDualLayerBlocks()
 * - buildBelowPlatformWaterPreviewBlocks()
 * - buildStepPhaseBlocks()
 *
 * Callers:
 * - src/lib/shapeGeneration.ts
 */
import { BuildMode, FillerRole, SuppressStepDirection, type MixedStepPalette } from "@/types/conversion";
import { Shade, type ColorGrid, type ShadedColorRef } from "@/types/color";
import type { ShapeCoordKey } from "@/types/shape";
import { MAP_SIZE, TRANSPARENT_COLOR, isTransparentColor, isWaterColor } from "@/utils/color";
import { PixelParity, getPixelParity, type WaterDrops } from "./colorGridAnalysis";
import { parseShapeCoordKey, toShapeCoordKey } from "./shapeModel";
import type { SuppressStepPhase } from "./suppressSteps";
import { getMixedStepReuse, getMixedStepColor } from "./mixedStepHeights";
import {
  getWaterDepth, getWaterDrop, makeFillerBlock, parseColumnCoordKey, toColumnCoordKey,
  type ColumnCoordKey, type ShapeBlock, type ShapeRef,
} from "./shapeBlocks";

type RecessivePlacementOverride = {
  colorY: number;
  fillerY?: number;
};
type ShapeBlockSet = {
  blocks: ShapeBlock[];
  loweredWaterBlocks: ShapeBlock[];
};
// Callers:
// - src/lib/shapeGeneration.ts
export type TwoLayerSuppressBuildMode = BuildMode.Suppress2LayerLateFillers | BuildMode.Suppress2LayerLatePairs;

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

// Callers:
// - src/lib/shapeGeneration.ts
export function getSuppressStepAxis(direction: SuppressStepDirection): "x" | "z" {
  return (
    direction === SuppressStepDirection.NorthToSouth ||
    direction === SuppressStepDirection.SouthToNorth
  ) ? "z" : "x";
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

// Callers:
// - src/lib/shapeGeneration.ts
export function buildSuppressSplitRowBlockSets(
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

// Callers:
// - src/lib/shapeGeneration.ts
export function buildSuppressSplitCheckerBlockSets(
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

// Callers:
// - src/lib/shapeGeneration.ts
export function buildSuppressDualLayerBlocks(
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

// Callers:
// - src/lib/shapeGeneration.ts
export function buildBelowPlatformWaterPreviewBlocks(
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
// Callers:
// - src/lib/shapeGeneration.ts
export function buildStepPhaseBlocks(
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
