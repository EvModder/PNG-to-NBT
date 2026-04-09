/// <reference lib="WebWorker" />

/**
 * Public API:
 * - none
 *
 * Callers:
 * - src/lib/tileParsingWorkerClient.ts
 */
import { MAP_SIZE } from "@/utils/color";
import {
  buildConversionNotices,
  buildCustomShadeLookup,
  convertUnsupportedRegionToNearestBasePalette,
  getBaseColorLookup,
  scanImageRegionToColorGrid,
} from "@/lib/colorGridParsingCore";
import type {
  TileParsingWorkerImagePatch,
  TileParsingWorkerRequest,
  TileParsingWorkerResponse,
  TileParsingWorkerResult,
  TileParsingWorkerTileResult,
} from "@/lib/tileParsingWorkerTypes";
import { messages } from "@/lib/messages";

function extractImagePatch(
  imageData: ImageData,
  startX: number,
  startZ: number,
  absoluteStartX: number,
  absoluteStartZ: number,
): TileParsingWorkerImagePatch {
  const data = new Uint8ClampedArray(MAP_SIZE * MAP_SIZE * 4);
  const rowWidth = MAP_SIZE * 4;

  for (let row = 0; row < MAP_SIZE; ++row) {
    const sourceStart = ((startZ + row) * imageData.width + startX) * 4;
    const sourceEnd = sourceStart + rowWidth;
    data.set(imageData.data.subarray(sourceStart, sourceEnd), row * rowWidth);
  }

  return {
    startX: absoluteStartX,
    startZ: absoluteStartZ,
    width: MAP_SIZE,
    height: MAP_SIZE,
    data,
  };
}

function parseAssignedTiles(message: TileParsingWorkerRequest): TileParsingWorkerResult {
  const { imageData, originX, originZ, customColors, convertUnsupported, tiles } = message.input;
  const baseLookup = getBaseColorLookup();
  const customLookup = buildCustomShadeLookup(customColors);
  const tileResults: TileParsingWorkerTileResult[] = [];
  const paletteNotices = [];
  const imagePatches: TileParsingWorkerImagePatch[] = [];
  let hasBlockingIssue = false;

  for (let index = 0; index < tiles.length; ++index) {
    const tile = tiles[index];
    const localStartX = tile.startX - originX;
    const localStartZ = tile.startZ - originZ;
    let analysis = scanImageRegionToColorGrid(imageData, localStartX, localStartZ, baseLookup, customLookup);
    let tileHasBlockingIssue = analysis.unsupportedColors.length > 0;

    if (analysis.unsupportedColors.length > 0 && convertUnsupported) {
      const conversionSummary = convertUnsupportedRegionToNearestBasePalette(
        imageData,
        localStartX,
        localStartZ,
        baseLookup,
      );
      analysis = scanImageRegionToColorGrid(imageData, localStartX, localStartZ, baseLookup, customLookup);
      if (analysis.unsupportedColors.length === 0) {
        paletteNotices.push(
          ...buildConversionNotices(
            conversionSummary.convertedCount,
            conversionSummary.totalInputColorCount,
            conversionSummary.fewerOutputColorCount,
          ),
        );
        imagePatches.push(extractImagePatch(imageData, localStartX, localStartZ, tile.startX, tile.startZ));
        tileHasBlockingIssue = false;
      } else {
        paletteNotices.push(messages.parsing.unsupportedPaletteColorsNotice(analysis.unsupportedColors));
      }
    } else if (analysis.unsupportedColors.length > 0) {
      paletteNotices.push(messages.parsing.unsupportedPaletteColorsNotice(analysis.unsupportedColors));
    }

    tileResults.push({
      row: tile.row,
      col: tile.col,
      startX: tile.startX,
      startZ: tile.startZ,
      colorGrid: analysis.colorGrid,
      imageStats: analysis.imageStats,
      cacheKey: analysis.cacheKey,
    });
    hasBlockingIssue ||= tileHasBlockingIssue;

    self.postMessage({
      id: message.id,
      type: "progress",
      completed: index + 1,
    } satisfies TileParsingWorkerResponse);
  }

  return {
    tiles: tileResults,
    paletteNotices,
    hasBlockingIssue,
    imagePatches,
  };
}

self.onmessage = (event: MessageEvent<TileParsingWorkerRequest>) => {
  const message = event.data;
  try {
    self.postMessage({
      id: message.id,
      type: "result",
      result: parseAssignedTiles(message),
    } satisfies TileParsingWorkerResponse);
  } catch (error) {
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : messages.parsing.conversionFailed,
    } satisfies TileParsingWorkerResponse);
  }
};

export {};
