/**
 * Public API:
 * - convertImageToColorGrid()
 * - convertFileToColorGrid()
 *
 * Callers:
 * - src/Index.tsx
 */
import * as UTIF from "utif";
import { BASE_COLORS, type ColorShade, SHADE_MULTIPLIERS, packRgb } from "@/data/mapColors";
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
  unsupportedColors: number[];
  paletteErrors: string[];
  sizeErrors: string[];
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

function unpackRgb(key: number): [number, number, number] {
  return [(key >> 16) & 255, (key >> 8) & 255, key & 255];
}

function formatPaletteErrors(unsupportedColors: number[]): string[] {
  if (unsupportedColors.length === 0) return [];
  const shown = unsupportedColors.slice(0, 10);
  return [
    `Found ${unsupportedColors.length} color${unsupportedColors.length === 1 ? "" : "s"} not in Minecraft map palette:\n\n${shown.map(color => `rgb(${unpackRgb(color).join(",")})`).join(", ")}${unsupportedColors.length > 10 ? "..." : ""}`,
  ];
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

function buildConversionMessages(convertedCount: number, totalInputColorCount: number, fewerOutputColorCount: number): string[] {
  const line1 =
    convertedCount === totalInputColorCount
      ? `Converted ${convertedCount} color${convertedCount === 1 ? "" : "s"} to nearest palette id.`
      : `Converted ${convertedCount} (of ${totalInputColorCount}) color${totalInputColorCount === 1 ? "" : "s"} to nearest palette id.`;
  const lines = [line1];
  if (fewerOutputColorCount > 0) {
    lines.push(`${fewerOutputColorCount} fewer unique color${fewerOutputColorCount === 1 ? "" : "s"} than source image.`);
  }
  return lines;
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
        if (!ctx) throw new Error("Unable to create image canvas.");
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to decode image."));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode this image format in the browser."));
    };
    img.src = objectUrl;
  });
}

async function loadTiffImageData(file: File): Promise<ImageData> {
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  const ifd = ifds[0];
  if (!ifd) throw new Error("TIFF file contains no image data.");
  UTIF.decodeImage(buffer, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  return new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height);
}

async function loadImageDataFromFile(file: File): Promise<ImageData> {
  if (isTiffFile(file)) return loadTiffImageData(file);
  return loadBrowserImageData(file);
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
  const sizeErrors =
    imageData.width === MAP_SIZE && imageData.height === MAP_SIZE
      ? []
      : [`Image must be 128×128 pixels (got ${imageData.width}×${imageData.height})`];

  if (sizeErrors.length > 0) {
    return {
      imageData,
      colorGrid: createEmptyColorGrid(),
      unsupportedColors: [],
      paletteErrors: sizeErrors,
      sizeErrors,
    };
  }

  const initial = scanImageToColorGrid(imageData, baseLookup, customLookup);
  if (initial.unsupportedColors.length === 0 || !convertUnsupported) {
    return {
      imageData,
      colorGrid: initial.colorGrid,
      unsupportedColors: initial.unsupportedColors,
      paletteErrors: formatPaletteErrors(initial.unsupportedColors),
      sizeErrors: [],
    };
  }

  const convertedImageData = cloneImageData(imageData);
  const conversionSummary = convertUnsupportedToNearestBasePalette(convertedImageData, baseLookup);
  const converted = scanImageToColorGrid(convertedImageData, baseLookup, customLookup);
  return {
    imageData: convertedImageData,
    colorGrid: converted.colorGrid,
    unsupportedColors: converted.unsupportedColors,
    paletteErrors:
      converted.unsupportedColors.length === 0
        ? buildConversionMessages(
            conversionSummary.convertedCount,
            conversionSummary.totalInputColorCount,
            conversionSummary.fewerOutputColorCount,
          )
        : formatPaletteErrors(converted.unsupportedColors),
    sizeErrors: [],
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
