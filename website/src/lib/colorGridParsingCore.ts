/**
 * Public API:
 * - ColorGridRegionScanResult
 * - PaletteConversionSummary
 * - createEmptyColorGrid()
 * - getBaseColorLookup()
 * - buildCustomShadeLookup()
 * - scanImageRegionToColorGrid()
 * - cloneImageData()
 * - convertUnsupportedToNearestPalette()
 * - convertUnsupportedRegionToNearestPalette()
 * - buildConversionNotices()
 *
 * Callers:
 * - src/lib/colorGridParsing.ts
 * - src/lib/tileParsing.worker.ts
 * - src/lib/tileParsingWorkerClient.ts
 */
import { BASE_COLORS, TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX } from "@/data/mapColors";
import { getShadedRgb, packRgb, unpackRgb, MAP_SIZE, TRANSPARENT_COLOR } from "@/utils/color";
import { messages, type PaletteNotice } from "@/lib/messages";
import { type ColorGrid, Shade, type ColorRgb, type ShadedColorRef } from "@/types/color";
import { FlatModeBehavior, PixelParity, type ColorFrequencyMap, type ColorGridStats } from "@/lib/colorGridAnalysis";
import { getColorGridCacheKey } from "@/utils/colorGridKey";
import { findMatchingBaseColorIndex } from "@/utils/customColors";

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export type ColorGridRegionScanResult = {
  colorGrid: ColorGrid;
  unsupportedColors: number[];
  imageStats: ColorGridStats;
  cacheKey: string;
};

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export type PaletteConversionSummary = {
  convertedCount: number;
  totalInputColorCount: number;
  fewerOutputColorCount: number;
};

let baseColorLookup: Map<number, ShadedColorRef> | null = null;
let nearestBasePaletteColors: { r: number; g: number; b: number }[] | null = null;

