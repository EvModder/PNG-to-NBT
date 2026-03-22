/**
 * Public API:
 * - getPaletteSeedOffset()
 *
 * Callers:
 * - src/Index.tsx
 * - tests/run.mts
 */
import { BASE_COLORS } from "@/data/mapColors";

function hashString32(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; ++i) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

// Callers:
// - src/Index.tsx
// - tests/run.mts
export function getPaletteSeedOffset(blockMapping: Record<number, string>): number {
  const serialized = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => `${i + 1}:${blockMapping[i + 1] ?? ""}`).join("|");
  return hashString32(serialized);
}
