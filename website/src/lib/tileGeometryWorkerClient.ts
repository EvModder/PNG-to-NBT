/**
 * Public API:
 * - getTileBaseGeometry()
 * - getTileFinalGeometry()
 *
 * Callers:
 * - src/Index.tsx
 */
import { buildModeUsesLayerGap, isSuppressStepsBuildMode } from "@/utils/conversion";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { isTransparentColor } from "@/utils/color";
import { Shade } from "@/types/color";
import { FlatModeBehavior } from "./colorGridAnalysis";
import { createWorkerPool } from "@/utils/workerPool";
import type {
  TileBaseGeometryWorkerInput,
  TileBaseGeometryWorkerResult,
  TileFinalGeometryWorkerInput,
  TileFinalGeometryWorkerResult,
  TileGeometryWorkerRequest,
  TileWaterSetting,
} from "@/lib/tileGeometryWorkerTypes";

// Entry counts alone can retain gigabytes of dense geometry. Cells bound the
// retained history (not active UI results); Map.size avoids scanning block contents.
const MAX_CACHE_ENTRIES = 4096;
const MAX_CACHE_CELLS = 1_048_576;
const pool = createWorkerPool<Omit<TileGeometryWorkerRequest, "id">, TileBaseGeometryWorkerResult | TileFinalGeometryWorkerResult>(
  () => new Worker(new URL("./tileGeometry.worker.ts", import.meta.url), { type: "module" }),
);
type GeometryResult = TileBaseGeometryWorkerResult | TileFinalGeometryWorkerResult;
type GeometryJob<T> = { promise: Promise<T>; controller: AbortController; users: number };
const baseGeometryCache = createGeometryCache<TileBaseGeometryWorkerResult>();
const finalGeometryCache = createGeometryCache<TileFinalGeometryWorkerResult>();
const baseGeometryInflight = new Map<string, GeometryJob<TileBaseGeometryWorkerResult>>();
const finalGeometryInflight = new Map<string, GeometryJob<TileFinalGeometryWorkerResult>>();

