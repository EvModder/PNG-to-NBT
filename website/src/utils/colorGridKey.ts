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

type HashState = [number, number, number, number];

function createHashState(): HashState {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
}

function mixUint32(state: HashState, value: number): void {
  const v = value >>> 0;
  state[0] = Math.imul((state[0] ^ v) >>> 0, 0x01000193) >>> 0;
  state[1] = Math.imul((state[1] + v + 0x7f4a7c15) >>> 0, 0x27d4eb2d) >>> 0;
  state[2] = Math.imul((state[2] ^ ((v << 16) | (v >>> 16))) >>> 0, 0x165667b1) >>> 0;
  state[3] = Math.imul((state[3] + (v ^ 0x9e3779b9)) >>> 0, 0x85ebca77) >>> 0;
}

function getHashId(state: HashState): string {
  return state.map(part => part.toString(16).padStart(8, "0")).join("");
}

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
