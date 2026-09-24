/**
 * Public API:
 * - ColorGridRegionScanResult
 * - PaletteConversionSummary
 * - InputColorPalette
 * - buildInputColorPalette()
 * - presetCoversAllColors()
 * - compareInputColorPalettes()
 * - InputPaletteEquivalence
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
 * - src/Index.tsx
 * - src/components/ImageColorNotice.tsx
 * - src/components/PanelImagePreview.tsx
 * - src/lib/colorGridParsing.ts
 * - src/lib/tileParsing.worker.ts
 * - src/lib/tileParsingWorkerClient.ts
 * - src/lib/tileParsingWorkerTypes.ts
 */
import { BASE_COLORS, TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX } from "@/data/mapColors";
import { getShadedRgb, packRgb, unpackRgb, MAP_SIZE, TRANSPARENT_COLOR } from "@/utils/color";
import { messages, type PaletteNotice } from "@/lib/messages";
import { Shade, type ColorGrid, type ColorRgb, type ShadedColorRef } from "@/types/color";
import { FlatModeBehavior, PixelParity, type ColorFrequencyMap, type ColorGridStats } from "@/lib/colorGridAnalysis";
import { getColorGridCacheKey } from "@/utils/colorGridKey";
import { findMatchingBaseColorIndex } from "@/utils/customColors";
import { getColorRefKey, type ColorRefKey } from "@/lib/colorRefs";

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
  allInputColorsValid: boolean;
};

let baseColorLookup: Map<number, ShadedColorRef> | null = null;
const nearestBasePaletteColors = new WeakMap<Map<number, ShadedColorRef>, { r: number; g: number; b: number }[]>();
const STANDARD_SHADES = [Shade.Dark, Shade.Flat, Shade.Light] as const;
// Retain only the latest crop for an immutable upload; released with that image.
const inputPaletteColors = new WeakMap<ImageData, { width: number; height: number; colors: Set<number> }>();

// Callers:
// - src/Index.tsx
// - src/components/ImageColorNotice.tsx
// - src/components/PanelImagePreview.tsx
export type InputPaletteEquivalence = { fullPreset: boolean; fullFlat: boolean; presetFlat: boolean };

