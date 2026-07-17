/**
 * Public API:
 * - WaterDrops
 * - ColorFrequencyMap
 * - ColorGridStats
 * - FlatModeBehavior
 * - PixelParity
 * - getPixelParity()
 * - hasStepMixOpportunity()
 * - computeColorGridStats()
 * - collectShadeCountsByColorRefKey()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/colorGridParsing.ts
 * - src/lib/colorGridParsingCore.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/suppressLoadMarkers.ts
 * - src/lib/tileGeometry.worker.ts
 * - src/lib/tileGeometryWorkerTypes.ts
 * - src/lib/tileParsingWorkerTypes.ts
 */
import { TRANSPARENCY_BASE_INDEX } from "@/data/mapColors";
import { getColorRefKey, type ColorRefKey } from "@/lib/colorRefs";
import { MAP_SIZE, isTransparentColor, isWaterColor } from "@/utils/color";
import { type ColorGrid, Shade, type ColorRef } from "@/types/color";

// Callers:
// - src/lib/colorGridParsingCore.ts
// - src/lib/suppressLoadMarkers.ts
// - src/lib/shapeGeneration.ts
export enum PixelParity {
  Recessive = "recessive",
  Dominant = "dominant",
}

// Callers:
// - src/Index.tsx
// - src/lib/shapeGeneration.ts
// - src/lib/tileGeometryWorkerTypes.ts
export type WaterDrops = readonly [dark: number, flat: number, light: number];

// Callers:
// - src/Index.tsx
// - src/lib/colorGridParsingCore.ts
export type ColorFrequencyMap = Map<ColorRef, Map<Shade, number>>;

// Callers:
// - src/Index.tsx
// - src/lib/colorGridParsing.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/tileParsingWorkerTypes.ts
export interface ColorGridStats {
  allSameShade?: Shade;
  colorFrequencyMap: ColorFrequencyMap;
  flatModeBehavior: FlatModeBehavior;
  voidShadowStats: {
    dominant: number;
    recessive: number;
    flatEligible: number;
    lightEligible: number;
  };
}

// Callers:
// - src/Index.tsx
// - src/lib/colorGridParsingCore.ts
// - src/lib/tileGeometry.worker.ts
// - src/lib/tileGeometryWorkerTypes.ts
export enum FlatModeBehavior {
  None = "none",
  Plain = "plain",
  ToggleableBuildAtWorldMinY = "toggleable_build_at_world_min_y",
}

// Callers:
// - src/lib/shapeGeneration.ts
// - src/lib/suppressLoadMarkers.ts
export function getPixelParity(x: number, z: number): PixelParity {
  return ((x + z) & 1) === 0 ? PixelParity.Recessive : PixelParity.Dominant;
}

// Callers:
// - src/Index.tsx
export function hasStepMixOpportunity(
  colorGrid: ColorGrid,
  options: { waterDrops?: WaterDrops },
): boolean {
  const belowPlatformWater = options.waterDrops !== undefined;
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 1; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      const north = colorGrid[x][z - 1];
      if (isTransparentColor(color) || isTransparentColor(north)) continue;
      if (isWaterColor(color)) {
        if (!belowPlatformWater) return true;
        continue;
      }
      if (color.shade === Shade.Flat && !isWaterColor(north)) return true;
      if (!isWaterColor(north)) continue;
      if (belowPlatformWater) {
        const northWaterDrop = options.waterDrops[north.shade as Shade.Dark | Shade.Flat | Shade.Light];
        if (northWaterDrop === undefined) throw new Error(`Unexpected water shade for drop lookup: ${north.shade}`);
        if (color.shade === Shade.Flat && northWaterDrop === 0) return true;
        continue;
      }
      if (color.shade === Shade.Flat && north.shade === Shade.Light) return true;
      if (color.shade === Shade.Dark && north.shade !== Shade.Light) return true;
    }
  }
  return false;
}

function analyzeVoidShadows(colorGrid: ColorGrid) {
  const stats = { dominant: 0, recessive: 0, flatEligible: 0, lightEligible: 0 };

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) continue;
      if (z === 0 || !isTransparentColor(colorGrid[x][z - 1])) continue;
      if (isWaterColor(color)) continue;
      if (color.shade === Shade.Light) {
        ++stats.lightEligible;
        continue;
      }
      if (color.shade === Shade.Flat) ++stats.flatEligible;
      if (getPixelParity(x, z - 1) === PixelParity.Recessive) ++stats.recessive;
      else ++stats.dominant;
    }
  }

  return stats;
}

