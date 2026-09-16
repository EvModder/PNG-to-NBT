/**
 * Public API:
 * - ParsedColorGridTile
 * - ColorGridSetParseResult
 * - getTargetTileDimensions()
 * - convertImageToColorGrid()
 * - convertImageToColorGridSet()
 * - loadImageDataFromFile()
 * - convertImageToColorGridSetAsync()
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelImagePreview.tsx
 */
import * as UTIF from "utif";
import type { InvalidDimensionsMode } from "@/data/defaultSettings";
import { messages, PaletteNoticeKind, type PaletteNotice } from "@/lib/messages";
import { MAP_SIZE, packRgb } from "@/utils/color";
import type { ColorGrid, ColorRgb } from "@/types/color";
import type { ColorGridStats } from "@/lib/colorGridAnalysis";
import {
  buildConversionNotices,
  buildCustomShadeLookup,
  cloneImageData,
  convertUnsupportedRegionToNearestPalette,
  convertUnsupportedToNearestPalette,
  createEmptyColorGrid,
  getBaseColorLookup,
  scanImageRegionToColorGrid,
  type InputColorPalette,
} from "@/lib/colorGridParsingCore";
import { parseColorGridTilesInWorkers } from "@/lib/tileParsingWorkerClient";

interface ColorGridParseResult {
  imageData: ImageData;
  colorGrid: ColorGrid;
  paletteNotices: PaletteNotice[];
  hasBlockingIssue: boolean;
}

type ImagePreprocessResult = {
  imageData: ImageData;
  paletteNotices: PaletteNotice[];
};

// Callers:
// - src/Index.tsx
export interface ParsedColorGridTile {
  row: number;
  col: number;
  startX: number;
  startZ: number;
  colorGrid: ColorGrid;
  imageStats: ColorGridStats;
  cacheKey: string;
}

// Callers:
// - src/Index.tsx
export interface ColorGridSetParseResult {
  imageData: ImageData;
  tiles: ParsedColorGridTile[];
  tileRows: number;
  tileCols: number;
  paletteNotices: PaletteNotice[];
  hasBlockingIssue: boolean;
}

function cropImageData(
  imageData: ImageData,
  left: number,
  top: number,
  width: number,
  height: number,
): ImageData {
  const croppedData = new Uint8ClampedArray(width * height * 4);
  const targetRowWidth = width * 4;

  for (let row = 0; row < height; ++row) {
    const sourceStart = ((top + row) * imageData.width + left) * 4;
    const sourceEnd = sourceStart + targetRowWidth;
    croppedData.set(imageData.data.subarray(sourceStart, sourceEnd), row * targetRowWidth);
  }

  return new ImageData(croppedData, width, height);
}

function padImageData(
  imageData: ImageData,
  left: number,
  top: number,
  width: number,
  height: number,
): ImageData {
  const paddedData = new Uint8ClampedArray(width * height * 4);
  const sourceRowWidth = imageData.width * 4;

  for (let row = 0; row < imageData.height; ++row) {
    const sourceStart = row * sourceRowWidth;
    const targetStart = ((top + row) * width + left) * 4;
    paddedData.set(imageData.data.subarray(sourceStart, sourceStart + sourceRowWidth), targetStart);
  }

  return new ImageData(paddedData, width, height);
}

// Callers:
// - src/Index.tsx
// - src/components/PanelImagePreview.tsx
export function getTargetTileDimensions(
  width: number,
  height: number,
  mode: InvalidDimensionsMode,
): { width: number; height: number } {
  if (mode === "reject" || width <= 0 || height <= 0) return { width, height };
  if (mode === "pad") {
    return {
      width: Math.max(MAP_SIZE, Math.ceil(width / MAP_SIZE) * MAP_SIZE),
      height: Math.max(MAP_SIZE, Math.ceil(height / MAP_SIZE) * MAP_SIZE),
    };
  }
  const croppedWidth = width - (width % MAP_SIZE);
  const croppedHeight = height - (height % MAP_SIZE);
  // Too small to crop down to a whole tile; leave it for the size check to reject.
  if (croppedWidth < MAP_SIZE || croppedHeight < MAP_SIZE) return { width, height };
  return { width: croppedWidth, height: croppedHeight };
}

