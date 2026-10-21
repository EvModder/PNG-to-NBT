/**
 * Public API:
 * - getColorGridCacheKey()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/colorGridParsingCore.ts
 */
import type { ColorGrid } from "@/types/color";
import { MAP_SIZE, TRANSPARENT_COLOR } from "@/utils/color";
import { createHashState, getHashId, mixUint32 } from "@/utils/hash";

// Callers:
// - src/Index.tsx
// - src/lib/colorGridParsingCore.ts
export function getColorGridCacheKey(colorGrid: ColorGrid): string {
  const hashState = createHashState();
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (color === TRANSPARENT_COLOR) {
        mixUint32(hashState, 0);
        continue;
      }
      mixUint32(hashState, color.isCustom ? 1 : 0);
      mixUint32(hashState, color.id);
      mixUint32(hashState, color.shade);
    }
  }
  return getHashId(hashState);
}