function addShadedLookupEntries(
  lookup: Map<number, ShadedColorRef>,
  color: Pick<ColorRgb, "r" | "g" | "b">,
  buildRef: (shade: Shade.Dark | Shade.Flat | Shade.Light) => ShadedColorRef,
): void {
  for (const shade of [Shade.Dark, Shade.Flat, Shade.Light] as const) {
    const key = packRgb(...getShadedRgb(color, shade));
    if (!lookup.has(key)) lookup.set(key, buildRef(shade));
  }
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export function getBaseColorLookup(): Map<number, ShadedColorRef> {
  if (baseColorLookup) return baseColorLookup;
  baseColorLookup = new Map();
  for (let i = 1; i < BASE_COLORS.length; ++i) {
    addShadedLookupEntries(baseColorLookup, BASE_COLORS[i], shade => ({ isCustom: false, id: i, shade }));
  }
  return baseColorLookup;
}

function getNearestBasePaletteColors(baseLookup: Map<number, ShadedColorRef>): { r: number; g: number; b: number }[] {
  if (nearestBasePaletteColors) return nearestBasePaletteColors;
  nearestBasePaletteColors = [...baseLookup.keys()].map(key => {
    const [r, g, b] = unpackRgb(key);
    return { r, g, b };
  });
  return nearestBasePaletteColors;
}

function getNearestPaletteColors(
  baseLookup: Map<number, ShadedColorRef>,
  customLookup: Map<number, ShadedColorRef>,
): { r: number; g: number; b: number }[] {
  if (customLookup.size === 0) return getNearestBasePaletteColors(baseLookup);

  const availableKeys = new Set<number>(baseLookup.keys());
  for (const key of customLookup.keys()) availableKeys.add(key);
  return [...availableKeys].map(key => {
    const [r, g, b] = unpackRgb(key);
    return { r, g, b };
  });
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export function createEmptyColorGrid(): ColorGrid {
  return Array.from({ length: MAP_SIZE }, () => Array<ShadedColorRef>(MAP_SIZE).fill(TRANSPARENT_COLOR));
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export function buildCustomShadeLookup(customColors: ColorRgb[]): Map<number, ShadedColorRef> {
  const lookup = new Map<number, ShadedColorRef>();
  for (const [customIndex, color] of customColors.entries()) {
    if (findMatchingBaseColorIndex(color) !== null) continue;
    addShadedLookupEntries(lookup, color, shade => ({ isCustom: true, id: customIndex, shade }));
  }
  return lookup;
}

function addShadeCount(
  countsById: Map<number, [dark: number, flat: number, light: number, darkest: number]>,
  id: number,
  shade: Shade,
): void {
  let counts = countsById.get(id);
  if (!counts) {
    counts = [0, 0, 0, 0];
    countsById.set(id, counts);
  }
  ++counts[shade];
}

function toColorFrequencyMap(
  transparentCount: number,
  baseShadeCounts: ReadonlyMap<number, readonly [number, number, number, number]>,
  customShadeCounts: ReadonlyMap<number, readonly [number, number, number, number]>,
): ColorFrequencyMap {
  const colorFrequencyMap = new Map();

  if (transparentCount > 0) {
    colorFrequencyMap.set({ id: TRANSPARENCY_BASE_INDEX, isCustom: false }, new Map([[Shade.Dark, transparentCount]]));
  }

  for (const [id, counts] of baseShadeCounts) {
    const shadeFrequencyMap = new Map<Shade, number>();
    if (counts[Shade.Dark] > 0) shadeFrequencyMap.set(Shade.Dark, counts[Shade.Dark]);
    if (counts[Shade.Flat] > 0) shadeFrequencyMap.set(Shade.Flat, counts[Shade.Flat]);
    if (counts[Shade.Light] > 0) shadeFrequencyMap.set(Shade.Light, counts[Shade.Light]);
    colorFrequencyMap.set({ id, isCustom: false }, shadeFrequencyMap);
  }

  for (const [id, counts] of customShadeCounts) {
    const shadeFrequencyMap = new Map<Shade, number>();
    if (counts[Shade.Dark] > 0) shadeFrequencyMap.set(Shade.Dark, counts[Shade.Dark]);
    if (counts[Shade.Flat] > 0) shadeFrequencyMap.set(Shade.Flat, counts[Shade.Flat]);
    if (counts[Shade.Light] > 0) shadeFrequencyMap.set(Shade.Light, counts[Shade.Light]);
    colorFrequencyMap.set({ id, isCustom: true }, shadeFrequencyMap);
  }

  return colorFrequencyMap;
}

function finalizeFlatModeBehavior(
  invalid: boolean,
  hasAnyFlatSouthOfTransparency: boolean,
  hasAnyLightSouthOfTransparency: boolean,
): FlatModeBehavior {
  if (invalid || (hasAnyFlatSouthOfTransparency && hasAnyLightSouthOfTransparency)) {
    return FlatModeBehavior.None;
  }
  if (hasAnyFlatSouthOfTransparency) return FlatModeBehavior.ToggleableBuildAtWorldMinY;
  return FlatModeBehavior.Plain;
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export function scanImageRegionToColorGrid(
  imageData: ImageData,
  startX: number,
  startZ: number,
  baseLookup: Map<number, ShadedColorRef>,
  customLookup: Map<number, ShadedColorRef>,
): ColorGridRegionScanResult {
  const colorGrid = createEmptyColorGrid();
  const unsupported = new Set<number>();
  const baseShadeCounts = new Map<number, [number, number, number, number]>();
  const customShadeCounts = new Map<number, [number, number, number, number]>();
  let transparentCount = MAP_SIZE * MAP_SIZE;
  let allSameShade: Shade | undefined;
  let allSameShadeValid = true;
  let flatModeInvalid = false;
  let hasAnyFlatSouthOfTransparency = false;
  let hasAnyLightSouthOfTransparency = false;
  const voidShadowStats = { dominant: 0, recessive: 0, flatEligible: 0, lightEligible: 0 };
  const width = imageData.width;

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const idx = ((startZ + z) * width + (startX + x)) * 4;
      if (imageData.data[idx + 3] === 0) {
        continue;
      }

      const key = packRgb(imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]);
      const baseMatch = baseLookup.get(key);
      if (baseMatch) {
        colorGrid[x][z] = baseMatch;
      } else {
        const customMatch = customLookup.get(key);
        if (customMatch) {
          colorGrid[x][z] = customMatch;
        } else {
          unsupported.add(key);
          continue;
        }
      }

      const color = colorGrid[x][z];
      --transparentCount;

      if (color.isCustom) addShadeCount(customShadeCounts, color.id, color.shade);
      else addShadeCount(baseShadeCounts, color.id, color.shade);

      if (allSameShade === undefined) allSameShade = color.shade;
      else if (allSameShade !== color.shade) allSameShadeValid = false;

      const northIsTransparent = z > 0 && colorGrid[x][z - 1] === TRANSPARENT_COLOR;
      if (!color.isCustom && color.id === WATER_BASE_INDEX) {
        if (color.shade !== Shade.Light) flatModeInvalid = true;
      } else if (!northIsTransparent) {
        if (color.shade !== Shade.Flat) flatModeInvalid = true;
      } else {
        let countsTowardVoidParity = true;
        switch (color.shade) {
          case Shade.Flat:
            hasAnyFlatSouthOfTransparency = true;
            ++voidShadowStats.flatEligible;
            break;
          case Shade.Light:
            hasAnyLightSouthOfTransparency = true;
            ++voidShadowStats.lightEligible;
            countsTowardVoidParity = false;
            break;
          default:
            flatModeInvalid = true;
            break;
        }
        if (countsTowardVoidParity && z > 0 && !color.isCustom && color.id !== WATER_BASE_INDEX) {
          if (PixelParity.Recessive === (((x + (z - 1)) & 1) === 0 ? PixelParity.Recessive : PixelParity.Dominant)) {
            ++voidShadowStats.recessive;
          } else {
            ++voidShadowStats.dominant;
          }
        }
      }
    }
  }

  return {
    colorGrid,
    unsupportedColors: [...unsupported],
    imageStats: {
      allSameShade: allSameShadeValid ? allSameShade : undefined,
      colorFrequencyMap: toColorFrequencyMap(transparentCount, baseShadeCounts, customShadeCounts),
      flatModeBehavior: finalizeFlatModeBehavior(
        flatModeInvalid,
        hasAnyFlatSouthOfTransparency,
        hasAnyLightSouthOfTransparency,
      ),
      voidShadowStats,
    },
    cacheKey: getColorGridCacheKey(colorGrid),
  };
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsingWorkerClient.ts
export function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

// Callers:
// - src/lib/colorGridParsing.ts
export function convertUnsupportedToNearestPalette(
  imageData: ImageData,
  baseLookup: Map<number, ShadedColorRef>,
  customLookup: Map<number, ShadedColorRef>,
): PaletteConversionSummary {
  const availableColors = getNearestPaletteColors(baseLookup, customLookup);
  const inputColors = new Set<number>();
  const outputColors = new Set<number>();
  const convertedColors = new Set<number>();
  const d = imageData.data;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = packRgb(d[i], d[i + 1], d[i + 2]);
    inputColors.add(key);
    if (baseLookup.has(key) || customLookup.has(key)) {
      outputColors.add(key);
      continue;
    }

    let bestDist = Infinity;
    let bestR = 0;
    let bestG = 0;
    let bestB = 0;
    for (const color of availableColors) {
      const dr = d[i] - color.r;
      const dg = d[i + 1] - color.g;
      const db = d[i + 2] - color.b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestR = color.r;
        bestG = color.g;
        bestB = color.b;
      }
    }

    convertedColors.add(key);
    outputColors.add(packRgb(bestR, bestG, bestB));
    d[i] = bestR;
    d[i + 1] = bestG;
    d[i + 2] = bestB;
  }

  return {
    convertedCount: convertedColors.size,
    totalInputColorCount: inputColors.size,
    fewerOutputColorCount: inputColors.size - outputColors.size,
  };
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export function convertUnsupportedRegionToNearestPalette(
  imageData: ImageData,
  startX: number,
  startZ: number,
  baseLookup: Map<number, ShadedColorRef>,
  customLookup: Map<number, ShadedColorRef>,
): PaletteConversionSummary {
  const availableColors = getNearestPaletteColors(baseLookup, customLookup);
  const inputColors = new Set<number>();
  const outputColors = new Set<number>();
  const convertedColors = new Set<number>();
  const d = imageData.data;

  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const offset = ((startZ + z) * imageData.width + (startX + x)) * 4;
      if (d[offset + 3] === 0) continue;
      const key = packRgb(d[offset], d[offset + 1], d[offset + 2]);
      inputColors.add(key);
      if (baseLookup.has(key) || customLookup.has(key)) {
        outputColors.add(key);
        continue;
      }

      let bestDist = Infinity;
      let bestR = 0;
      let bestG = 0;
      let bestB = 0;
      for (const color of availableColors) {
        const dr = d[offset] - color.r;
        const dg = d[offset + 1] - color.g;
        const db = d[offset + 2] - color.b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestR = color.r;
          bestG = color.g;
          bestB = color.b;
        }
      }

      convertedColors.add(key);
      outputColors.add(packRgb(bestR, bestG, bestB));
      d[offset] = bestR;
      d[offset + 1] = bestG;
      d[offset + 2] = bestB;
    }
  }

  return {
    convertedCount: convertedColors.size,
    totalInputColorCount: inputColors.size,
    fewerOutputColorCount: inputColors.size - outputColors.size,
  };
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export function buildConversionNotices(
  convertedCount: number,
  totalInputColorCount: number,
  fewerOutputColorCount: number,
): PaletteNotice[] {
  const notices: PaletteNotice[] = [
    messages.parsing.convertedPaletteColorsNotice(convertedCount, totalInputColorCount),
  ];
  if (fewerOutputColorCount > 0) notices.push(messages.parsing.reducedUniqueColorsNotice(fewerOutputColorCount));
  return notices;
}