function resizeImageToTileMultiples(
  imageData: ImageData,
  mode: InvalidDimensionsMode,
): ImagePreprocessResult {
  const target = getTargetTileDimensions(imageData.width, imageData.height, mode);
  if (target.width === imageData.width && target.height === imageData.height) {
    return { imageData, paletteNotices: [] };
  }

  if (mode === "pad") {
    const left = Math.floor((target.width - imageData.width) / 2);
    const top = Math.floor((target.height - imageData.height) / 2);
    const right = target.width - imageData.width - left;
    const bottom = target.height - imageData.height - top;
    return {
      imageData: padImageData(imageData, left, top, target.width, target.height),
      paletteNotices: [
        messages.parsing.paddedImageNotice(target.width, target.height),
        messages.parsing.paddedImageAddedPixelsNotice(left, right, top, bottom),
      ],
    };
  }

  const left = Math.floor((imageData.width - target.width) / 2);
  const top = Math.floor((imageData.height - target.height) / 2);
  const right = imageData.width - target.width - left;
  const bottom = imageData.height - target.height - top;
  return {
    imageData: cropImageData(imageData, left, top, target.width, target.height),
    paletteNotices: [
      messages.parsing.croppedImageNotice(target.width, target.height),
      messages.parsing.croppedImageRemovedPixelsNotice(left, right, top, bottom),
    ],
  };
}

