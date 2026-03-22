/**
 * Public API:
 * - WaterDrops
 * - ColorFrequencyMap
 * - ColorGridStats
 * - PixelParity
 * - getPixelParity()
 * - hasStepMixOpportunity()
 * - computeColorGridStats()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/shapeGeneration.ts
 * - tests/run.mts
 */
import { TRANSPARENCY_BASE_INDEX } from "@/data/mapColors";
import { MAP_SIZE, isTransparentColor, isWaterColor } from "@/utils/color";
import { type ColorGrid, Shade, type ColorRef } from "@/types/color";

// Callers:
// - src/lib/shapeGeneration.ts
export enum PixelParity {
  Recessive = "recessive",
  Dominant = "dominant",
}

// Callers:
// - src/Index.tsx
// - src/lib/shapeGeneration.ts
// - tests/run.mts
export type WaterDrops = readonly [dark: number, flat: number, light: number];

// Callers:
// - src/Index.tsx
// - tests/run.mts
export type ColorFrequencyMap = Map<ColorRef, Map<Shade, number>>;

// Callers:
// - src/Index.tsx
// - tests/run.mts
export interface ColorGridStats {
  allSameShade?: Shade;
  colorFrequencyMap: ColorFrequencyMap;
  voidShadowStats: {
    dominant: number;
    recessive: number;
  };
}

// Callers:
// - src/lib/shapeGeneration.ts
export function getPixelParity(x: number, z: number): PixelParity {
  return ((x + z) & 1) === 0 ? PixelParity.Recessive : PixelParity.Dominant;
}

// Callers:
// - src/Index.tsx
// - tests/run.mts
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
  const stats = { dominant: 0, recessive: 0 };

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) continue;
      if (z === 0 || !isTransparentColor(colorGrid[x][z - 1])) continue;
      if (isWaterColor(color) || color.shade === Shade.Light) continue;
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

// Callers:
// - src/Index.tsx
// - tests/run.mts
export function computeColorGridStats(colorGrid: ColorGrid): ColorGridStats {
  const colorFrequencyMap = computeColorFrequencyMap(colorGrid);
  return {
    allSameShade: findAllSameShade(colorFrequencyMap),
    colorFrequencyMap,
    voidShadowStats: analyzeVoidShadows(colorGrid),
  };
}
