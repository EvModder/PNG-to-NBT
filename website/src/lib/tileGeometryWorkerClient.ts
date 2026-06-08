/**
 * Public API:
 * - getTileBaseGeometry()
 * - getTileFinalGeometry()
 *
 * Callers:
 * - src/Index.tsx
 */
import type {
  TileBaseGeometryWorkerInput,
  TileBaseGeometryWorkerResult,
  TileFinalGeometryWorkerInput,
  TileFinalGeometryWorkerResult,
  TileGeometryWorkerRequest,
  TileGeometryWorkerResponse,
  TileWaterSetting,
} from "@/lib/tileGeometryWorkerTypes";

type WorkerSlot = {
  worker: Worker;
  inFlightCount: number;
};

// Large multi-tile images can exceed 512 tiles on their own, so a smaller cap defeats
// repeated-mode caching for exactly the workloads this client exists to accelerate.
const MAX_CACHE_ENTRIES = 4096;
const workerSlots: WorkerSlot[] = [];
const pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (reason?: unknown) => void; slot: WorkerSlot }>();
const baseGeometryCache = new Map<string, TileBaseGeometryWorkerResult>();
const finalGeometryCache = new Map<string, TileFinalGeometryWorkerResult>();
const baseGeometryInflight = new Map<string, Promise<TileBaseGeometryWorkerResult>>();
const finalGeometryInflight = new Map<string, Promise<TileFinalGeometryWorkerResult>>();
let nextRequestId = 1;

function touchBoundedCache<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

function serializeWaterDrops(drops: readonly [number, number, number] | undefined): string {
  return drops ? `${drops[0]},${drops[1]},${drops[2]}` : "";
}

function serializeWaterSetting(waterSetting: TileWaterSetting): string {
  if (!waterSetting) return "";
  if (waterSetting.kind === "top-aligned") return "top";
  return `below:${serializeWaterDrops(waterSetting.drops)}`;
}

function createWorkerSlot(): WorkerSlot {
  const worker = new Worker(new URL("./tileGeometry.worker.ts", import.meta.url), { type: "module" });
  const slot: WorkerSlot = { worker, inFlightCount: 0 };
  worker.onmessage = (event: MessageEvent<TileGeometryWorkerResponse>) => {
    const pending = pendingRequests.get(event.data.id);
    if (!pending) return;
    pendingRequests.delete(event.data.id);
    pending.slot.inFlightCount = Math.max(0, pending.slot.inFlightCount - 1);
    if ("error" in event.data) {
      pending.reject(new Error(event.data.error));
      return;
    }
    pending.resolve(event.data.result);
  };
  worker.onerror = event => {
    for (const [id, pending] of pendingRequests) {
      if (pending.slot !== slot) continue;
      pendingRequests.delete(id);
      pending.reject(event.error ?? new Error(event.message || "Tile geometry worker crashed"));
    }
    slot.inFlightCount = 0;
  };
  return slot;
}

function getWorkerSlots(): WorkerSlot[] {
  if (workerSlots.length > 0) return workerSlots;
  const hardwareConcurrency = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 2;
  const workerCount = Math.max(2, Math.min(4, (hardwareConcurrency || 2) - 1 || 2));
  for (let i = 0; i < workerCount; ++i) workerSlots.push(createWorkerSlot());
  return workerSlots;
}

function getLeastBusyWorkerSlot(): WorkerSlot {
  const slots = getWorkerSlots();
  let best = slots[0];
  for (let i = 1; i < slots.length; ++i) {
    if (slots[i].inFlightCount < best.inFlightCount) best = slots[i];
  }
  return best;
}

function runWorkerRequest<Result>(request: Omit<TileGeometryWorkerRequest, "id">): Promise<Result> {
  const slot = getLeastBusyWorkerSlot();
  const id = nextRequestId++;
  slot.inFlightCount += 1;
  return new Promise<Result>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject, slot });
    if (request.type === "base") {
      slot.worker.postMessage({ ...(request as Extract<TileGeometryWorkerRequest, { type: "base" }>), id });
    } else {
      slot.worker.postMessage({ ...(request as Extract<TileGeometryWorkerRequest, { type: "final" }>), id });
    }
  });
}

function getTileBaseGeometryCacheKey(tileCacheKey: string, input: TileBaseGeometryWorkerInput): string {
  return [
    tileCacheKey,
    input.allSameShade ?? "",
    input.hasWater ? 1 : 0,
    input.hasTransparency ? 1 : 0,
    input.includeTransparentBlocks ? 1 : 0,
    serializeWaterSetting(input.waterSetting),
    input.flatModeBehavior,
    input.layerGap,
    input.paletteSeed,
    input.enableWaterConvenience ? 1 : 0,
  ].join("|");
}

function getTileFinalGeometryCacheKey(tileCacheKey: string, input: TileFinalGeometryWorkerInput): string {
  return [
    tileCacheKey,
    input.allSameShade ?? "",
    input.hasWater ? 1 : 0,
    input.hasTransparency ? 1 : 0,
    input.hasTwoLayerLateVoidNeed ? 1 : 0,
    input.includeTransparentBlocks ? 1 : 0,
    serializeWaterSetting(input.waterSetting),
    input.flatModeBehavior,
    input.buildAtWorldMinY ? 1 : 0,
    input.buildMode,
    input.isFlatShape ? 1 : 0,
    input.layerGap,
    input.suppress2LayerLatePairY,
    input.useCrubTech ? 1 : 0,
    input.mixSteps ? 1 : 0,
    input.paletteSeed,
    input.enableWaterConvenience ? 1 : 0,
    input.skipEmptySuppressSteps ? 1 : 0,
    input.collapseStaircaseModes ? 1 : 0,
    input.includeFlatNorthline ? 1 : 0,
    input.selectedStepDirection,
  ].join("|");
}

// Callers:
// - src/Index.tsx
export function getTileBaseGeometry(
  tileCacheKey: string,
  input: TileBaseGeometryWorkerInput,
): Promise<TileBaseGeometryWorkerResult> {
  const cacheKey = getTileBaseGeometryCacheKey(tileCacheKey, input);
  const cached = baseGeometryCache.get(cacheKey);
  if (cached) {
    touchBoundedCache(baseGeometryCache, cacheKey, cached);
    return Promise.resolve(cached);
  }
  const inFlight = baseGeometryInflight.get(cacheKey);
  if (inFlight) return inFlight;
  const next = runWorkerRequest<TileBaseGeometryWorkerResult>({ type: "base", input })
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
): Promise<TileFinalGeometryWorkerResult> {
  const cacheKey = getTileFinalGeometryCacheKey(tileCacheKey, input);
  const cached = finalGeometryCache.get(cacheKey);
  if (cached) {
    touchBoundedCache(finalGeometryCache, cacheKey, cached);
    return Promise.resolve(cached);
  }
  const inFlight = finalGeometryInflight.get(cacheKey);
  if (inFlight) return inFlight;
  const next = runWorkerRequest<TileFinalGeometryWorkerResult>({ type: "final", input })
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
