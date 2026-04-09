/**
 * Public API:
 * - TileParsingWorkerTile
 * - TileParsingWorkerTileResult
 * - TileParsingWorkerImagePatch
 * - TileParsingWorkerInput
 * - TileParsingWorkerResult
 * - TileParsingWorkerRequest
 * - TileParsingWorkerResponse
 *
 * Callers:
 * - src/lib/tileParsing.worker.ts
 * - src/lib/tileParsingWorkerClient.ts
 */
import type { PaletteNotice } from "@/lib/messages";
import type { ColorGridStats } from "@/lib/colorGridAnalysis";
import type { ColorGrid, ColorRgbCustom } from "@/types/color";

// Callers:
// - src/lib/tileParsing.worker.ts
// - src/lib/tileParsingWorkerClient.ts
export type TileParsingWorkerTile = {
  row: number;
  col: number;
  startX: number;
  startZ: number;
};

// Callers:
// - src/lib/tileParsing.worker.ts
// - src/lib/tileParsingWorkerClient.ts
export type TileParsingWorkerTileResult = {
  row: number;
  col: number;
  startX: number;
  startZ: number;
  colorGrid: ColorGrid;
  imageStats: ColorGridStats;
  cacheKey: string;
};

// Callers:
// - src/lib/tileParsing.worker.ts
// - src/lib/tileParsingWorkerClient.ts
export type TileParsingWorkerImagePatch = {
  startX: number;
  startZ: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

// Callers:
// - src/lib/tileParsing.worker.ts
// - src/lib/tileParsingWorkerClient.ts
export type TileParsingWorkerInput = {
  imageData: ImageData;
  originX: number;
  originZ: number;
  customColors: ColorRgbCustom[];
  convertUnsupported: boolean;
  tiles: TileParsingWorkerTile[];
};

// Callers:
// - src/lib/tileParsing.worker.ts
// - src/lib/tileParsingWorkerClient.ts
export type TileParsingWorkerResult = {
  tiles: TileParsingWorkerTileResult[];
  paletteNotices: PaletteNotice[];
  hasBlockingIssue: boolean;
  imagePatches: TileParsingWorkerImagePatch[];
};

// Callers:
// - src/lib/tileParsing.worker.ts
// - src/lib/tileParsingWorkerClient.ts
export type TileParsingWorkerRequest = {
  id: number;
  input: TileParsingWorkerInput;
};

// Callers:
// - src/lib/tileParsing.worker.ts
// - src/lib/tileParsingWorkerClient.ts
export type TileParsingWorkerResponse =
  | { id: number; type: "progress"; completed: number }
  | { id: number; type: "result"; result: TileParsingWorkerResult }
  | { id: number; error: string };
