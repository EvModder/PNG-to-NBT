/**
 * Public API:
 * - parseColorGridTilesInWorkers()
 *
 * Callers:
 * - src/lib/colorGridParsing.ts
 */
import { cloneImageData, extractImageRegionPixels } from "@/lib/colorGridParsingCore";
import type { PaletteNotice } from "@/lib/messages";
import type {
  TileParsingWorkerImagePatch,
  TileParsingWorkerRequest,
  TileParsingWorkerResult,
  TileParsingWorkerTile,
  TileParsingWorkerTileResult,
} from "@/lib/tileParsingWorkerTypes";
import type { ColorRgb } from "@/types/color";
import { MAP_SIZE } from "@/utils/color";
import type { InputColorPalette } from "@/lib/colorGridParsingCore";
import { createWorkerPool } from "@/utils/workerPool";

type TileBatch = {
  originX: number;
  originZ: number;
  width: number;
  height: number;
  tiles: TileParsingWorkerTile[];
};

type TileParsingWorkerAggregateResult = {
  imageData: ImageData;
  tiles: TileParsingWorkerTileResult[];
  paletteNotices: PaletteNotice[];
  hasBlockingIssue: boolean;
};

const pool = createWorkerPool<Omit<TileParsingWorkerRequest, "id">, TileParsingWorkerResult>(
  () => new Worker(new URL("./tileParsing.worker.ts", import.meta.url), { type: "module" }),
);

function runWorkerRequest(
  input: TileParsingWorkerRequest["input"],
  onProgressDelta?: (delta: number) => void,
): Promise<TileParsingWorkerResult> {
  let completed = 0;
  // Each request owns an extracted batch; the source image remains available for fallback.
  return pool.run({ input }, {
    transfer: [input.imageData.data.buffer],
    onProgress: next => {
      const delta = Math.max(0, next - completed);
      completed = next;
      if (delta > 0) onProgressDelta?.(delta);
    },
  });
}

function applyImagePatch(imageData: ImageData, patch: TileParsingWorkerImagePatch): void {
  const targetRowWidth = patch.width * 4;
  for (let row = 0; row < patch.height; ++row) {
    const sourceStart = row * targetRowWidth;
    const sourceEnd = sourceStart + targetRowWidth;
    const targetStart = ((patch.startZ + row) * imageData.width + patch.startX) * 4;
    imageData.data.set(patch.data.subarray(sourceStart, sourceEnd), targetStart);
  }
}

function buildTileBatches(tileRows: number, tileCols: number, batchCount: number): TileBatch[] {
  if (tileRows <= 0 || tileCols <= 0 || batchCount <= 0) return [];

  const partitionByColumns = tileCols >= tileRows;
  const totalBands = partitionByColumns ? tileCols : tileRows;
  const bandCount = Math.min(batchCount, totalBands);
  const batches: TileBatch[] = [];

  for (let batchIndex = 0; batchIndex < bandCount; ++batchIndex) {
    const startBand = Math.floor((batchIndex * totalBands) / bandCount);
    const endBand = Math.floor(((batchIndex + 1) * totalBands) / bandCount);
    if (endBand <= startBand) continue;

    const originX = partitionByColumns ? startBand * MAP_SIZE : 0;
    const originZ = partitionByColumns ? 0 : startBand * MAP_SIZE;
    const width = (partitionByColumns ? (endBand - startBand) : tileCols) * MAP_SIZE;
    const height = (partitionByColumns ? tileRows : (endBand - startBand)) * MAP_SIZE;
    const tiles: TileParsingWorkerTile[] = [];

    if (partitionByColumns) {
      for (let row = 0; row < tileRows; ++row) {
        for (let col = startBand; col < endBand; ++col) {
          tiles.push({
            row,
            col,
            startX: col * MAP_SIZE,
            startZ: row * MAP_SIZE,
          });
        }
      }
    } else {
      for (let row = startBand; row < endBand; ++row) {
        for (let col = 0; col < tileCols; ++col) {
          tiles.push({
            row,
            col,
            startX: col * MAP_SIZE,
            startZ: row * MAP_SIZE,
          });
        }
      }
    }

    batches.push({ originX, originZ, width, height, tiles });
  }

  return batches;
}

// Callers:
// - src/lib/colorGridParsing.ts
export async function parseColorGridTilesInWorkers(
  imageData: ImageData,
  customColors: ColorRgb[],
  autoFixInvalidColors: boolean,
  tileRows: number,
  tileCols: number,
  onProgress?: (completed: number, total: number) => void,
  allowedColors?: InputColorPalette,
): Promise<TileParsingWorkerAggregateResult> {
  const totalTiles = tileRows * tileCols;
  const workerCount = Math.min(pool.size, totalTiles);
  const tileBatches = buildTileBatches(tileRows, tileCols, workerCount);
  let completed = 0;

  const results = await Promise.all(tileBatches.map(batch =>
    runWorkerRequest(
      {
        imageData: new ImageData(extractImageRegionPixels(imageData, batch.originX, batch.originZ, batch.width, batch.height), batch.width, batch.height),
        originX: batch.originX,
        originZ: batch.originZ,
        customColors,
        autoFixInvalidColors,
        allowedColors,
        tiles: batch.tiles,
      },
      delta => {
        completed += delta;
        onProgress?.(completed, totalTiles);
      },
    ),
  ));

  let workingImageData = imageData;
  const tiles: TileParsingWorkerTileResult[] = [];
  const paletteNotices: PaletteNotice[] = [];
  let hasBlockingIssue = false;

  for (const result of results) {
    tiles.push(...result.tiles);
    paletteNotices.push(...result.paletteNotices);
    hasBlockingIssue ||= result.hasBlockingIssue;
    if (result.imagePatches.length > 0 && workingImageData === imageData) {
      workingImageData = cloneImageData(imageData);
    }
    if (workingImageData !== imageData) {
      for (const patch of result.imagePatches) {
        applyImagePatch(workingImageData, patch);
      }
    }
  }

  tiles.sort((a, b) => (a.row - b.row) || (a.col - b.col));

  return {
    imageData: workingImageData,
    tiles,
    paletteNotices,
    hasBlockingIssue,
  };
}