function getInvalidDimensionNotices(imageData: ImageData, customColors: ColorRgb[], autoFixInvalidColors: boolean, allowedColors?: InputColorPalette): PaletteNotice[] {
  const notices = [messages.parsing.imageSizeNotice(imageData.width, imageData.height)];
  if (autoFixInvalidColors) return notices;

  // Invalid dimensions prevent tile parsing, but not a read-only color check.
  const baseLookup = getBaseColorLookup(allowedColors);
  const customLookup = buildCustomShadeLookup(customColors, allowedColors);
  const unsupported = new Set<number>();
  for (let i = 0; i < imageData.data.length; i += 4) {
    if (imageData.data[i + 3] === 0) continue;
    const key = packRgb(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
    if (!baseLookup.has(key) && !customLookup.has(key)) unsupported.add(key);
  }
  if (unsupported.size > 0) notices.push(messages.parsing.unsupportedPaletteColorsNotice([...unsupported], !!allowedColors));
  return notices;
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

// Callers:
// - src/Index.tsx
export async function loadImageDataFromFile(file: File): Promise<ImageData> {
  if (isTiffFile(file)) return loadTiffImageData(file);
  return loadBrowserImageData(file);
}

function aggregatePaletteNotices(tileNotices: readonly PaletteNotice[], input: ImageData, output: ImageData): PaletteNotice[] {
  let sizeError: PaletteNotice | null = null;
  const unsupportedColors = new Set<number>();
  let restrictedPalette = false;
  let hasConversion = false;
  const freeformNotices: PaletteNotice[] = [];
  const lossyFormatNotices: PaletteNotice[] = [];

  for (const notice of tileNotices) {
    switch (notice.kind) {
      case PaletteNoticeKind.SizeError:
        sizeError ??= notice;
        break;
      case PaletteNoticeKind.UnsupportedPaletteColors:
        restrictedPalette ||= notice.restrictedPalette;
        for (const color of notice.colors) unsupportedColors.add(color);
        break;
      case PaletteNoticeKind.ConvertedPaletteColors:
        hasConversion = true;
        break;
      case PaletteNoticeKind.LossyFormatHint:
        lossyFormatNotices.push(notice);
        break;
      case PaletteNoticeKind.Freeform:
        freeformNotices.push(notice);
        break;
    }
  }

  const notices: PaletteNotice[] = [];
  if (sizeError) notices.push(sizeError);
  if (unsupportedColors.size > 0) notices.push(messages.parsing.unsupportedPaletteColorsNotice([...unsupportedColors], restrictedPalette));
  if (hasConversion) {
    // Count distinct colors across the image, including tiles that needed no conversion.
    const inputColors = new Set<number>();
    const outputColors = new Set<number>();
    const convertedColors = new Set<number>();
    for (let i = 0; i < input.data.length; i += 4) {
      if (input.data[i + 3] === 0) continue;
      const before = packRgb(input.data[i], input.data[i + 1], input.data[i + 2]);
      const after = packRgb(output.data[i], output.data[i + 1], output.data[i + 2]);
      inputColors.add(before);
      outputColors.add(after);
      if (before !== after) convertedColors.add(before);
    }
    notices.push(...buildConversionNotices({
      convertedCount: convertedColors.size,
      totalInputColorCount: inputColors.size,
      fewerOutputColorCount: inputColors.size - outputColors.size,
      allInputColorsValid: inputColors.values().every(key => getBaseColorLookup().has(key)),
    }));
  }
  notices.push(...lossyFormatNotices, ...freeformNotices);
  return notices;
}

export function convertImageToColorGrid(
  imageData: ImageData,
  customColors: ColorRgb[],
  autoFixInvalidColors = false,
  invalidDimensionsMode: InvalidDimensionsMode = "reject",
  allowedColors?: InputColorPalette,
): ColorGridParseResult {
  const preprocessed = resizeImageToTileMultiples(imageData, invalidDimensionsMode);
  const workingImageData = preprocessed.imageData;
  const baseLookup = getBaseColorLookup(allowedColors);
  const customLookup = buildCustomShadeLookup(customColors, allowedColors);
  const hasSizeError = workingImageData.width !== MAP_SIZE || workingImageData.height !== MAP_SIZE;

  if (hasSizeError) {
    return {
      imageData: workingImageData,
      colorGrid: createEmptyColorGrid(),
      paletteNotices: [
        ...preprocessed.paletteNotices,
        ...getInvalidDimensionNotices(workingImageData, customColors, autoFixInvalidColors, allowedColors),
      ],
      hasBlockingIssue: true,
    };
  }

  const initial = scanImageRegionToColorGrid(workingImageData, 0, 0, baseLookup, customLookup);
  if (initial.unsupportedColors.length === 0 || !autoFixInvalidColors) {
    return {
      imageData: workingImageData,
      colorGrid: initial.colorGrid,
      paletteNotices: initial.unsupportedColors.length > 0
        ? [...preprocessed.paletteNotices, messages.parsing.unsupportedPaletteColorsNotice(initial.unsupportedColors, !!allowedColors)]
        : preprocessed.paletteNotices,
      hasBlockingIssue: initial.unsupportedColors.length > 0,
    };
  }

  const convertedImageData = cloneImageData(workingImageData);
  const conversionSummary = convertUnsupportedToNearestPalette(convertedImageData, baseLookup, customLookup);
  const converted = scanImageRegionToColorGrid(convertedImageData, 0, 0, baseLookup, customLookup);
  return {
    imageData: convertedImageData,
    colorGrid: converted.colorGrid,
    paletteNotices: [
      ...preprocessed.paletteNotices,
      ...(converted.unsupportedColors.length === 0
        ? buildConversionNotices(conversionSummary)
        : [messages.parsing.unsupportedPaletteColorsNotice(converted.unsupportedColors, !!allowedColors)]),
    ],
    hasBlockingIssue: converted.unsupportedColors.length > 0,
  };
}

// Callers:
// - src/Index.tsx
export function convertImageToColorGridSet(
  imageData: ImageData,
  customColors: ColorRgb[],
  autoFixInvalidColors = false,
  invalidDimensionsMode: InvalidDimensionsMode = "reject",
  allowedColors?: InputColorPalette,
): ColorGridSetParseResult {
  const preprocessed = resizeImageToTileMultiples(imageData, invalidDimensionsMode);
  const baseImageData = preprocessed.imageData;
  const validWidth = baseImageData.width > 0 && baseImageData.width % MAP_SIZE === 0;
  const validHeight = baseImageData.height > 0 && baseImageData.height % MAP_SIZE === 0;
  if (!validWidth || !validHeight) {
    return {
      imageData: baseImageData,
      tiles: [],
      tileRows: 0,
      tileCols: 0,
      paletteNotices: [
        ...preprocessed.paletteNotices,
        ...getInvalidDimensionNotices(baseImageData, customColors, autoFixInvalidColors, allowedColors),
      ],
      hasBlockingIssue: true,
    };
  }

  const tileCols = baseImageData.width / MAP_SIZE;
  const tileRows = baseImageData.height / MAP_SIZE;
  const baseLookup = getBaseColorLookup(allowedColors);
  const customLookup = buildCustomShadeLookup(customColors, allowedColors);
  let workingImageData = baseImageData;
  const tiles: ParsedColorGridTile[] = [];
  const tileNotices: PaletteNotice[] = [];
  let hasBlockingIssue = false;

  const ensureWorkingImageData = (): ImageData => {
    if (workingImageData === baseImageData) workingImageData = cloneImageData(baseImageData);
    return workingImageData;
  };

  for (let row = 0; row < tileRows; ++row) {
    for (let col = 0; col < tileCols; ++col) {
      const startX = col * MAP_SIZE;
      const startZ = row * MAP_SIZE;
      let analysis = scanImageRegionToColorGrid(workingImageData, startX, startZ, baseLookup, customLookup);
      let paletteNotices: PaletteNotice[] = [];
      let tileHasBlockingIssue = analysis.unsupportedColors.length > 0;
      if (analysis.unsupportedColors.length > 0 && autoFixInvalidColors) {
        const conversionSummary = convertUnsupportedRegionToNearestPalette(
          ensureWorkingImageData(),
          startX,
          startZ,
          baseLookup,
          customLookup,
        );
        analysis = scanImageRegionToColorGrid(workingImageData, startX, startZ, baseLookup, customLookup);
        if (analysis.unsupportedColors.length === 0) {
          paletteNotices = buildConversionNotices(conversionSummary);
          tileHasBlockingIssue = false;
        } else {
          paletteNotices = [messages.parsing.unsupportedPaletteColorsNotice(analysis.unsupportedColors, !!allowedColors)];
        }
      } else if (analysis.unsupportedColors.length > 0) {
        paletteNotices = [messages.parsing.unsupportedPaletteColorsNotice(analysis.unsupportedColors, !!allowedColors)];
      }
      tiles.push({
        row,
        col,
        startX,
        startZ,
        colorGrid: analysis.colorGrid,
        imageStats: analysis.imageStats,
        cacheKey: analysis.cacheKey,
      });
      tileNotices.push(...paletteNotices);
      hasBlockingIssue ||= tileHasBlockingIssue;
    }
  }

  return {
    imageData: workingImageData,
    tiles,
    tileRows,
    tileCols,
    paletteNotices: [...preprocessed.paletteNotices, ...aggregatePaletteNotices(tileNotices, baseImageData, workingImageData)],
    hasBlockingIssue,
  };
}

// Callers:
// - src/Index.tsx
export async function convertImageToColorGridSetAsync(
  imageData: ImageData,
  customColors: ColorRgb[],
  autoFixInvalidColors = false,
  invalidDimensionsMode: InvalidDimensionsMode = "reject",
  onProgress?: (completed: number, total: number) => void,
  allowedColors?: InputColorPalette,
): Promise<ColorGridSetParseResult> {
  const preprocessed = resizeImageToTileMultiples(imageData, invalidDimensionsMode);
  const baseImageData = preprocessed.imageData;
  const validWidth = baseImageData.width > 0 && baseImageData.width % MAP_SIZE === 0;
  const validHeight = baseImageData.height > 0 && baseImageData.height % MAP_SIZE === 0;
  if (!validWidth || !validHeight) {
    return {
      imageData: baseImageData,
      tiles: [],
      tileRows: 0,
      tileCols: 0,
      paletteNotices: [
        ...preprocessed.paletteNotices,
        ...getInvalidDimensionNotices(baseImageData, customColors, autoFixInvalidColors, allowedColors),
      ],
      hasBlockingIssue: true,
    };
  }

  const tileCols = baseImageData.width / MAP_SIZE;
  const tileRows = baseImageData.height / MAP_SIZE;
  const totalTiles = tileCols * tileRows;
  if (totalTiles <= 1 || typeof Worker === "undefined") {
    const result = convertImageToColorGridSet(baseImageData, customColors, autoFixInvalidColors, "reject", allowedColors);
    return { ...result, paletteNotices: [...preprocessed.paletteNotices, ...result.paletteNotices] };
  }

  try {
    const workerResult = await parseColorGridTilesInWorkers(
      baseImageData,
      customColors,
      autoFixInvalidColors,
      tileRows,
      tileCols,
      onProgress,
      allowedColors,
    );

    return {
      imageData: workerResult.imageData,
      tiles: workerResult.tiles,
      tileRows,
      tileCols,
      paletteNotices: [...preprocessed.paletteNotices, ...aggregatePaletteNotices(workerResult.paletteNotices, baseImageData, workerResult.imageData)],
      hasBlockingIssue: workerResult.hasBlockingIssue,
    };
  } catch {
    // baseImageData was already resized above, so re-parsing must leave its dimensions alone.
    const fallback = convertImageToColorGridSet(baseImageData, customColors, autoFixInvalidColors, "reject", allowedColors);
    return {
      ...fallback,
      paletteNotices: [...preprocessed.paletteNotices, ...fallback.paletteNotices],
    };
  }
}