function createGeometryCache<T extends GeometryResult>() {
  const entries = new Map<string, { value: T; size: number }>();
  // The UI keeps the shape map, not the worker response wrapper. Reuse a live
  // result after LRU eviction without pinning the map or relaxing the cell budget.
  const liveResults = new WeakMap<object, { key: string; value: T }>();
  let cells = 0;
  return {
    get(key: string, displayed?: object): T | undefined {
      const entry = entries.get(key);
      if (!entry) {
        const live = displayed && liveResults.get(displayed);
        return live?.key === key ? live.value : undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T): void {
      liveResults.set("baseShapeMap" in value ? value.baseShapeMap : value.shapeMap, { key, value });
      const shapes = "baseShapeMap" in value
        ? [...Object.values(value.baseShapeMap), value.baseNorthlineShape]
        : [...Object.values(value.shapeMap), value.northlineShape, value.supportShape];
      const parts = new Set(shapes.flatMap(shape => shape?.parts ?? []));
      const size = [...parts].reduce((sum, part) => sum + part.cells.size + 1, 1);
      if (size > MAX_CACHE_CELLS) return;
      const previous = entries.get(key);
      if (previous) { cells -= previous.size; entries.delete(key); }
      entries.set(key, { value, size });
      cells += size;
      while (entries.size > MAX_CACHE_ENTRIES || cells > MAX_CACHE_CELLS) {
        const [oldest, entry] = entries.entries().next().value!;
        cells -= entry.size;
        entries.delete(oldest);
      }
    },
  };
}

function getCachedGeometry<T extends GeometryResult>(
  cache: ReturnType<typeof createGeometryCache<T>>, inFlight: Map<string, GeometryJob<T>>, key: string,
  run: (signal: AbortSignal) => Promise<T>, onPending: () => void, signal?: AbortSignal, displayed?: object,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const cached = cache.get(key, displayed);
  if (cached) return Promise.resolve(cached);
  onPending();
  let job = inFlight.get(key);
  if (!job) {
    const controller = new AbortController();
    const next: GeometryJob<T> = { controller, users: 0, promise: run(controller.signal).then(result => {
      if (!controller.signal.aborted) cache.set(key, result);
      return result;
    }).finally(() => {
      if (inFlight.get(key) === next) inFlight.delete(key);
    }) };
    inFlight.set(key, job = next);
  }
  const pending = job;
  ++pending.users;
  if (!signal) return pending.promise;
  return new Promise((resolve, reject) => {
    const abort = () => {
      if (--pending.users === 0) {
        if (inFlight.get(key) === pending) inFlight.delete(key);
        pending.controller.abort(signal.reason);
      }
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.promise.then(result => {
      signal.removeEventListener("abort", abort);
      resolve(result);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

function serializeWaterSetting(waterSetting: TileWaterSetting): string {
  if (!waterSetting) return "";
  if (waterSetting.kind === "top-aligned") return "top";
  return `below:${waterSetting.drops.join(",")}`;
}

function runWorkerRequest(request: { type: "base"; input: TileBaseGeometryWorkerInput }, tileCacheKey: string, signal?: AbortSignal): Promise<TileBaseGeometryWorkerResult>;
function runWorkerRequest(request: { type: "final"; input: TileFinalGeometryWorkerInput }, tileCacheKey: string, signal?: AbortSignal): Promise<TileFinalGeometryWorkerResult>;
function runWorkerRequest(request:
  | { type: "base"; input: TileBaseGeometryWorkerInput }
  | { type: "final"; input: TileFinalGeometryWorkerInput },
  tileCacheKey: string,
  signal?: AbortSignal,
): Promise<TileBaseGeometryWorkerResult | TileFinalGeometryWorkerResult> {
  return pool.run({ ...request, tileCacheKey }, { affinity: request.input.colorGrid, signal });
}

function getTileBaseGeometryCacheKey(tileCacheKey: string, input: TileBaseGeometryWorkerInput): string {
  // The base pass only generates staircase shapes, so layer gap has no effect.
  const includesParty = !input.northlineOnly;
  return [
    tileCacheKey,
    input.northlineOnly ? 1 : 0,
    input.allSameShade ?? "",
    input.hasWater ? 1 : 0,
    input.hasTransparency ? 1 : 0,
    input.includeTransparentBlocks ? 1 : 0,
    serializeWaterSetting(input.waterSetting),
    input.flatModeBehavior,
    includesParty ? input.paletteSeed : 0,
    input.hasWater && !input.waterSetting && input.enableWaterConvenience ? 1 : 0,
  ].join("|");
}

function getTileFinalGeometryCacheKey(tileCacheKey: string, input: TileFinalGeometryWorkerInput): string {
  const twoLayer = buildModeUsesLayerGap(input.buildMode);
  const includesParty = input.collapseStaircaseModes || input.buildMode === BuildMode.StaircaseParty;
  const steps = isSuppressStepsBuildMode(input.buildMode);
  const independentStepSpacing = steps && !input.uniformSuppressStepSpacing;
  const mixSteps = steps && input.mixSteps;
  const raisedSteps = mixSteps && input.mixedStepMaxHeight > 0
    && (input.selectedStepDirection === SuppressStepDirection.EastToWest || input.selectedStepDirection === SuppressStepDirection.WestToEast);
  // Ignore inactive settings, especially the large palette key when no blocks can be raised.
  return [
    tileCacheKey,
    input.allSameShade ?? "",
    input.hasWater ? 1 : 0,
    input.hasTransparency ? 1 : 0,
    input.requiresTwoLayerLateShading ? 1 : 0,
    input.includeTransparentBlocks ? 1 : 0,
    serializeWaterSetting(input.waterSetting),
    input.buildAtWorldMinY ? 1 : 0,
    input.buildMode,
    input.isFlatShape ? 1 : 0,
    twoLayer ? input.layerGap : 0,
    input.buildMode === BuildMode.Suppress2LayerLatePairs ? input.suppress2LayerLatePairY : 0,
    twoLayer && input.useCrubTech ? 1 : 0,
    mixSteps ? 1 : 0,
    raisedSteps ? input.mixedStepMaxHeight : 0,
    raisedSteps ? input.mixedStepPalette?.key ?? "" : "",
    includesParty ? input.paletteSeed : 0,
    input.hasWater && !input.waterSetting && input.enableWaterConvenience ? 1 : 0,
    steps && input.skipEmptySuppressSteps ? 1 : 0,
    steps ? input.minSuppressStepOffset : "",
    independentStepSpacing ? 1 : 0,
    independentStepSpacing && input.keepSuppressExtras ? 1 : 0,
    input.collapseStaircaseModes ? 1 : 0,
    input.includeFlatNorthline ? 1 : 0,
    steps ? input.selectedStepDirection : "",
    steps && input.suppressCenterOut ? 1 : 0,
  ].join("|");
}

// Callers:
// - src/Index.tsx
export function getTileBaseGeometry(
  tileCacheKey: string,
  input: TileBaseGeometryWorkerInput,
  onPending: () => void,
  signal?: AbortSignal,
  displayed?: TileBaseGeometryWorkerResult["baseShapeMap"],
): Promise<TileBaseGeometryWorkerResult> {
  // Multi-tile suppression uses grid statistics for the dropdown. Only flatness
  // and the optional world-min-Y probe can require a Northline shape.
  if (input.northlineOnly && !signal?.aborted) {
    if (input.flatModeBehavior === FlatModeBehavior.Plain)
      return Promise.resolve({ baseShapeMap: {}, baseNorthlineShape: null, isFlatShape: true });
    if (!input.hasWater && input.flatModeBehavior === FlatModeBehavior.None && input.colorGrid.some(column =>
      column.some((cell, z) => z > 0 && cell.shade !== Shade.Flat && !isTransparentColor(cell)
        && !isTransparentColor(column[z - 1]))))
      return Promise.resolve({ baseShapeMap: {}, baseNorthlineShape: null, isFlatShape: false });
  }
  const cacheKey = getTileBaseGeometryCacheKey(tileCacheKey, input);
  return getCachedGeometry(baseGeometryCache, baseGeometryInflight, cacheKey,
    signal => runWorkerRequest({ type: "base", input }, tileCacheKey, signal), onPending, signal, displayed);
}

// Callers:
// - src/Index.tsx
export function getTileFinalGeometry(
  tileCacheKey: string,
  input: TileFinalGeometryWorkerInput,
  onPending: () => void,
  signal?: AbortSignal,
  displayed?: TileFinalGeometryWorkerResult["shapeMap"],
): Promise<TileFinalGeometryWorkerResult> {
  const cacheKey = getTileFinalGeometryCacheKey(tileCacheKey, input);
  return getCachedGeometry(finalGeometryCache, finalGeometryInflight, cacheKey,
    signal => runWorkerRequest({ type: "final", input }, tileCacheKey, signal), onPending, signal, displayed);
}
