/**
 * Public API:
 * - buildSuppressLoadSpotMarkers()
 *
 * Callers:
 * - src/lib/nbtExport.ts
 */
import { WATER_BASE_INDEX } from "@/data/mapColors";
import { PixelParity, getPixelParity } from "@/lib/colorGridAnalysis";
import { isShapeColorCell, parseShapeCoordKey } from "@/lib/shapeModel";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { ShapePartType, type GeneratedShape, type ShapePart } from "@/types/shape";
import { MAP_SIZE } from "@/utils/color";
import type { BlockEntry } from "@/utils/nbtWriter";

const SUPPRESS_STEP_PAIR_LOAD_SPOT_DISTANCE = 126;
const SUPPRESS_STEP_CHECKER_LOAD_SPOT_DISTANCE = 124;
const SUPPRESS_STEP_CHECKER_LOAD_SPOT_OFFSETS_ODD = [15, 41, 65, 89, 113] as const;
const SUPPRESS_STEP_CHECKER_LOAD_SPOT_OFFSETS_EVEN = [14, 40, 64, 88, 112] as const;
const BARRIER_BLOCK_NAME = "minecraft:barrier";

type NonWaterColorCoord = { x: number; z: number };
type StepPhaseSpec = {
  lines: number[];
  includeAt: (x: number, z: number) => boolean;
};

function getOrderedStepLines(
  direction: SuppressStepDirection,
): { axis: "x" | "z"; lines: number[] } {
  const axis = (
    direction === SuppressStepDirection.NorthToSouth ||
    direction === SuppressStepDirection.SouthToNorth
  ) ? "z" : "x";
  const ascending = (
    direction === SuppressStepDirection.WestToEast ||
    direction === SuppressStepDirection.NorthToSouth
  );
  const lines = Array.from({ length: MAP_SIZE }, (_, index) => ascending ? index : MAP_SIZE - 1 - index);
  return { axis, lines };
}

function makeStepPhaseSpec(lines: readonly number[], includeAt: (x: number, z: number) => boolean): StepPhaseSpec {
  return { lines: [...lines], includeAt };
}

function buildStepPhaseSpecsForDirection(
  buildMode: BuildMode.SuppressStepPairs | BuildMode.SuppressStepChecker,
  direction: SuppressStepDirection,
): StepPhaseSpec[] {
  const specs: StepPhaseSpec[] = [];
  const { axis, lines } = getOrderedStepLines(direction);
  const getLine = (x: number, z: number) => axis === "x" ? x : z;
  const makeSingleLineParitySpec = (line: number, parity: PixelParity) =>
    makeStepPhaseSpec([line], (x, z) => getLine(x, z) === line && getPixelParity(x, z) === parity);
  const makeDualParitySpec = (
    dominantLines: readonly number[],
    recessiveLines: readonly number[],
  ) => {
    const dominantSet = new Set(dominantLines);
    const recessiveSet = new Set(recessiveLines);
    return makeStepPhaseSpec([...dominantLines, ...recessiveLines], (x, z) => {
      const line = getLine(x, z);
      const parity = getPixelParity(x, z);
      return (
        (dominantSet.has(line) && parity === PixelParity.Dominant) ||
        (recessiveSet.has(line) && parity === PixelParity.Recessive)
      );
    });
  };

  if (buildMode === BuildMode.SuppressStepPairs) {
    specs.push(makeSingleLineParitySpec(lines[0], PixelParity.Recessive));
    for (let i = 1; i < lines.length; ++i) {
      specs.push(makeDualParitySpec([lines[i - 1]], [lines[i]]));
    }
    specs.push(makeSingleLineParitySpec(lines[lines.length - 1], PixelParity.Dominant));
    return specs;
  }

  const linePairs: number[][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const first = lines[i];
    const second = lines[i + 1];
    if (second === undefined) break;
    linePairs.push([first, second]);
  }
  specs.push(makeStepPhaseSpec(linePairs[0] ?? [], (x, z) => {
    const line = getLine(x, z);
    return (linePairs[0]?.includes(line) ?? false) && getPixelParity(x, z) === PixelParity.Recessive;
  }));
  for (let i = 1; i < linePairs.length; ++i) {
    specs.push(makeDualParitySpec(linePairs[i - 1], linePairs[i]));
  }
  const lastPair = linePairs[linePairs.length - 1] ?? [];
  specs.push(makeStepPhaseSpec(lastPair, (x, z) => {
    const line = getLine(x, z);
    return lastPair.includes(line) && getPixelParity(x, z) === PixelParity.Dominant;
  }));
  return specs;
}

function getNearestStepLine(
  direction: SuppressStepDirection,
  lines: readonly number[],
): number {
  switch (direction) {
    case SuppressStepDirection.EastToWest:
    case SuppressStepDirection.SouthToNorth:
      return Math.min(...lines);
    case SuppressStepDirection.WestToEast:
    case SuppressStepDirection.NorthToSouth:
      return Math.max(...lines);
  }
}

function getLoadSpotCoordinate(
  direction: SuppressStepDirection,
  line: number,
  distance: number,
): number {
  switch (direction) {
    case SuppressStepDirection.EastToWest:
    case SuppressStepDirection.SouthToNorth:
      return line - distance;
    case SuppressStepDirection.NorthToSouth:
    case SuppressStepDirection.WestToEast:
      return line + distance;
  }
}

