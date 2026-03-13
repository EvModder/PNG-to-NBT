/**
 * Public API:
 * - convertImageToColorGrid()
 * - convertFileToColorGrid()
 *
 * Callers:
 * - src/Index.tsx
 */
import * as UTIF from "utif";
import { BASE_COLORS, type ColorShade, SHADE_MULTIPLIERS, packRgb, unpackRgb } from "@/data/mapColors";
import { messages, type PaletteNotice } from "@/lib/messages";
import { type ColorData, type ColorGrid, MAP_SIZE, TRANSPARENT_COLOR } from "./colorGridTypes";

interface CustomColorLike {
  r: number;
  g: number;
  b: number;
  block: string;
}

interface ColorGridAnalysis {
  imageData: ImageData;
  colorGrid: ColorGrid;
  paletteNotices: PaletteNotice[];
  hasBlockingIssue: boolean;
}

let baseColorLookup: Map<number, ColorShade> | null = null;

function getBaseColorLookup(): Map<number, ColorShade> {
  if (baseColorLookup) return baseColorLookup;
  baseColorLookup = new Map();
  for (let i = 1; i < BASE_COLORS.length; ++i) {
    const { r, g, b } = BASE_COLORS[i];
    for (const shade of [0, 1, 2] as const) {
      const mr = Math.floor((r * SHADE_MULTIPLIERS[shade]) / 255);
      const mg = Math.floor((g * SHADE_MULTIPLIERS[shade]) / 255);
      const mb = Math.floor((b * SHADE_MULTIPLIERS[shade]) / 255);
      baseColorLookup.set(packRgb(mr, mg, mb), { baseIndex: i, shade });
    }
  }
  return baseColorLookup;
}

function createEmptyColorGrid(): ColorGrid {
  return Array.from({ length: MAP_SIZE }, () => Array<ColorData>(MAP_SIZE).fill(TRANSPARENT_COLOR));
}

function buildCustomShadeLookup(customColors: CustomColorLike[]): Map<number, ColorData> {
  const lookup = new Map<number, ColorData>();
  for (const [customIndex, color] of customColors.entries()) {
    if (!color.block?.trim()) continue;
    for (const shade of [0, 1, 2] as const) {
      const r = Math.floor((color.r * SHADE_MULTIPLIERS[shade]) / 255);
      const g = Math.floor((color.g * SHADE_MULTIPLIERS[shade]) / 255);
      const b = Math.floor((color.b * SHADE_MULTIPLIERS[shade]) / 255);
      const key = packRgb(r, g, b);
      if (!lookup.has(key)) lookup.set(key, { isCustom: true, id: customIndex, shade });
    }
  }
  return lookup;
}

function scanImageToColorGrid(
  imageData: ImageData,
  baseLookup: Map<number, ColorShade>,
  customLookup: Map<number, ColorData>,
): { colorGrid: ColorGrid; unsupportedColors: number[] } {
  const colorGrid = createEmptyColorGrid();
  const unsupported = new Set<number>();

  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const idx = (z * MAP_SIZE + x) * 4;
      if (imageData.data[idx + 3] === 0) {
        colorGrid[x][z] = TRANSPARENT_COLOR;
        continue;
      }

      const key = packRgb(imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]);
      const baseMatch = baseLookup.get(key);
      if (baseMatch) {
        colorGrid[x][z] = { isCustom: false, id: baseMatch.baseIndex, shade: baseMatch.shade };
        continue;
      }

      const customMatch = customLookup.get(key);
      if (customMatch) {
        colorGrid[x][z] = customMatch;
        continue;
      }

      unsupported.add(key);
    }
  }

  return { colorGrid, unsupportedColors: [...unsupported] };
}

