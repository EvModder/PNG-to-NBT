/**
 * Public API:
 * - buildTwoLayerLoadPhases()
 *
 * Callers:
 * - src/lib/suppressLoadMarkers.ts
 * - tests/invariants.mts
 */
import { SuppressStepDirection } from "@/types/conversion";
import { MAP_SIZE } from "@/utils/color";

// Callers:
// - src/lib/suppressLoadMarkers.ts
// - tests/invariants.mts
export function buildTwoLayerLoadPhases(direction: SuppressStepDirection) {
  const axis = direction === SuppressStepDirection.EastToWest || direction === SuppressStepDirection.WestToEast ? "x" : "z";
  const width = axis === "x" ? 2 : 1;
  const ascending = direction === SuppressStepDirection.WestToEast || direction === SuppressStepDirection.NorthToSouth;
  const start = ascending ? 0 : MAP_SIZE - 1;
  // N->S must not refresh the recessive row just south of the clearing boundary.
  const distance = direction === SuppressStepDirection.NorthToSouth ? 127 : 126;
  // Load the intact map before these clearing phases. N/S clears one row at a time.
  return Array.from({ length: MAP_SIZE / width }, (_, phase) => {
    const end = start + (ascending ? 1 : -1) * ((phase + 1) * width - 1);
    return {
      axis,
      fronts: [{
        direction,
        clearedRange: [Math.min(start, end), Math.max(start, end)] as const,
        loadLine: end + (ascending ? distance : -distance),
      }],
    };
  });
}
