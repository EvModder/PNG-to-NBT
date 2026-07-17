/**
 * Public API:
 * - ParsedColorGridTile
 * - ColorGridSetParseResult
 * - convertImageToColorGrid()
 * - convertImageToColorGridSet()
 * - loadImageDataFromFile()
 * - convertImageToColorGridSetAsync()
 *
 * Callers:
 * - src/Index.tsx
 */
import * as UTIF from "utif";
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

function maybeCropImageToTileMultiples(imageData: ImageData, cropImage: boolean): ImagePreprocessResult {
  if (!cropImage) return { imageData, paletteNotices: [] };

  const targetWidth = imageData.width - (imageData.width % MAP_SIZE);
  const targetHeight = imageData.height - (imageData.height % MAP_SIZE);
  const shouldCrop =
    (targetWidth !== imageData.width || targetHeight !== imageData.height) &&
    targetWidth >= MAP_SIZE &&
    targetHeight >= MAP_SIZE;

  if (!shouldCrop) return { imageData, paletteNotices: [] };

  const left = Math.floor((imageData.width - targetWidth) / 2);
  const top = Math.floor((imageData.height - targetHeight) / 2);
  const right = imageData.width - targetWidth - left;
  const bottom = imageData.height - targetHeight - top;

  return {
    imageData: cropImageData(imageData, left, top, targetWidth, targetHeight),
    paletteNotices: [
      messages.parsing.croppedImageNotice(targetWidth, targetHeight),
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
  cropImage = false,
): ColorGridParseResult {
  const preprocessed = maybeCropImageToTileMultiples(imageData, cropImage);
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
  cropImage = false,
): ColorGridSetParseResult {
  const preprocessed = maybeCropImageToTileMultiples(imageData, cropImage);
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
  cropImage = false,
  onProgress?: (completed: number, total: number) => void,
): Promise<ColorGridSetParseResult> {
  const preprocessed = maybeCropImageToTileMultiples(imageData, cropImage);
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
    return convertImageToColorGridSet(imageData, customColors, convertUnsupported, cropImage);
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
    const fallback = convertImageToColorGridSet(baseImageData, customColors, convertUnsupported, false);
    return {
      ...fallback,
      paletteNotices: [...preprocessed.paletteNotices, ...fallback.paletteNotices],
    };
  }
}