function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function convertUnsupportedToNearestBasePalette(imageData: ImageData, baseLookup: Map<number, ColorShade>) {
  const availableColors = [...baseLookup.keys()].map(key => {
    const [r, g, b] = unpackRgb(key);
    return { r, g, b };
  });
  const inputColors = new Set<number>();
  const outputColors = new Set<number>();
  const convertedColors = new Set<number>();
  const d = imageData.data;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = packRgb(d[i], d[i + 1], d[i + 2]);
    inputColors.add(key);
    if (baseLookup.has(key)){
      outputColors.add(key);
      continue;
    }

    let bestDist = Infinity;
    let bestR = 0, bestG = 0, bestB = 0;
    for (const color of availableColors) {
      const dr = d[i] - color.r, dg = d[i + 1] - color.g, db = d[i + 2] - color.b;
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

function isTiffFile(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return type === "image/tiff" || name.endsWith(".tif") || name.endsWith(".tiff");
}

function loadBrowserImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error(messages.parsing.unableToCreateImageCanvas);
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(messages.parsing.failedToDecodeImage));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(messages.parsing.browserDecodeFailure));
    };
    img.src = objectUrl;
  });
}

async function loadTiffImageData(file: File): Promise<ImageData> {
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  const ifd = ifds[0];
  if (!ifd) throw new Error(messages.parsing.tiffNoImageData);
  UTIF.decodeImage(buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  return new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height);
}

async function loadImageDataFromFile(file: File): Promise<ImageData> {
  if (isTiffFile(file)) return loadTiffImageData(file);
  return loadBrowserImageData(file);
}

function buildConversionNotices(convertedCount: number, totalInputColorCount: number, fewerOutputColorCount: number): PaletteNotice[] {
  const notices: PaletteNotice[] = [
    messages.parsing.convertedPaletteColorsNotice(convertedCount, totalInputColorCount),
  ];
  if (fewerOutputColorCount > 0) notices.push(messages.parsing.reducedUniqueColorsNotice(fewerOutputColorCount));
  return notices;
}

// Callers:
// - src/Index.tsx
export function convertImageToColorGrid(
  imageData: ImageData,
  customColors: CustomColorLike[],
  convertUnsupported = false,
): ColorGridAnalysis {
  const baseLookup = getBaseColorLookup();
  const customLookup = buildCustomShadeLookup(customColors);
  const hasSizeError = imageData.width !== MAP_SIZE || imageData.height !== MAP_SIZE;

  if (hasSizeError) {
    return {
      imageData,
      colorGrid: createEmptyColorGrid(),
      paletteNotices: [messages.parsing.imageSizeNotice(imageData.width, imageData.height)],
      hasBlockingIssue: true,
    };
  }

  const initial = scanImageToColorGrid(imageData, baseLookup, customLookup);
  if (initial.unsupportedColors.length === 0 || !convertUnsupported) {
    return {
      imageData,
      colorGrid: initial.colorGrid,
      paletteNotices:
        initial.unsupportedColors.length > 0
          ? [messages.parsing.unsupportedPaletteColorsNotice(initial.unsupportedColors)]
          : [],
      hasBlockingIssue: initial.unsupportedColors.length > 0,
    };
  }

  const convertedImageData = cloneImageData(imageData);
  const conversionSummary = convertUnsupportedToNearestBasePalette(convertedImageData, baseLookup);
  const converted = scanImageToColorGrid(convertedImageData, baseLookup, customLookup);
  return {
    imageData: convertedImageData,
    colorGrid: converted.colorGrid,
    paletteNotices:
      converted.unsupportedColors.length === 0
        ? buildConversionNotices(
            conversionSummary.convertedCount,
            conversionSummary.totalInputColorCount,
            conversionSummary.fewerOutputColorCount,
          )
        : [messages.parsing.unsupportedPaletteColorsNotice(converted.unsupportedColors)],
    hasBlockingIssue: converted.unsupportedColors.length > 0,
  };
}

// Callers:
// - src/Index.tsx
export async function convertFileToColorGrid(
  file: File,
  customColors: CustomColorLike[],
  convertUnsupported = false,
): Promise<ColorGridAnalysis> {
  const imageData = await loadImageDataFromFile(file);
  return convertImageToColorGrid(imageData, customColors, convertUnsupported);
}
