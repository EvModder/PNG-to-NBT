/**
 * Public API:
 * - createHashState()
 * - mixUint32()
 * - getHashId()
 *
 * Callers:
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
