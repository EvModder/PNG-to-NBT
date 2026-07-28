/**
 * Public API:
 * - buildSuppressLoadSpotMarkers()
 *
 * Callers:
 * - src/lib/nbtExport.ts
 */
import {
  DEFAULT_CRUBTECH_LAYER_GAP,
  DEFAULT_CRUBTECH_LATE_PAIRS_GAP,
  DEFAULT_SUPPRESS_LOAD_SPOT_MARKER_BLOCK,
} from "@/data/defaultSettings";
import { WATER_BASE_INDEX } from "@/data/mapColors";
import { resolveExportBlockName } from "@/lib/blockId";
import { PixelParity, getPixelParity } from "@/lib/colorGridAnalysis";
import { collectFillerRolePixels } from "@/lib/shapeAnalysis";
import { isShapeColorCell, parseShapeCoordKey } from "@/lib/shapeModel";
import { BuildMode, FillerRole, SuppressStepDirection } from "@/types/conversion";
import { ShapePartType, type GeneratedShape, type ShapePart } from "@/types/shape";
import { MAP_SIZE } from "@/utils/color";
import { isSuppressBuildMode } from "@/utils/conversion";

const SUPPRESS_STEP_PAIR_LOAD_SPOT_DISTANCE = 126;
const SUPPRESS_STEP_CHECKER_LOAD_SPOT_DISTANCE = 124;
const VS_FILLER_LOAD_SPOT_ROLES = [FillerRole.ShadeVoidDominant, FillerRole.ShadeVoidRecessive] as const;
const CRUBTECH_PAUSE_LAMP_BLOCK = "minecraft:redstone_lamp[lit=true]";
const CRUBTECH_CONTINUE_LAMP_BLOCK = "minecraft:redstone_lamp[lit=false]";

type NonWaterColorCoord = { x: number; z: number };
type StepPhaseSpec = {
  lines: number[];
  loadLine: number;
  includeAt: (x: number, z: number) => boolean;
};

type BuildLoadSpotMarkerOptions = {
  markSuppressLoadSpotsInSchematic?: boolean;
  suppressLoadSpotMarkerBlock?: string;
  crubTech?: boolean;
  suppress2LayerLatePairY?: number;
};

type SparseLoadSpotTarget = {
  x: number;
  z: number;
};

type LoadSpotMarkerEntry = {
  x: number;
  y: number;
  z: number;
  blockName: string;
};

function isXAxisDirection(direction: SuppressStepDirection): boolean {
  return (
    direction === SuppressStepDirection.EastToWest ||
    direction === SuppressStepDirection.WestToEast
  );
}

function getOrderedStepLines(
  direction: SuppressStepDirection,
): { axis: "x" | "z"; lines: number[]; lineStep: 1 | -1 } {
  const axis = isXAxisDirection(direction) ? "x" : "z";
  const ascending = (
    direction === SuppressStepDirection.WestToEast ||
    direction === SuppressStepDirection.NorthToSouth
  );
  const lines = Array.from({ length: MAP_SIZE }, (_, index) => ascending ? index : MAP_SIZE - 1 - index);
  return { axis, lines, lineStep: ascending ? 1 : -1 };
}

function makeStepPhaseSpec(
  lines: readonly number[],
  loadLine: number,
  includeAt: (x: number, z: number) => boolean,
): StepPhaseSpec {
  return { lines: [...lines], loadLine, includeAt };
}

