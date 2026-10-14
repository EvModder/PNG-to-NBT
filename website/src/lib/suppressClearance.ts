/**
 * Public API:
 * - appendSuppressClearanceMarkers()
 * - getSuppressClearancePlan()
 * - forEachSuppressClearanceCell()
 *
 * Callers:
 * - src/lib/nbtExport.ts
 * - src/lib/shapeAnalysis.ts
 */
import { buildSuppressStepPhases } from "@/lib/suppressSteps";
import { toShapeCoordKey } from "@/lib/shapeModel";
import { ShapePartType, type GeneratedShape } from "@/types/shape";
import { MAP_SIZE } from "@/utils/color";

// Barriers default to dry/map-transparent. These are removal targets, never building materials.
const CLEARANCE_MARKER_BLOCK = "minecraft:barrier";

// Shared by export and inventory simulation so they clear exactly the same columns.
// Callers:
// - src/lib/shapeAnalysis.ts
export function getSuppressClearancePlan(shape: GeneratedShape) {
  if (shape.partType !== ShapePartType.SuppressStepPhases || !shape.suppressStepLayout) return null;
  const { buildMode, direction, centerOut } = shape.suppressStepLayout;
  const phases = buildSuppressStepPhases(buildMode, direction, centerOut);
  return shape.parts.map(part => {
    if (part.suppressStepIndex === undefined) return { floor: 0, columns: new Set<number>() };
    const phase = phases[part.suppressStepIndex];
    const columns = new Set<number>();
    for (const line of phase.lines) {
      for (let along = 0; along < MAP_SIZE; ++along) {
        const x = phase.axis === "x" ? line : along;
        const z = phase.axis === "z" ? line : along;
        if (!phase.includeAt(x, z)) continue;
        // Match each updated pixel's column and its north-neighbor shading reference.
        columns.add(x * (MAP_SIZE + 1) + z + 1);
        columns.add(x * (MAP_SIZE + 1) + z);
      }
    }
    return { floor: Math.min(...part.supportFloorYs) + 1, columns };
  });
}

// Callers:
// - src/lib/shapeAnalysis.ts
export function forEachSuppressClearanceCell(
  columns: ReadonlySet<number>,
  floor: number,
  maxHeight: number,
  visit: (coord: number, x: number, y: number, z: number) => void,
): void {
  for (const column of columns) {
    const x = Math.floor(column / (MAP_SIZE + 1));
    const z = column % (MAP_SIZE + 1) - 1;
    // Never clear the glass platform or below-platform water; taller leftovers need manual clearing.
    for (let y = floor; y <= floor + maxHeight; ++y) visit(toShapeCoordKey(x, y, z), x, y, z);
  }
}

// Callers:
// - src/lib/nbtExport.ts
export function appendSuppressClearanceMarkers(
  shape: GeneratedShape,
  parts: { x: number; y: number; z: number; blockName: string }[][],
): void {
  const plan = getSuppressClearancePlan(shape);
  if (!plan) return;
  let maxHeight = 0;
  for (let index = 0; index < parts.length; ++index) {
    const { floor, columns } = plan[index];
    if (!columns.size) continue;
    for (const block of parts[index]) maxHeight = Math.max(maxHeight, block.y - floor);
  }

  for (let index = 0; index < parts.length; ++index) {
    const { floor, columns } = plan[index];
    if (!columns.size) continue;
    const blocks = parts[index];
    const occupied = new Set(blocks.map(({ x, y, z }) => toShapeCoordKey(x, y, z)));
    forEachSuppressClearanceCell(columns, floor, maxHeight, (coord, x, y, z) => {
      if (!occupied.has(coord)) blocks.push({ x, y, z, blockName: CLEARANCE_MARKER_BLOCK });
    });
  }
}
