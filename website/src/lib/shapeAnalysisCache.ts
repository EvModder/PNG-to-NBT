/**
 * Public API:
 * - getCachedShapeFillerNeeds()
 * - getCachedShapeNooblineIsSingleY()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { GeneratedShape } from "@/types/shape";
import { analyzeFillerNeeds, nooblineIsSingleY } from "@/lib/shapeAnalysis";

const fillerNeedStatsCache = new WeakMap<GeneratedShape, ReturnType<typeof analyzeFillerNeeds>>();
const northRowSingleLineCache = new WeakMap<GeneratedShape, boolean>();

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
