/**
 * Public API:
 * - createHashState()
 * - mixUint32()
 * - getHashId()
 * - mulberry32()
 *
 * Callers:
 * - src/lib/shapeBlocksStaircase.ts
 * - src/lib/shapeGeneration.ts
 * - src/utils/colorGridKey.ts
 */
type HashState = [number, number, number, number];

// Callers:
// - src/lib/shapeGeneration.ts
// - src/utils/colorGridKey.ts
export function createHashState(): HashState {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
}

// Callers:
// - src/lib/shapeGeneration.ts
// - src/utils/colorGridKey.ts
export function mixUint32(state: HashState, value: number): void {
  const v = value >>> 0;
  state[0] = Math.imul((state[0] ^ v) >>> 0, 0x01000193) >>> 0;
  state[1] = Math.imul((state[1] + v + 0x7f4a7c15) >>> 0, 0x27d4eb2d) >>> 0;
  state[2] = Math.imul((state[2] ^ ((v << 16) | (v >>> 16))) >>> 0, 0x165667b1) >>> 0;
  state[3] = Math.imul((state[3] + (v ^ 0x9e3779b9)) >>> 0, 0x85ebca77) >>> 0;
}

// Callers:
// - src/lib/shapeGeneration.ts
// - src/utils/colorGridKey.ts
export function getHashId(state: HashState): string {
  return state.map(part => part.toString(16).padStart(8, "0")).join("");
}

// Callers:
// - src/lib/shapeBlocksStaircase.ts
//
// Seeded uniform values in [0, 1).
export function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