function buildStepPhaseSpecsForDirection(
  buildMode: BuildMode.SuppressStepPairs | BuildMode.SuppressStepChecker,
  direction: SuppressStepDirection,
): StepPhaseSpec[] {
  const specs: StepPhaseSpec[] = [];
  const { axis, lines, lineStep } = getOrderedStepLines(direction);
  const getLine = (x: number, z: number) => axis === "x" ? x : z;
  const makeSingleLineParitySpec = (line: number, parity: PixelParity) =>
    makeStepPhaseSpec([line], line, (x, z) => getLine(x, z) === line && getPixelParity(x, z) === parity);
  const makeDualParitySpec = (
    dominantLines: readonly number[],
    recessiveLines: readonly number[],
    loadLine: number,
  ) => {
    const dominantSet = new Set(dominantLines);
    const recessiveSet = new Set(recessiveLines);
    return makeStepPhaseSpec([...dominantLines, ...recessiveLines], loadLine, (x, z) => {
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
      specs.push(makeDualParitySpec([lines[i - 1]], [lines[i]], lines[i]));
    }
    specs.push(makeStepPhaseSpec([lines[lines.length - 1]], lines[lines.length - 1] + lineStep, (x, z) => {
      return getLine(x, z) === lines[lines.length - 1] && getPixelParity(x, z) === PixelParity.Dominant;
    }));
    return specs;
  }

  const linePairs: number[][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const first = lines[i];
    const second = lines[i + 1];
    if (second === undefined) break;
    linePairs.push([first, second]);
  }
  specs.push(makeStepPhaseSpec(linePairs[0] ?? [], lines[1] ?? lines[0], (x, z) => {
    const line = getLine(x, z);
    return (linePairs[0]?.includes(line) ?? false) && getPixelParity(x, z) === PixelParity.Recessive;
  }));
  for (let i = 1; i < linePairs.length; ++i) {
    specs.push(makeDualParitySpec(linePairs[i - 1], linePairs[i], lines[i * 2 + 1] ?? (lines[lines.length - 1] + lineStep * 2)));
  }
  const lastPair = linePairs[linePairs.length - 1] ?? [];
  specs.push(makeStepPhaseSpec(lastPair, lines[lines.length - 1] + lineStep * 2, (x, z) => {
    const line = getLine(x, z);
    return lastPair.includes(line) && getPixelParity(x, z) === PixelParity.Dominant;
  }));
  return specs;
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

function getVsFillerLoadSpotDistance(): 127 {
  return 127;
}

const DOMINANT_SPARSE_LOAD_SPOT_OFFSETS_ODD = [15, 41, 65, 89, 113] as const;
const DOMINANT_SPARSE_LOAD_SPOT_OFFSETS_EVEN = [14, 40, 64, 88, 112] as const;

function getDominantSparseLoadSpotOffsets(markerLine: number): readonly number[] {
  return (markerLine & 1) === 0
    ? DOMINANT_SPARSE_LOAD_SPOT_OFFSETS_ODD
    : DOMINANT_SPARSE_LOAD_SPOT_OFFSETS_EVEN;
}

function getNearestSparseLoadSpotOffsetIndex(
  orthogonalCoord: number,
  offsets: readonly number[],
): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < offsets.length; ++i) {
    const distance = Math.abs(orthogonalCoord - offsets[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function buildSparseDominantLoadSpotMarkers(
  coords: readonly SparseLoadSpotTarget[],
  markerLine: number,
  stepDirection: SuppressStepDirection,
  markerY: number,
  blockName: string,
): LoadSpotMarkerEntry[] {
  const offsets = getDominantSparseLoadSpotOffsets(markerLine);
  const usedOffsetIndices = new Set<number>();

  for (const coord of coords) {
    if (getPixelParity(coord.x, coord.z) !== PixelParity.Dominant) continue;
    usedOffsetIndices.add(
      getNearestSparseLoadSpotOffsetIndex(
        isXAxisDirection(stepDirection) ? coord.z : coord.x,
        offsets,
      ),
    );
  }

  return [...usedOffsetIndices]
    .sort((a, b) => a - b)
    .map(offsetIndex => {
      const orthogonalCoord = offsets[offsetIndex];
      return isXAxisDirection(stepDirection)
        ? { x: markerLine, y: markerY, z: orthogonalCoord, blockName }
        : { x: orthogonalCoord, y: markerY, z: markerLine, blockName };
    });
}

function buildDirectLoadSpotMarkers(
  coords: readonly SparseLoadSpotTarget[],
  markerLine: number,
  stepDirection: SuppressStepDirection,
  markerY: number,
  blockName: string,
): LoadSpotMarkerEntry[] {
  const seen = new Set<string>();
  const markers: LoadSpotMarkerEntry[] = [];

  for (const coord of coords) {
    const marker = isXAxisDirection(stepDirection)
      ? { x: markerLine, y: markerY, z: coord.z, blockName }
      : { x: coord.x, y: markerY, z: markerLine, blockName };
    const key = `${marker.x},${marker.y},${marker.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    markers.push(marker);
  }

  return markers;
}

function getJigsawOrientation(direction: SuppressStepDirection): "up_north" | "up_south" | "up_east" | "up_west" {
  switch (direction) {
    case SuppressStepDirection.NorthToSouth:
      return "up_north";
    case SuppressStepDirection.SouthToNorth:
      return "up_south";
    case SuppressStepDirection.EastToWest:
      return "up_east";
    case SuppressStepDirection.WestToEast:
      return "up_west";
  }
}

function orientLoadSpotMarkerBlockName(blockName: string, direction: SuppressStepDirection): string {
  const bracketIdx = blockName.indexOf("[");
  const baseName = bracketIdx < 0 ? blockName : blockName.slice(0, bracketIdx);
  if (baseName !== "minecraft:jigsaw" && baseName !== "jigsaw") return blockName;

  const orientationProp = `orientation=${getJigsawOrientation(direction)}`;
  if (bracketIdx < 0) return `${baseName}[${orientationProp}]`;

  const props = blockName
    .slice(bracketIdx + 1, -1)
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !part.startsWith("orientation="));
  props.push(orientationProp);
  return `${baseName}[${props.join(",")}]`;
}

function getMarkerY(part: ShapePart): number | null {
  let minSupportFloorY = Infinity;
  for (const y of part.supportFloorYs) {
    if (y < minSupportFloorY) minSupportFloorY = y;
  }
  if (!Number.isFinite(minSupportFloorY)) return null;
  const markerY = minSupportFloorY + 1;
  if (markerY < part.bounds.minY || markerY > part.bounds.maxY) {
    throw new Error(`Invalid load spot marker Y ${markerY}; expected within shape bounds [${part.bounds.minY}, ${part.bounds.maxY}]`);
  }
  return markerY;
}

function getShapeMarkerY(shape: GeneratedShape): number | null {
  let minSupportFloorY = Infinity;
  for (const part of shape.parts) {
    for (const y of part.supportFloorYs) {
      if (y < minSupportFloorY) minSupportFloorY = y;
    }
  }
  return Number.isFinite(minSupportFloorY) ? minSupportFloorY + 1 : null;
}

function getMaxSupportFloorY(shape: GeneratedShape): number | null {
  let maxSupportFloorY = -Infinity;
  for (const part of shape.parts) {
    for (const y of part.supportFloorYs) {
      if (y > maxSupportFloorY) maxSupportFloorY = y;
    }
  }
  return Number.isFinite(maxSupportFloorY) ? maxSupportFloorY : null;
}

function getDefaultCrubTechLatePairY(shape: GeneratedShape): number {
  const maxSupportFloorY = getMaxSupportFloorY(shape);
  if (maxSupportFloorY === null) return DEFAULT_CRUBTECH_LAYER_GAP + DEFAULT_CRUBTECH_LATE_PAIRS_GAP;
  return maxSupportFloorY + 1;
}

function getCrubTechSignalLampY(shape: GeneratedShape, latePairY: number): number | null {
  const maxSupportFloorY = getMaxSupportFloorY(shape);
  if (maxSupportFloorY === null) return null;
  return Math.max(maxSupportFloorY, latePairY - 1) + 4;
}

function getNonWaterColorCoords(part: ShapePart): NonWaterColorCoord[] {
  const coords: NonWaterColorCoord[] = [];
  for (const [coord, cell] of part.cells) {
    if (!isShapeColorCell(cell)) continue;
    if (!cell.isCustom && cell.id === WATER_BASE_INDEX) continue;
    const [x, , z] = parseShapeCoordKey(coord);
    if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) {
      throw new Error(`Invalid load spot source coord (${x}, ${z}); expected within [0, ${MAP_SIZE - 1}]`);
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
  throw new Error("Unable to match load spot markers to a step phase spec");
}

function buildSuppressStepPairMarkers(
  spec: StepPhaseSpec,
  stepDirection: SuppressStepDirection,
  markerY: number,
  markerBlockName: string,
): LoadSpotMarkerEntry[] {
  const markerLine = getLoadSpotCoordinate(
    stepDirection,
    spec.loadLine,
    SUPPRESS_STEP_PAIR_LOAD_SPOT_DISTANCE,
  );
  const markers: LoadSpotMarkerEntry[] = [];

  if (isXAxisDirection(stepDirection)) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const marker = {
        x: markerLine,
        y: markerY,
        z,
        blockName: orientLoadSpotMarkerBlockName(markerBlockName, stepDirection),
      };
      if (getPixelParity(marker.x, marker.z) !== PixelParity.Recessive) continue;
      markers.push(marker);
    }
    return markers;
  }

  for (let x = 0; x < MAP_SIZE; ++x) {
    const marker = {
      x,
      y: markerY,
      z: markerLine,
      blockName: orientLoadSpotMarkerBlockName(markerBlockName, stepDirection),
    };
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
  markerBlockName: string,
): LoadSpotMarkerEntry[] {
  const markerLine = getLoadSpotCoordinate(
    stepDirection,
    spec.loadLine,
    SUPPRESS_STEP_CHECKER_LOAD_SPOT_DISTANCE,
  );
  return buildSparseDominantLoadSpotMarkers(
    coords,
    markerLine,
    stepDirection,
    markerY,
    orientLoadSpotMarkerBlockName(markerBlockName, stepDirection),
  );
}

function buildSuppressStepLoadSpotMarkers(
  shape: GeneratedShape,
  buildMode: BuildMode,
  stepDirection: SuppressStepDirection,
  enabled: boolean,
  markerBlockName: string,
): LoadSpotMarkerEntry[] {
  if (!enabled || shape.partType !== ShapePartType.SuppressStepPhases) return [];
  if (buildMode !== BuildMode.SuppressStepPairs && buildMode !== BuildMode.SuppressStepChecker) return [];

  const specs = buildStepPhaseSpecsForDirection(buildMode, stepDirection);
  const markers: LoadSpotMarkerEntry[] = [];
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
        ? buildSuppressStepPairMarkers(spec, stepDirection, markerY, markerBlockName)
        : specCoords.length === 0
          ? []
          : buildSuppressStepCheckerMarkers(specCoords, spec, stepDirection, markerY, markerBlockName)),
    );
  }
  return markers;
}

function buildVsFillerLoadSpotMarkers(
  shape: GeneratedShape,
  stepDirection: SuppressStepDirection,
  enabled: boolean,
  markerBlockName: string,
): LoadSpotMarkerEntry[] {
  if (!enabled) return [];
  const markerY = getShapeMarkerY(shape);
  if (markerY === null) return [];

  const loadSpotDistance = getVsFillerLoadSpotDistance();
  const groupedTargets = new Map<number, SparseLoadSpotTarget[]>();

  for (const { x, z, role } of collectFillerRolePixels(shape, VS_FILLER_LOAD_SPOT_ROLES)) {
    const targetX = x;
    const targetZ = role === FillerRole.ShadeVoidDominant ? z : z + 1;
    if (targetZ >= MAP_SIZE) {
      throw new Error(`Invalid VS load spot target z ${targetZ}; expected within [0, ${MAP_SIZE - 1}]`);
    }
    const sourceLine = isXAxisDirection(stepDirection) ? x : z;
    const markerLine = getLoadSpotCoordinate(stepDirection, sourceLine, loadSpotDistance);
    const existingGroup = groupedTargets.get(markerLine);
    if (existingGroup) {
      existingGroup.push({ x: targetX, z: targetZ });
    } else {
      groupedTargets.set(markerLine, [{ x: targetX, z: targetZ }]);
    }
  }

  const occupied = new Set<string>();
  const markers: LoadSpotMarkerEntry[] = [];
  for (const [markerLine, coords] of groupedTargets) {
    const directMarkers = buildDirectLoadSpotMarkers(
      coords,
      markerLine,
      stepDirection,
      markerY,
      orientLoadSpotMarkerBlockName(markerBlockName, stepDirection),
    );
    const sparseMarkers = buildSparseDominantLoadSpotMarkers(
      coords,
      markerLine,
      stepDirection,
      markerY,
      orientLoadSpotMarkerBlockName(markerBlockName, stepDirection),
    );
    const chosenMarkers = directMarkers.length <= sparseMarkers.length
      ? directMarkers
      : sparseMarkers;

    for (const marker of chosenMarkers) {
      const key = `${marker.x},${marker.y},${marker.z}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      markers.push(marker);
    }
  }

  return markers;
}

function getCrubTechStepStartX(x: number): number {
  return Math.min(MAP_SIZE - 1, x | 1);
}

function buildCrubTechSignalLamps(
  shape: GeneratedShape,
  buildMode: BuildMode,
  enabled: boolean,
  latePairY: number,
): LoadSpotMarkerEntry[] {
  // Plain 2-layer has no late build pass, so it emits no pause/continue lamps.
  if (!enabled || buildMode !== BuildMode.Suppress2LayerLatePairs) {
    return [];
  }
  const lampY = getCrubTechSignalLampY(shape, latePairY);
  if (lampY === null) return [];

  const stepStartXs = new Set<number>();
  for (const part of shape.parts) {
    for (const [coord] of part.cells) {
      const [x, y, z] = parseShapeCoordKey(coord);
      if (y !== latePairY || x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) continue;
      stepStartXs.add(getCrubTechStepStartX(x));
    }
  }

  return Array.from(
    { length: MAP_SIZE / 2 },
    (_, index) => MAP_SIZE - 1 - index * 2,
  )
    .map(x => ({
      x,
      y: lampY,
      z: MAP_SIZE,
      blockName: stepStartXs.has(x) ? CRUBTECH_PAUSE_LAMP_BLOCK : CRUBTECH_CONTINUE_LAMP_BLOCK,
    }));
}

// Callers:
// - src/lib/nbtExport.ts
export function buildSuppressLoadSpotMarkers(
  shape: GeneratedShape,
  buildMode: BuildMode,
  stepDirection: SuppressStepDirection,
  options: BuildLoadSpotMarkerOptions,
): LoadSpotMarkerEntry[] {
  const markerBlockName = resolveExportBlockName(options.suppressLoadSpotMarkerBlock ?? DEFAULT_SUPPRESS_LOAD_SPOT_MARKER_BLOCK);
  const crubTechLatePairY = options.suppress2LayerLatePairY ?? getDefaultCrubTechLatePairY(shape);
  return [
    ...buildSuppressStepLoadSpotMarkers(shape, buildMode, stepDirection, options.markSuppressLoadSpotsInSchematic === true, markerBlockName),
    ...buildCrubTechSignalLamps(
      shape,
      buildMode,
      options.crubTech === true,
      crubTechLatePairY,
    ),
    ...buildVsFillerLoadSpotMarkers(
      shape,
      stepDirection,
      options.markSuppressLoadSpotsInSchematic === true && !isSuppressBuildMode(buildMode),
      markerBlockName,
    ),
  ];
}
