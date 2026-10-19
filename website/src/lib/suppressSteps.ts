/**
 * Public API:
 * - buildSuppressStepPhases()
 * - buildTwoLayerLoadPhases()
 * - SuppressStepPhase
 *
 * Callers:
 * - src/lib/shapeGeneration.ts
 * - src/lib/suppressClearance.ts
 * - src/lib/suppressLoadMarkers.ts
 */
import { getPixelParity, PixelParity } from "@/lib/colorGridAnalysis";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { MAP_SIZE } from "@/utils/color";

type SuppressStepFront = {
  direction: SuppressStepDirection;
  lines: readonly number[];
  loadLine: number;
  includeAt: (x: number, z: number) => boolean;
};

// Callers:
// - src/lib/shapeGeneration.ts
export type SuppressStepPhase = {
  axis: "x" | "z";
  lines: readonly number[];
  fronts: readonly SuppressStepFront[];
  includeAt: (x: number, z: number) => boolean;
};

function buildDirectionalPhases(
  axis: "x" | "z",
  direction: SuppressStepDirection,
  lines: readonly number[],
  width: number,
): SuppressStepFront[] {
  const lineStep = lines[1] - lines[0];
  const phases: SuppressStepFront[] = [];
  // Open with recessive pixels, then finish with the last dominant strip.
  for (let offset = 0; offset <= lines.length; offset += width) {
    const dominant = new Set(lines.slice(Math.max(0, offset - width), offset));
    const recessive = new Set(lines.slice(offset, offset + width));
    phases.push({
      direction,
      lines: [...dominant, ...recessive],
      loadLine: lines[offset + width - 1] ?? lines[lines.length - 1] + lineStep * width,
      includeAt: (x, z) => (getPixelParity(x, z) === PixelParity.Dominant ? dominant : recessive).has(axis === "x" ? x : z),
    });
  }
  return phases;
}

// Callers:
// - src/lib/suppressLoadMarkers.ts
export function buildTwoLayerLoadPhases(direction: SuppressStepDirection, centerOut = false) {
  const axis = direction === SuppressStepDirection.EastToWest || direction === SuppressStepDirection.WestToEast ? "x" : "z";
  const width = axis === "x" ? 2 : 1;
  const length = centerOut ? MAP_SIZE / 2 : MAP_SIZE;
  const directions = centerOut
    ? axis === "x"
      ? [SuppressStepDirection.EastToWest, SuppressStepDirection.WestToEast]
      : [SuppressStepDirection.SouthToNorth, SuppressStepDirection.NorthToSouth]
    : [direction];
  // Load the intact map before these clearing phases. N/S clears one row at a time.
  return Array.from({ length: length / width }, (_, phase) => ({
    axis,
    fronts: directions.map(frontDirection => {
      const ascending = frontDirection === SuppressStepDirection.WestToEast || frontDirection === SuppressStepDirection.NorthToSouth;
      const start = ascending ? MAP_SIZE - length : length - 1;
      const end = start + (ascending ? 1 : -1) * ((phase + 1) * width - 1);
      // N->S must not refresh the recessive row just south of the clearing boundary.
      const distance = frontDirection === SuppressStepDirection.NorthToSouth ? 127 : 126;
      return {
        direction: frontDirection,
        clearedRange: [Math.min(start, end), Math.max(start, end)] as const,
        loadLine: end + (ascending ? distance : -distance),
      };
    }),
  }));
}

// Callers:
// - src/lib/shapeGeneration.ts
// - src/lib/suppressClearance.ts
// - src/lib/suppressLoadMarkers.ts
export function buildSuppressStepPhases(
  buildMode: BuildMode.SuppressStepPairs | BuildMode.SuppressStepChecker,
  direction: SuppressStepDirection,
  centerOut = false,
): SuppressStepPhase[] {
  const axis = direction === SuppressStepDirection.EastToWest || direction === SuppressStepDirection.WestToEast ? "x" : "z";
  const ascending = direction === SuppressStepDirection.WestToEast || direction === SuppressStepDirection.NorthToSouth;
  const width = buildMode === BuildMode.SuppressStepPairs ? 1 : 2;
  // Each half owns its center strip; the opening phase targets only recessive pixels.
  const fronts = centerOut
    ? [
        buildDirectionalPhases(axis, axis === "x" ? SuppressStepDirection.EastToWest : SuppressStepDirection.SouthToNorth,
          Array.from({ length: MAP_SIZE / 2 }, (_, i) => MAP_SIZE / 2 - 1 - i), width),
        buildDirectionalPhases(axis, axis === "x" ? SuppressStepDirection.WestToEast : SuppressStepDirection.NorthToSouth,
          Array.from({ length: MAP_SIZE / 2 }, (_, i) => MAP_SIZE / 2 + i), width),
      ]
    : [buildDirectionalPhases(axis, direction, Array.from({ length: MAP_SIZE }, (_, i) => ascending ? i : MAP_SIZE - 1 - i), width)];
  return fronts[0].map((_, index) => {
    const phaseFronts = fronts.map(phases => phases[index]);
    const [first, second] = phaseFronts;
    return {
      axis,
      lines: phaseFronts.flatMap(front => front.lines),
      fronts: phaseFronts,
      includeAt: second ? (x, z) => first.includeAt(x, z) || second.includeAt(x, z) : first.includeAt,
    };
  });
}
