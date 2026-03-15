/**
 * Public API:
 * - PixelParity
 * - UniformNonFlatDirection
 * - getPixelParity()
 * - computeColorGridStats()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/shapeGeneration.ts
 */
import { MAP_SIZE, type ColorGrid, isTransparentColor, isWaterColor } from "./colorGridTypes";

// Callers:
// - src/lib/shapeGeneration.ts
export enum PixelParity {
  Recessive = "recessive",
  Dominant = "dominant",
}

// Callers:
// - src/lib/shapeGeneration.ts
export enum UniformNonFlatDirection {
  AllLight = "all_light",
  AllDark = "all_dark",
  Mixed = "mixed",
}

interface ColorGridStats {
  hasNonFlatShades: boolean;
  hasSuppressPattern: boolean;
  hasStepMixOpportunity: boolean;
  hasTransparency: boolean;
  hasWater: boolean;
  hasNonLightWater: boolean;
  uniformNonFlatDirection: UniformNonFlatDirection;
  usedBaseColors: Set<number>;
  voidShadowStats: {
    dominant: number;
    recessive: number;
  };
  imageInfo: { uniqueShadeCount: number; uniqueBaseColorCount: number };
  usedShadesByBase: Map<number, Set<number>>;
}

// Callers:
// - src/lib/shapeGeneration.ts
export function getPixelParity(x: number, z: number): PixelParity {
  return ((x + z) & 1) === 0 ? PixelParity.Recessive : PixelParity.Dominant;
}

function imageHasNonFlatShades(colorGrid: ColorGrid): boolean {
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (!isTransparentColor(color) && color.shade !== 1) return true;
    }
  }
  return false;
}

function scanSuppressedPixels(colorGrid: ColorGrid): boolean {
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      if (!isTransparentColor(colorGrid[x][z])) continue;
      for (let southZ = z + 1; southZ < MAP_SIZE; ++southZ) {
        const south = colorGrid[x][southZ];
        if (isTransparentColor(south)) continue;
        if (south.shade === 2) break;
        if (south.shade === 0 || south.shade === 3) return true;
        break;
      }
    }
  }
  return false;
}

function scanStepMixOpportunities(colorGrid: ColorGrid): boolean {
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 1; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color) || isWaterColor(color) || color.shade !== 1) continue;
      const north = colorGrid[x][z-1];
      if (isTransparentColor(north) || isWaterColor(north)) continue;
      return true;
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
      if (isWaterColor(color) || color.shade === 2) continue;
      if (getPixelParity(x, z - 1) === PixelParity.Recessive) ++stats.recessive;
      else ++stats.dominant;
    }
  }

  return stats;
}

function computeImageInfo(colorGrid: ColorGrid) {
  const usedBaseColors = new Set<number>();
  const usedShades = new Set<string>();
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) continue;
      if (color.isCustom) usedShades.add(`custom:${color.id}:${color.shade}`);
      else {
        usedBaseColors.add(color.id);
        usedShades.add(`${color.id}:${color.shade}`);
      }
    }
  }
  return { uniqueShadeCount: usedShades.size, uniqueBaseColorCount: usedBaseColors.size };
}

function detectUniformNonFlatDirection(colorGrid: ColorGrid): UniformNonFlatDirection {
  let sawNonTransparent = false;
  let allLight = true;
  let allDark = true;

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color)) continue;
      sawNonTransparent = true;
      if (color.shade !== 2) allLight = false;
      if (color.shade !== 0) allDark = false;
    }
  }

  if (!sawNonTransparent) return UniformNonFlatDirection.Mixed;
  if (allLight) return UniformNonFlatDirection.AllLight;
  if (allDark) return UniformNonFlatDirection.AllDark;
  return UniformNonFlatDirection.Mixed;
}

function computeUsedShadesByBase(colorGrid: ColorGrid): Map<number, Set<number>> {
  const used = new Map<number, Set<number>>();
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isTransparentColor(color) || color.isCustom) continue;
      let shades = used.get(color.id);
      if (!shades) {
        shades = new Set<number>();
        used.set(color.id, shades);
      }
      shades.add(color.shade);
    }
  }
  return used;
}

function computeUsedBaseColors(colorGrid: ColorGrid): Set<number> {
  const used = new Set<number>();
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (color.isCustom) continue;
      if (isTransparentColor(color)) {
        used.add(0);
        continue;
      }
      used.add(color.id);
    }
  }
  return used;
}

function colorGridHasTransparency(colorGrid: ColorGrid): boolean {
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      if (isTransparentColor(colorGrid[x][z])) return true;
    }
  }
  return false;
}

function colorGridHasWater(colorGrid: ColorGrid): boolean {
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      if (isWaterColor(colorGrid[x][z])) return true;
    }
  }
  return false;
}

function colorGridHasNonLightWater(colorGrid: ColorGrid): boolean {
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (isWaterColor(color) && color.shade !== 2) return true;
    }
  }
  return false;
}

// Callers:
// - src/Index.tsx
export function computeColorGridStats(colorGrid: ColorGrid): ColorGridStats {
  const voidShadowStats = analyzeVoidShadows(colorGrid);
  return {
    hasNonFlatShades: imageHasNonFlatShades(colorGrid),
    hasSuppressPattern: scanSuppressedPixels(colorGrid),
    hasStepMixOpportunity: scanStepMixOpportunities(colorGrid),
    hasTransparency: colorGridHasTransparency(colorGrid),
    hasWater: colorGridHasWater(colorGrid),
    hasNonLightWater: colorGridHasNonLightWater(colorGrid),
    uniformNonFlatDirection: detectUniformNonFlatDirection(colorGrid),
    usedBaseColors: computeUsedBaseColors(colorGrid),
    voidShadowStats,
    imageInfo: computeImageInfo(colorGrid),
    usedShadesByBase: computeUsedShadesByBase(colorGrid),
  };
}