function computeColorFrequencyMap(colorGrid: ColorGrid): ColorFrequencyMap {
  const colorFrequencyMap = new Map<ColorRef, Map<Shade, number>>();
  const baseKeys = new Map<number, ColorRef>();
  const customKeys = new Map<number, ColorRef>();

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      const keyMap = color.isCustom ? customKeys : baseKeys;
      let colorKey = keyMap.get(color.id);
      if (!colorKey) {
        colorKey = { id: color.id, isCustom: color.isCustom };
        keyMap.set(color.id, colorKey);
        colorFrequencyMap.set(colorKey, new Map<Shade, number>());
      }
      const shadeFrequencyMap = colorFrequencyMap.get(colorKey);
      if (!shadeFrequencyMap) throw new Error(`Missing shade frequency map for ${color.id}`);
      shadeFrequencyMap.set(color.shade, (shadeFrequencyMap.get(color.shade) ?? 0) + 1);
    }
  }

  return colorFrequencyMap;
}

function findAllSameShade(colorFrequencyMap: ColorFrequencyMap): Shade | undefined {
  let allSameShade: Shade | undefined;

  for (const [colorKey, shadeFrequencyMap] of colorFrequencyMap) {
    if (!colorKey.isCustom && colorKey.id === TRANSPARENCY_BASE_INDEX) continue;
    if (shadeFrequencyMap.size !== 1) return undefined;
    const shade = shadeFrequencyMap.keys().next().value;
    if (shade === undefined) continue;
    if (allSameShade === undefined) {
      allSameShade = shade;
      continue;
    }
    if (allSameShade !== shade) return undefined;
  }

  return allSameShade;
}

function analyzeFlatModeBehavior(colorGrid: ColorGrid): FlatModeBehavior {
  let hasAnyFlatSouthOfTransparency = false;
  let hasAnyLightSouthOfTransparency = false;

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) continue;
      if (isWaterColor(color)) {
        if (color.shade !== Shade.Light) return FlatModeBehavior.None;
        continue;
      }

      const northIsTransparent = z > 0 && isTransparentColor(colorGrid[x][z - 1]);
      if (!northIsTransparent) {
        if (color.shade !== Shade.Flat) return FlatModeBehavior.None;
        continue;
      }

      switch (color.shade) {
        case Shade.Flat:
          hasAnyFlatSouthOfTransparency = true;
          break;
        case Shade.Light:
          hasAnyLightSouthOfTransparency = true;
          break;
        default:
          return FlatModeBehavior.None;
      }

      if (hasAnyFlatSouthOfTransparency && hasAnyLightSouthOfTransparency) {
        return FlatModeBehavior.None;
      }
    }
  }

  if (hasAnyFlatSouthOfTransparency) return FlatModeBehavior.ToggleableBuildAtWorldMinY;
  return FlatModeBehavior.Plain;
}

// Callers:
// - src/Index.tsx
export function computeColorGridStats(colorGrid: ColorGrid): ColorGridStats {
  const colorFrequencyMap = computeColorFrequencyMap(colorGrid);
  return {
    allSameShade: findAllSameShade(colorFrequencyMap),
    colorFrequencyMap,
    flatModeBehavior: analyzeFlatModeBehavior(colorGrid),
    voidShadowStats: analyzeVoidShadows(colorGrid),
  };
}

// Callers:
// - src/Index.tsx
export function collectShadeCountsByColorRefKey(
  tileImageStats: readonly ColorGridStats[],
): Map<ColorRefKey, Map<Shade, number>> {
  const countsByColorKey = new Map<ColorRefKey, Map<Shade, number>>();
  for (const imageStats of tileImageStats) {
    for (const [colorKey, shadeFrequencyMap] of imageStats.colorFrequencyMap) {
      const stableKey = getColorRefKey(colorKey);
      let shadeCounts = countsByColorKey.get(stableKey);
      if (!shadeCounts) {
        shadeCounts = new Map<Shade, number>();
        countsByColorKey.set(stableKey, shadeCounts);
      }
      for (const [shade, count] of shadeFrequencyMap) {
        shadeCounts.set(shade, (shadeCounts.get(shade) ?? 0) + count);
      }
    }
  }
  return countsByColorKey;
}