function getMarkerY(part: ShapePart): number | null {
  let minSupportFloorY = Infinity;
  for (const y of part.supportFloorYs) {
    if (y < minSupportFloorY) minSupportFloorY = y;
  }
  if (!Number.isFinite(minSupportFloorY)) return null;
  const markerY = minSupportFloorY + 1;
  if (markerY < part.bounds.minY || markerY > part.bounds.maxY) {
    throw new Error(`Invalid suppress load marker Y ${markerY}; expected within shape bounds [${part.bounds.minY}, ${part.bounds.maxY}]`);
  }
  return markerY;
}

function getNonWaterColorCoords(part: ShapePart): NonWaterColorCoord[] {
  const coords: NonWaterColorCoord[] = [];
  for (const [coord, cell] of part.cells) {
    if (!isShapeColorCell(cell)) continue;
    if (!cell.isCustom && cell.id === WATER_BASE_INDEX) continue;
    const [x, , z] = parseShapeCoordKey(coord);
    if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) {
      throw new Error(`Invalid suppress load marker source coord (${x}, ${z}); expected within [0, ${MAP_SIZE - 1}]`);
    }
    coords.push({ x, z });
  }
  return coords;
}

function findMatchingStepSpecIndex(
  coords: readonly NonWaterColorCoord[],
  specs: readonly StepPhaseSpec[],
  startIndex: number,
): number {
  for (let specIndex = startIndex; specIndex < specs.length; ++specIndex) {
    const spec = specs[specIndex];
    for (const coord of coords) {
      if (spec.includeAt(coord.x, coord.z)) return specIndex;
    }
  }
  throw new Error("Unable to match suppress load markers to a step phase spec");
}

function buildSuppressStepPairMarkers(
  spec: StepPhaseSpec,
  stepDirection: SuppressStepDirection,
  markerY: number,
): BlockEntry[] {
  const markerLine = getLoadSpotCoordinate(
    stepDirection,
    getNearestStepLine(stepDirection, spec.lines),
    SUPPRESS_STEP_PAIR_LOAD_SPOT_DISTANCE,
  );
  const markers: BlockEntry[] = [];

  if (
    stepDirection === SuppressStepDirection.EastToWest ||
    stepDirection === SuppressStepDirection.WestToEast
  ) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const marker = { x: markerLine, y: markerY, z, blockName: BARRIER_BLOCK_NAME };
      if (getPixelParity(marker.x, marker.z) !== PixelParity.Recessive) continue;
      markers.push(marker);
    }
    return markers;
  }

  for (let x = 0; x < MAP_SIZE; ++x) {
    const marker = { x, y: markerY, z: markerLine, blockName: BARRIER_BLOCK_NAME };
    if (getPixelParity(marker.x, marker.z) !== PixelParity.Recessive) continue;
    markers.push(marker);
  }
  return markers;
}

function buildSuppressStepCheckerMarkers(
  coords: readonly NonWaterColorCoord[],
  spec: StepPhaseSpec,
  stepDirection: SuppressStepDirection,
  markerY: number,
): BlockEntry[] {
  const markerLine = getLoadSpotCoordinate(
    stepDirection,
    getNearestStepLine(stepDirection, spec.lines),
    SUPPRESS_STEP_CHECKER_LOAD_SPOT_DISTANCE,
  );
  const orthogonalOffsets = (markerLine & 1) === 0
    ? SUPPRESS_STEP_CHECKER_LOAD_SPOT_OFFSETS_ODD
    : SUPPRESS_STEP_CHECKER_LOAD_SPOT_OFFSETS_EVEN;
  const markers: BlockEntry[] = [];

  if (
    stepDirection === SuppressStepDirection.EastToWest ||
    stepDirection === SuppressStepDirection.WestToEast
  ) {
    for (const z of orthogonalOffsets) {
      if (!coords.some(coord => coord.z === z && getPixelParity(coord.x, coord.z) === PixelParity.Dominant)) continue;
      markers.push({ x: markerLine, y: markerY, z, blockName: BARRIER_BLOCK_NAME });
    }
    return markers;
  }

  for (const x of orthogonalOffsets) {
    if (!coords.some(coord => coord.x === x && getPixelParity(coord.x, coord.z) === PixelParity.Dominant)) continue;
    markers.push({ x, y: markerY, z: markerLine, blockName: BARRIER_BLOCK_NAME });
  }
  return markers;
}

// Callers:
// - src/lib/nbtExport.ts
export function buildSuppressLoadSpotMarkers(
  shape: GeneratedShape,
  buildMode: BuildMode,
  stepDirection: SuppressStepDirection,
  enabled: boolean,
): BlockEntry[] {
  if (!enabled || shape.partType !== ShapePartType.SuppressStepPhases) return [];
  if (buildMode !== BuildMode.SuppressStepPairs && buildMode !== BuildMode.SuppressStepChecker) return [];

  const specs = buildStepPhaseSpecsForDirection(buildMode, stepDirection);
  const markers: BlockEntry[] = [];
  let nextSpecIndex = 0;
  for (const part of shape.parts) {
    const coords = getNonWaterColorCoords(part);
    if (coords.length === 0) continue;
    const markerY = getMarkerY(part);
    if (markerY === null) continue;
    const specIndex = findMatchingStepSpecIndex(coords, specs, nextSpecIndex);
    const spec = specs[specIndex];
    if (!spec) throw new Error(`Missing suppress step spec for marker part index ${specIndex}`);
    nextSpecIndex = specIndex + 1;
    const specCoords = coords.filter(coord => spec.includeAt(coord.x, coord.z));
    markers.push(
      ...(buildMode === BuildMode.SuppressStepPairs
        ? buildSuppressStepPairMarkers(spec, stepDirection, markerY)
        : specCoords.length === 0
          ? []
          : buildSuppressStepCheckerMarkers(specCoords, spec, stepDirection, markerY)),
    );
  }
  return markers;
}