// Compare mapped color IDs and shades, not selected block types or RGB alone.
// Callers:
// - src/Index.tsx
export function compareInputColorPalettes(
  imageData: ImageData | null, customColors: ColorRgb[], colorKeys: readonly ColorRefKey[], allowDeepWater: boolean,
  targetSize?: { width: number; height: number },
): InputPaletteEquivalence {
  const equal = { fullPreset: !!imageData, fullFlat: !!imageData, presetFlat: !!imageData };
  if (!imageData) return equal;
  const palettes = [undefined, buildInputColorPalette(colorKeys, false, false), buildInputColorPalette(colorKeys, true, allowDeepWater)];
  const lookups = palettes.map(palette => {
    const base = getBaseColorLookup(palette);
    const custom = buildCustomShadeLookup(customColors, palette);
    return { base, custom, colors: getNearestPaletteColors(base, custom) };
  });
  const sameRef = (a: ShadedColorRef | undefined, b: ShadedColorRef | undefined) => !!a && !!b &&
    a.id === b.id && a.isCustom === b.isCustom && a.shade === b.shade;
  const sameLookup = (a: number, b: number) => lookups[a].colors.length === lookups[b].colors.length &&
    lookups[a].colors.every((color, index) => {
      const other = lookups[b].colors[index];
      const key = packRgb(color.r, color.g, color.b);
      return color.r === other.r && color.g === other.g && color.b === other.b &&
        sameRef(lookups[a].base.get(key) ?? lookups[a].custom.get(key), lookups[b].base.get(key) ?? lookups[b].custom.get(key));
    });
  const fixed = { fullPreset: sameLookup(0, 1), fullFlat: sameLookup(0, 2), presetFlat: sameLookup(1, 2) };
  if (fixed.fullPreset && fixed.fullFlat && fixed.presetFlat) return equal;
  // True means every pair is decided, so no further colors need comparison.
  const compareColor = (key: number): boolean => {
    const [r, g, b] = unpackRgb(key);
    const refs = lookups.map(({ base, custom, colors }) => {
      const exact = base.get(key) ?? custom.get(key);
      if (exact) return exact;
      let nearest = key;
      let distance = Infinity;
      for (const color of colors) {
        const next = (r - color.r) ** 2 + (g - color.g) ** 2 + (b - color.b) ** 2;
        if (next < distance) {
          distance = next;
          nearest = packRgb(color.r, color.g, color.b);
        }
      }
      return base.get(nearest) ?? custom.get(nearest);
    });
    equal.fullPreset &&= sameRef(refs[0], refs[1]);
    equal.fullFlat &&= sameRef(refs[0], refs[2]);
    equal.presetFlat &&= sameRef(refs[1], refs[2]);
    return (fixed.fullPreset || !equal.fullPreset) && (fixed.fullFlat || !equal.fullFlat) && (fixed.presetFlat || !equal.presetFlat);
  };
  const width = Math.min(imageData.width, targetSize?.width ?? imageData.width);
  const height = Math.min(imageData.height, targetSize?.height ?? imageData.height);
  const cached = inputPaletteColors.get(imageData);
  if (cached?.width === width && cached.height === height) {
    for (const key of cached.colors) if (compareColor(key)) break;
    return equal;
  }
  const seen = new Set<number>();
  const data = imageData.data;
  const left = Math.floor((imageData.width - width) / 2);
  const top = Math.floor((imageData.height - height) / 2);
  let previous = -1;
  for (let y = top; y < top + height; ++y) {
    const end = (y * imageData.width + left + width) * 4;
    for (let i = (y * imageData.width + left) * 4; i < end; i += 4) {
      if (data[i + 3] === 0) continue;
      const key = packRgb(data[i], data[i + 1], data[i + 2]);
      if (key === previous) continue;
      previous = key;
      if (seen.has(key)) continue;
      seen.add(key);
      if (compareColor(key)) return equal;
    }
  }
  inputPaletteColors.set(imageData, { width, height, colors: seen });
  return equal;
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsingWorkerClient.ts
// - src/lib/tileParsingWorkerTypes.ts
export type InputColorPalette = ReadonlyMap<ColorRefKey, readonly (typeof STANDARD_SHADES)[number][]>;

// Callers:
// - src/Index.tsx
export function buildInputColorPalette(colorKeys: readonly ColorRefKey[], flat: boolean, allowDeepWater: boolean): InputColorPalette {
  // Flat water uses depth-based shades when allowed; otherwise restrict it to light.
  const waterKey = getColorRefKey({ id: WATER_BASE_INDEX, isCustom: false });
  return new Map(colorKeys.map(key => [key, !flat ? STANDARD_SHADES
    : key === waterKey ? (allowDeepWater ? STANDARD_SHADES : [Shade.Light]) : [Shade.Flat]]));
}

// Callers:
// - src/Index.tsx
export function presetCoversAllColors(customColors: ColorRgb[], colorKeys: readonly ColorRefKey[]): boolean {
  const selected = new Set(colorKeys);
  return BASE_COLORS.every((_, id) => id === TRANSPARENCY_BASE_INDEX || selected.has(getColorRefKey({ id, isCustom: false }))) &&
    customColors.every((_, id) => selected.has(getColorRefKey({ id, isCustom: true })));
}

function addShadedLookupEntries(
  lookup: Map<number, ShadedColorRef>,
  color: Pick<ColorRgb, "r" | "g" | "b">,
  buildRef: (shade: Shade.Dark | Shade.Flat | Shade.Light) => ShadedColorRef,
  shades: readonly (typeof STANDARD_SHADES)[number][] = STANDARD_SHADES,
): void {
  for (const shade of shades) {
    const key = packRgb(...getShadedRgb(color, shade));
    if (!lookup.has(key)) lookup.set(key, buildRef(shade));
  }
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export function getBaseColorLookup(allowedColors?: InputColorPalette): Map<number, ShadedColorRef> {
  if (!allowedColors && baseColorLookup) return baseColorLookup;
  const lookup = new Map<number, ShadedColorRef>();
  for (let i = 1; i < BASE_COLORS.length; ++i) {
    const shades = allowedColors?.get(getColorRefKey({ isCustom: false, id: i }));
    if (allowedColors && !shades) continue;
    addShadedLookupEntries(lookup, BASE_COLORS[i], shade => ({ isCustom: false, id: i, shade }), shades);
  }
  if (!allowedColors) baseColorLookup = lookup;
  return lookup;
}

function getNearestBasePaletteColors(baseLookup: Map<number, ShadedColorRef>): { r: number; g: number; b: number }[] {
  const cached = nearestBasePaletteColors.get(baseLookup);
  if (cached) return cached;
  const colors = [...baseLookup.keys()].map(key => {
    const [r, g, b] = unpackRgb(key);
    return { r, g, b };
  });
  nearestBasePaletteColors.set(baseLookup, colors);
  return colors;
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
export function createEmptyColorGrid(): ColorGrid {
  return Array.from({ length: MAP_SIZE }, () => Array<ShadedColorRef>(MAP_SIZE).fill(TRANSPARENT_COLOR));
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export function buildCustomShadeLookup(customColors: ColorRgb[], allowedColors?: InputColorPalette): Map<number, ShadedColorRef> {
  const lookup = new Map<number, ShadedColorRef>();
  for (const [customIndex, color] of customColors.entries()) {
    const shades = allowedColors?.get(getColorRefKey({ isCustom: true, id: customIndex }));
    if (allowedColors && !shades) continue;
    if (findMatchingBaseColorIndex(color) !== null) continue;
    addShadedLookupEntries(lookup, color, shade => ({ isCustom: true, id: customIndex, shade }), shades);
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
  if (availableColors.length === 0) return { convertedCount: 0, totalInputColorCount: 0, fewerOutputColorCount: 0, allInputColorsValid: false };
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
    allInputColorsValid: inputColors.values().every(key => getBaseColorLookup().has(key)),
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
  if (availableColors.length === 0) return { convertedCount: 0, totalInputColorCount: 0, fewerOutputColorCount: 0, allInputColorsValid: false };
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
    allInputColorsValid: inputColors.values().every(key => getBaseColorLookup().has(key)),
    totalInputColorCount: inputColors.size,
    fewerOutputColorCount: inputColors.size - outputColors.size,
  };
}

// Callers:
// - src/lib/colorGridParsing.ts
// - src/lib/tileParsing.worker.ts
export function buildConversionNotices(
  { convertedCount, totalInputColorCount, fewerOutputColorCount, allInputColorsValid }: PaletteConversionSummary,
): PaletteNotice[] {
  const notices: PaletteNotice[] = [
    messages.parsing.convertedPaletteColorsNotice(convertedCount, totalInputColorCount, allInputColorsValid),
  ];
  if (fewerOutputColorCount > 0) notices.push(messages.parsing.reducedUniqueColorsNotice(fewerOutputColorCount));
  return notices;
}
