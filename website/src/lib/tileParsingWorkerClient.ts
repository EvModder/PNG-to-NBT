/**
 * Public API:
 * - TileParsingWorkerAggregateResult
 * - parseColorGridTilesInWorkers()
 *
 * Callers:
 * - src/lib/colorGridParsing.ts
 */
import { cloneImageData } from "@/lib/colorGridParsingCore";
import type { PaletteNotice } from "@/lib/messages";
import type {
  TileParsingWorkerImagePatch,
  TileParsingWorkerRequest,
  TileParsingWorkerResponse,
  TileParsingWorkerResult,
  TileParsingWorkerTile,
  TileParsingWorkerTileResult,
} from "@/lib/tileParsingWorkerTypes";
import type { ColorRgbCustom } from "@/types/color";
import { MAP_SIZE } from "@/utils/color";

type WorkerSlot = {
  worker: Worker;
  inFlightCount: number;
};

type PendingRequest = {
  resolve: (value: TileParsingWorkerResult) => void;
  reject: (reason?: unknown) => void;
  slot: WorkerSlot;
  onProgressDelta?: (delta: number) => void;
  completed: number;
};

type TileBatch = {
  originX: number;
  originZ: number;
  width: number;
  height: number;
  tiles: TileParsingWorkerTile[];
};

// Callers:
// - src/lib/colorGridParsing.ts
export type TileParsingWorkerAggregateResult = {
  imageData: ImageData;
  tiles: TileParsingWorkerTileResult[];
  paletteNotices: PaletteNotice[];
  hasBlockingIssue: boolean;
};

const workerSlots: WorkerSlot[] = [];
const pendingRequests = new Map<number, PendingRequest>();
let nextRequestId = 1;

function createWorkerSlot(): WorkerSlot {
  const worker = new Worker(new URL("./tileParsing.worker.ts", import.meta.url), { type: "module" });
  const slot: WorkerSlot = { worker, inFlightCount: 0 };
  worker.onmessage = (event: MessageEvent<TileParsingWorkerResponse>) => {
    const pending = pendingRequests.get(event.data.id);
    if (!pending) return;
    if ("error" in event.data) {
      pendingRequests.delete(event.data.id);
      pending.slot.inFlightCount = Math.max(0, pending.slot.inFlightCount - 1);
      pending.reject(new Error(event.data.error));
      return;
    }
    if (event.data.type === "progress") {
      const delta = Math.max(0, event.data.completed - pending.completed);
      pending.completed = event.data.completed;
      if (delta > 0) pending.onProgressDelta?.(delta);
      return;
    }
    pendingRequests.delete(event.data.id);
    pending.slot.inFlightCount = Math.max(0, pending.slot.inFlightCount - 1);
    pending.resolve(event.data.result);
  };
  worker.onerror = event => {
    for (const [id, pending] of pendingRequests) {
      if (pending.slot !== slot) continue;
      pendingRequests.delete(id);
      pending.reject(event.error ?? new Error(event.message || "Tile parsing worker crashed"));
    }
    slot.inFlightCount = 0;
  };
  return slot;
}

function getWorkerSlots(): WorkerSlot[] {
  if (workerSlots.length > 0) return workerSlots;
  const hardwareConcurrency = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 2;
  const workerCount = Math.max(2, Math.min(4, (hardwareConcurrency || 2) - 1 || 2));
  for (let index = 0; index < workerCount; ++index) {
    workerSlots.push(createWorkerSlot());
  }
  return workerSlots;
}

function getLeastBusyWorkerSlot(): WorkerSlot {
  const slots = getWorkerSlots();
  let best = slots[0];
  for (let index = 1; index < slots.length; ++index) {
    if (slots[index].inFlightCount < best.inFlightCount) best = slots[index];
  }
  return best;
}

function runWorkerRequest(
  input: TileParsingWorkerRequest["input"],
  onProgressDelta?: (delta: number) => void,
): Promise<TileParsingWorkerResult> {
  const slot = getLeastBusyWorkerSlot();
  const id = nextRequestId++;
  slot.inFlightCount += 1;
  return new Promise<TileParsingWorkerResult>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve,
      reject,
      slot,
      onProgressDelta,
      completed: 0,
    });
    slot.worker.postMessage({ id, input } satisfies TileParsingWorkerRequest);
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

function extractImageRegionData(
  imageData: ImageData,
  left: number,
  top: number,
  width: number,
  height: number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const targetRowWidth = width * 4;

  for (let row = 0; row < height; ++row) {
    const sourceStart = ((top + row) * imageData.width + left) * 4;
    const sourceEnd = sourceStart + targetRowWidth;
    data.set(imageData.data.subarray(sourceStart, sourceEnd), row * targetRowWidth);
  }

  return new ImageData(data, width, height);
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
  customColors: ColorRgbCustom[],
  convertUnsupported: boolean,
  tileRows: number,
  tileCols: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<TileParsingWorkerAggregateResult> {
  const totalTiles = tileRows * tileCols;
  const workerCount = Math.min(getWorkerSlots().length, totalTiles);
  const tileBatches = buildTileBatches(tileRows, tileCols, workerCount);
  let completed = 0;

  const results = await Promise.all(tileBatches.map(batch =>
    runWorkerRequest(
      {
        imageData: extractImageRegionData(imageData, batch.originX, batch.originZ, batch.width, batch.height),
        originX: batch.originX,
        originZ: batch.originZ,
        customColors,
        convertUnsupported,
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
