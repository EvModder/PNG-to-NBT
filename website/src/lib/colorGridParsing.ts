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
import { type InvalidDimensionsMode } from "@/data/defaultSettings";
import { messages, PaletteNoticeKind, type PaletteNotice } from "@/lib/messages";
import { MAP_SIZE } from "@/utils/color";
import { type ColorGrid, type ColorRgb } from "@/types/color";
import { type ColorGridStats } from "@/lib/colorGridAnalysis";
import {
  buildConversionNotices,
  buildCustomShadeLookup,
  cloneImageData,
  convertUnsupportedRegionToNearestPalette,
  convertUnsupportedToNearestPalette,
  createEmptyColorGrid,
  getBaseColorLookup,
  scanImageRegionToColorGrid,
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

function aggregatePaletteNotices(tileNotices: readonly PaletteNotice[]): PaletteNotice[] {
  let sizeError: PaletteNotice | null = null;
  const unsupportedColors = new Set<number>();
  let convertedCount = 0;
  let totalInputColorCount = 0;
  let fewerOutputColorCount = 0;
  const freeformNotices: PaletteNotice[] = [];
  const lossyFormatNotices: PaletteNotice[] = [];

  for (const notice of tileNotices) {
    switch (notice.kind) {
      case PaletteNoticeKind.SizeError:
        sizeError ??= notice;
        break;
      case PaletteNoticeKind.UnsupportedPaletteColors:
        for (const color of notice.colors) unsupportedColors.add(color);
        break;
      case PaletteNoticeKind.ConvertedPaletteColors:
        convertedCount += notice.convertedCount;
        totalInputColorCount += notice.totalInputColorCount;
        break;
      case PaletteNoticeKind.ReducedUniqueColors:
        fewerOutputColorCount += notice.fewerOutputColorCount;
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
  if (unsupportedColors.size > 0) notices.push(messages.parsing.unsupportedPaletteColorsNotice([...unsupportedColors]));
  if (convertedCount > 0) {
    notices.push(messages.parsing.convertedPaletteColorsNotice(convertedCount, totalInputColorCount));
    if (fewerOutputColorCount > 0) notices.push(messages.parsing.reducedUniqueColorsNotice(fewerOutputColorCount));
  }
  notices.push(...lossyFormatNotices, ...freeformNotices);
  return notices;
}

export function convertImageToColorGrid(
  imageData: ImageData,
  customColors: ColorRgb[],
  convertUnsupported = false,
  invalidDimensionsMode: InvalidDimensionsMode = "reject",
): ColorGridParseResult {
  const preprocessed = resizeImageToTileMultiples(imageData, invalidDimensionsMode);
  const workingImageData = preprocessed.imageData;
  const baseLookup = getBaseColorLookup();
  const customLookup = buildCustomShadeLookup(customColors);
  const hasSizeError = workingImageData.width !== MAP_SIZE || workingImageData.height !== MAP_SIZE;

  if (hasSizeError) {
    return {
      imageData: workingImageData,
      colorGrid: createEmptyColorGrid(),
      paletteNotices: [
        ...preprocessed.paletteNotices,
        messages.parsing.imageSizeNotice(workingImageData.width, workingImageData.height),
      ],
      hasBlockingIssue: true,
    };
  }

  const initial = scanImageRegionToColorGrid(workingImageData, 0, 0, baseLookup, customLookup);
  if (initial.unsupportedColors.length === 0 || !convertUnsupported) {
    return {
      imageData: workingImageData,
      colorGrid: initial.colorGrid,
      paletteNotices: initial.unsupportedColors.length > 0
        ? [...preprocessed.paletteNotices, messages.parsing.unsupportedPaletteColorsNotice(initial.unsupportedColors)]
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
        ? buildConversionNotices(
            conversionSummary.convertedCount,
            conversionSummary.totalInputColorCount,
            conversionSummary.fewerOutputColorCount,
          )
        : [messages.parsing.unsupportedPaletteColorsNotice(converted.unsupportedColors)]),
    ],
    hasBlockingIssue: converted.unsupportedColors.length > 0,
  };
}

// Callers:
// - src/Index.tsx
export function convertImageToColorGridSet(
  imageData: ImageData,
  customColors: ColorRgb[],
  convertUnsupported = false,
  invalidDimensionsMode: InvalidDimensionsMode = "reject",
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
        messages.parsing.imageSizeNotice(baseImageData.width, baseImageData.height),
      ],
      hasBlockingIssue: true,
    };
  }

  const tileCols = baseImageData.width / MAP_SIZE;
  const tileRows = baseImageData.height / MAP_SIZE;
  const baseLookup = getBaseColorLookup();
  const customLookup = buildCustomShadeLookup(customColors);
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
      if (analysis.unsupportedColors.length > 0 && convertUnsupported) {
        const conversionSummary = convertUnsupportedRegionToNearestPalette(
          ensureWorkingImageData(),
          startX,
          startZ,
          baseLookup,
          customLookup,
        );
        analysis = scanImageRegionToColorGrid(workingImageData, startX, startZ, baseLookup, customLookup);
        if (analysis.unsupportedColors.length === 0) {
          paletteNotices = buildConversionNotices(
            conversionSummary.convertedCount,
            conversionSummary.totalInputColorCount,
            conversionSummary.fewerOutputColorCount,
          );
          tileHasBlockingIssue = false;
        } else {
          paletteNotices = [messages.parsing.unsupportedPaletteColorsNotice(analysis.unsupportedColors)];
        }
      } else if (analysis.unsupportedColors.length > 0) {
        paletteNotices = [messages.parsing.unsupportedPaletteColorsNotice(analysis.unsupportedColors)];
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
    paletteNotices: [...preprocessed.paletteNotices, ...aggregatePaletteNotices(tileNotices)],
    hasBlockingIssue,
  };
}

// Callers:
// - src/Index.tsx
export async function convertImageToColorGridSetAsync(
  imageData: ImageData,
  customColors: ColorRgb[],
  convertUnsupported = false,
  invalidDimensionsMode: InvalidDimensionsMode = "reject",
  onProgress?: (completed: number, total: number) => void,
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
        messages.parsing.imageSizeNotice(baseImageData.width, baseImageData.height),
      ],
      hasBlockingIssue: true,
    };
  }

  const tileCols = baseImageData.width / MAP_SIZE;
  const tileRows = baseImageData.height / MAP_SIZE;
  const totalTiles = tileCols * tileRows;
  if (totalTiles <= 1 || typeof Worker === "undefined") {
    const result = convertImageToColorGridSet(baseImageData, customColors, convertUnsupported);
    return { ...result, paletteNotices: [...preprocessed.paletteNotices, ...result.paletteNotices] };
  }

  try {
    const workerResult = await parseColorGridTilesInWorkers(
      baseImageData,
      customColors,
      convertUnsupported,
      tileRows,
      tileCols,
      onProgress,
    );

    return {
      imageData: workerResult.imageData,
      tiles: workerResult.tiles,
      tileRows,
      tileCols,
      paletteNotices: [...preprocessed.paletteNotices, ...aggregatePaletteNotices(workerResult.paletteNotices)],
      hasBlockingIssue: workerResult.hasBlockingIssue,
    };
  } catch {
    // baseImageData was already resized above, so re-parsing must leave its dimensions alone.
    const fallback = convertImageToColorGridSet(baseImageData, customColors, convertUnsupported, "reject");
    return {
      ...fallback,
      paletteNotices: [...preprocessed.paletteNotices, ...fallback.paletteNotices],
    };
  }
}
