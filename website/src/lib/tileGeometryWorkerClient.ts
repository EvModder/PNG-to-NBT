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
import { createWorkerPool } from "@/utils/workerPool";
import type {
  TileBaseGeometryWorkerInput,
  TileBaseGeometryWorkerResult,
  TileFinalGeometryWorkerInput,
  TileFinalGeometryWorkerResult,
  TileGeometryWorkerRequest,
  TileWaterSetting,
} from "@/lib/tileGeometryWorkerTypes";

// Large multi-tile images can exceed 512 tiles on their own, so a smaller cap defeats
// repeated-mode caching for exactly the workloads this client exists to accelerate.
const MAX_CACHE_ENTRIES = 4096;
const pool = createWorkerPool<Omit<TileGeometryWorkerRequest, "id">, TileBaseGeometryWorkerResult | TileFinalGeometryWorkerResult>(
  () => new Worker(new URL("./tileGeometry.worker.ts", import.meta.url), { type: "module" }),
);
const baseGeometryCache = new Map<string, TileBaseGeometryWorkerResult>();
const finalGeometryCache = new Map<string, TileFinalGeometryWorkerResult>();
const baseGeometryInflight = new Map<string, Promise<TileBaseGeometryWorkerResult>>();
const finalGeometryInflight = new Map<string, Promise<TileFinalGeometryWorkerResult>>();

function touchBoundedCache<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

function serializeWaterSetting(waterSetting: TileWaterSetting): string {
  if (!waterSetting) return "";
  if (waterSetting.kind === "top-aligned") return "top";
  return `below:${waterSetting.drops.join(",")}`;
}

function runWorkerRequest(request: { type: "base"; input: TileBaseGeometryWorkerInput }, tileCacheKey: string): Promise<TileBaseGeometryWorkerResult>;
function runWorkerRequest(request: { type: "final"; input: TileFinalGeometryWorkerInput }, tileCacheKey: string): Promise<TileFinalGeometryWorkerResult>;
function runWorkerRequest(request:
  | { type: "base"; input: TileBaseGeometryWorkerInput }
  | { type: "final"; input: TileFinalGeometryWorkerInput },
  tileCacheKey: string,
): Promise<TileBaseGeometryWorkerResult | TileFinalGeometryWorkerResult> {
  return pool.run({ ...request, tileCacheKey }, { affinity: request.input.colorGrid });
}

function getTileBaseGeometryCacheKey(tileCacheKey: string, input: TileBaseGeometryWorkerInput): string {
  // The base pass only generates staircase shapes, so layer gap has no effect.
  return [
    tileCacheKey,
    input.allSameShade ?? "",
    input.hasWater ? 1 : 0,
    input.hasTransparency ? 1 : 0,
    input.includeTransparentBlocks ? 1 : 0,
    serializeWaterSetting(input.waterSetting),
    input.flatModeBehavior,
    input.paletteSeed,
    input.enableWaterConvenience ? 1 : 0,
  ].join("|");
}

function getTileFinalGeometryCacheKey(tileCacheKey: string, input: TileFinalGeometryWorkerInput): string {
  const twoLayer = buildModeUsesLayerGap(input.buildMode);
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
    input.paletteSeed,
    input.enableWaterConvenience ? 1 : 0,
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
): Promise<TileBaseGeometryWorkerResult> {
  const cacheKey = getTileBaseGeometryCacheKey(tileCacheKey, input);
  const cached = baseGeometryCache.get(cacheKey);
  if (cached) {
    touchBoundedCache(baseGeometryCache, cacheKey, cached);
    return Promise.resolve(cached);
  }
  onPending();
  const inFlight = baseGeometryInflight.get(cacheKey);
  if (inFlight) return inFlight;
  const next = runWorkerRequest({ type: "base", input }, tileCacheKey)
    .then(result => {
      baseGeometryInflight.delete(cacheKey);
      touchBoundedCache(baseGeometryCache, cacheKey, result);
      return result;
    })
    .catch(error => {
      baseGeometryInflight.delete(cacheKey);
      throw error;
    });
  baseGeometryInflight.set(cacheKey, next);
  return next;
}

// Callers:
// - src/Index.tsx
export function getTileFinalGeometry(
  tileCacheKey: string,
  input: TileFinalGeometryWorkerInput,
  onPending: () => void,
): Promise<TileFinalGeometryWorkerResult> {
  const cacheKey = getTileFinalGeometryCacheKey(tileCacheKey, input);
  const cached = finalGeometryCache.get(cacheKey);
  if (cached) {
    touchBoundedCache(finalGeometryCache, cacheKey, cached);
    return Promise.resolve(cached);
  }
  onPending();
  const inFlight = finalGeometryInflight.get(cacheKey);
  if (inFlight) return inFlight;
  const next = runWorkerRequest({ type: "final", input }, tileCacheKey)
    .then(result => {
      finalGeometryInflight.delete(cacheKey);
      touchBoundedCache(finalGeometryCache, cacheKey, result);
      return result;
    })
    .catch(error => {
      finalGeometryInflight.delete(cacheKey);
      throw error;
    });
  finalGeometryInflight.set(cacheKey, next);
  return next;
}
