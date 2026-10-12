/**
 * Public API:
 * - getCachedShapeFillerNeeds()
 * - getCachedShapeNooblineIsSingleY()
 * - getCachedShapeMaterialNeeds()
 * - cacheShapeMaterialNeeds()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { GeneratedShape } from "@/types/shape";
import {
  analyzeFillerNeeds,
  nooblineIsSingleY,
  type analyzeMaterialNeeds,
  type analyzeFragileSupportOverrideNeeds,
} from "@/lib/shapeAnalysis";

type ShapeMaterialNeeds = {
  materialNeedStats: ReturnType<typeof analyzeMaterialNeeds>;
  fragileSupportOverrideNeedStats: ReturnType<typeof analyzeFragileSupportOverrideNeeds> | null;
};

const MAX_MATERIAL_CACHE_ENTRIES = 8;
const fillerNeedStatsCache = new WeakMap<GeneratedShape, ReturnType<typeof analyzeFillerNeeds>>();
const northRowSingleLineCache = new WeakMap<GeneratedShape, boolean>();
// Retain recent palette/settings combinations without keeping discarded shapes alive.
const materialNeedsCache = new WeakMap<GeneratedShape, Map<string, ShapeMaterialNeeds>>();

export function getCachedShapeMaterialNeeds(shape: GeneratedShape, key: string): ShapeMaterialNeeds | undefined {
  const cache = materialNeedsCache.get(shape);
  const cached = cache?.get(key);
  if (cache && cached) {
    cache.delete(key);
    cache.set(key, cached);
  }
  return cached;
}

export function cacheShapeMaterialNeeds(shape: GeneratedShape, key: string, stats: ShapeMaterialNeeds): void {
  let cache = materialNeedsCache.get(shape);
  if (!cache) materialNeedsCache.set(shape, cache = new Map());
  cache.delete(key);
  cache.set(key, stats);
  if (cache.size <= MAX_MATERIAL_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

// Callers:
// - src/Index.tsx
export function getCachedShapeFillerNeeds(shape: GeneratedShape): ReturnType<typeof analyzeFillerNeeds> {
  const cached = fillerNeedStatsCache.get(shape);
  if (cached) return cached;
  const next = analyzeFillerNeeds(shape);
  fillerNeedStatsCache.set(shape, next);
  return next;
}

// Callers:
// - src/Index.tsx
export function getCachedShapeNooblineIsSingleY(shape: GeneratedShape): boolean {
  const cached = northRowSingleLineCache.get(shape);
  if (cached !== undefined) return cached;
  const next = nooblineIsSingleY(shape);
  northRowSingleLineCache.set(shape, next);
  return next;
}
