/// <reference lib="WebWorker" />

/**
 * Public API:
 * - none
 *
 * Callers: src/lib/tileGeometryWorkerClient.ts
 */
import { analyzeBaseGeometry, analyzeFinalGeometry } from "./tileGeometry";
import type { TileGeometryWorkerRequest, TileGeometryWorkerResponse } from "./tileGeometryWorkerTypes";
import type { ColorGrid } from "@/types/color";

// Preserve identity for nearby setting changes, but don't retain every image or
// an unbounded history of shape variants inside each worker.
let recent: { key: string; grid: ColorGrid; uses: number } | undefined;

self.onmessage = (event: MessageEvent<TileGeometryWorkerRequest>) => {
  const message = event.data;
  try {
    if (recent?.key !== message.tileCacheKey || recent.uses >= 4) {
      recent = { key: message.tileCacheKey, grid: message.input.colorGrid, uses: 0 };
    }
    message.input.colorGrid = recent.grid;
    ++recent.uses;
    const response: TileGeometryWorkerResponse = message.type === "base"
      ? { id: message.id, type: "base", result: analyzeBaseGeometry(message.input) }
      : { id: message.id, type: "final", result: analyzeFinalGeometry(message.input) };
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : "Tile geometry worker failed",
    } satisfies TileGeometryWorkerResponse);
  }
};

export {};
