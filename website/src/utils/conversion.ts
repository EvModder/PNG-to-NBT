/**
 * Public API:
 * - isStaircaseBuildMode()
 * - isSuppressBuildMode()
 * - isSuppressStepsBuildMode()
 * - buildModeUsesLayerGap()
 * - isCrubTechBuildMode()
 * - buildModeSupportsCenterOut()
 * - buildModeUsesPaletteSeed()
 * - shouldIncludeTransparentBlocks()
 * - getVisibleSuppressBuildModes()
 * - resolveBuildModeSelection()
 * - isSuppressStepDirection()
 * - getBuildModeDownloadSuffix()
 * - cycleSuppressStepDirection()
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/ToolbarBuildSettings.tsx
 * - src/lib/buildModeShapes.ts
 * - src/lib/colorGridAnalysis.ts
 * - src/lib/messages.ts
 * - src/lib/nbtExport.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/suppressLoadMarkers.ts
 * - src/lib/tileGeometryWorkerClient.ts
 */
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { TRANSPARENCY_BASE_INDEX } from "@/data/mapColors";

const SUPPRESS_STEP_DIRECTIONS = [
  SuppressStepDirection.WestToEast,
  SuppressStepDirection.NorthToSouth,
  SuppressStepDirection.EastToWest,
  SuppressStepDirection.SouthToNorth,
] as const satisfies readonly SuppressStepDirection[];

// Callers:
// - src/Index.tsx
export function isSuppressStepDirection(raw: unknown): raw is SuppressStepDirection {
  return Object.values(SuppressStepDirection).includes(raw as SuppressStepDirection);
}

function getDirectionSuffix(direction: SuppressStepDirection): string {
  switch (direction) {
    case SuppressStepDirection.EastToWest:
      return "EW";
    case SuppressStepDirection.WestToEast:
      return "WE";
    case SuppressStepDirection.NorthToSouth:
      return "NS";
    case SuppressStepDirection.SouthToNorth:
      return "SN";
  }
}

// Callers:
// - src/Index.tsx
export function getBuildModeDownloadSuffix(
  buildMode: BuildMode,
  direction: SuppressStepDirection,
  crubTech = false,
  centerOut = false,
): string {
  if (centerOut && buildModeSupportsCenterOut(buildMode, crubTech)) {
    const axis = direction === SuppressStepDirection.EastToWest || direction === SuppressStepDirection.WestToEast ? "EW" : "NS";
    const mode = buildMode === BuildMode.SuppressStepPairs ? "step_pairs" : buildMode === BuildMode.SuppressStepChecker ? "step_checker" : "2layer";
    return `-suppress_${mode}_center_out_${axis}`;
  }
  switch (buildMode) {
    case BuildMode.Flat:
      return "";
    case BuildMode.InclineUp:
      return "-incline_up";
    case BuildMode.InclineDown:
      return "-incline_down";
    case BuildMode.StaircaseNorthline:
      return "-northline";
    case BuildMode.StaircaseSouthline:
      return "-southline";
    case BuildMode.StaircaseClassic:
      return "-classic";
    case BuildMode.StaircaseValley:
      return "-valley";
    case BuildMode.StaircaseGroup:
      return "-group";
    case BuildMode.StaircaseParty:
      return "-party";
    case BuildMode.SuppressSplitRow:
      return "-split_row";
    case BuildMode.SuppressSplitChecker:
      return "-split_checker";
    case BuildMode.SuppressStepPairs:
      return `-suppress_step_pairs_${getDirectionSuffix(direction)}`;
    case BuildMode.SuppressStepChecker:
      return `-suppress_step_checker_${getDirectionSuffix(direction)}`;
    case BuildMode.Suppress2LayerLateFillers:
      return `-suppress_2layer_${getDirectionSuffix(direction)}`;
    case BuildMode.Suppress2LayerLatePairs:
    case BuildMode.Suppress2Layer:
      return crubTech ? "-suppress_crubtech" : `-suppress_2layer_${getDirectionSuffix(direction)}`;
  }
}

// Callers:
// - src/Index.tsx
// - src/lib/buildModeShapes.ts
// - src/lib/shapeGeneration.ts
export function isStaircaseBuildMode(buildMode: BuildMode): boolean {
  switch (buildMode) {
    case BuildMode.Flat:
    case BuildMode.InclineUp:
    case BuildMode.InclineDown:
    case BuildMode.StaircaseNorthline:
    case BuildMode.StaircaseSouthline:
    case BuildMode.StaircaseClassic:
    case BuildMode.StaircaseValley:
    case BuildMode.StaircaseGroup:
    case BuildMode.StaircaseParty:
      return true;
    default:
      return false;
  }
}

// Callers:
// - src/Index.tsx
// - src/lib/nbtExport.ts
// - src/lib/suppressLoadMarkers.ts
export function isSuppressBuildMode(buildMode: BuildMode): boolean {
  return !isStaircaseBuildMode(buildMode);
}

// Callers:
// - src/Index.tsx
// - src/lib/colorGridAnalysis.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeGeneration.ts
// - src/lib/tileGeometryWorkerClient.ts
export function isSuppressStepsBuildMode(buildMode: BuildMode): boolean {
  switch (buildMode) {
    case BuildMode.SuppressStepPairs:
    case BuildMode.SuppressStepChecker:
      return true;
    default:
      return false;
  }
}

// Callers:
// - src/Index.tsx
// - src/components/ToolbarBuildSettings.tsx
// - src/lib/messages.ts
// - src/lib/shapeGeneration.ts
// - src/lib/tileGeometryWorkerClient.ts
export function buildModeUsesLayerGap(buildMode: BuildMode): boolean {
  switch (buildMode) {
    case BuildMode.Suppress2Layer:
    case BuildMode.Suppress2LayerLateFillers:
    case BuildMode.Suppress2LayerLatePairs:
      return true;
    default:
      return false;
  }
}

// Callers:
// - src/Index.tsx
// - src/lib/nbtExport.ts
// - src/lib/suppressLoadMarkers.ts
export function isCrubTechBuildMode(buildMode: BuildMode): boolean {
  switch (buildMode) {
    case BuildMode.Suppress2Layer:
    case BuildMode.Suppress2LayerLatePairs:
      return true;
    default:
      return false;
  }
}

// Callers:
// - src/Index.tsx
// - src/lib/nbtExport.ts
// - src/lib/suppressLoadMarkers.ts
export function buildModeSupportsCenterOut(buildMode: BuildMode, crubTech = false): boolean {
  return isSuppressStepsBuildMode(buildMode) ||
    (buildModeUsesLayerGap(buildMode) && !(crubTech && isCrubTechBuildMode(buildMode)));
}

// Callers:
// - src/Index.tsx
// - src/lib/shapeGeneration.ts
export function buildModeUsesPaletteSeed(buildMode: BuildMode): boolean {
  return buildMode === BuildMode.StaircaseParty;
}

// Callers:
// - src/Index.tsx
export function shouldIncludeTransparentBlocks(
  blockMapping: Record<number, string>,
  hasTransparency: boolean,
  buildMode: BuildMode,
): boolean {
  return hasTransparency &&
    !isSuppressBuildMode(buildMode) &&
    (blockMapping[TRANSPARENCY_BASE_INDEX] ?? "").trim() !== "";
}

// Callers:
// - src/Index.tsx
export function getVisibleSuppressBuildModes(requiresTwoLayerLateShading: boolean): BuildMode[] {
  return requiresTwoLayerLateShading
    ? [
        BuildMode.SuppressSplitRow,
        BuildMode.SuppressSplitChecker,
        BuildMode.SuppressStepPairs,
        BuildMode.SuppressStepChecker,
        BuildMode.Suppress2LayerLateFillers,
        BuildMode.Suppress2LayerLatePairs,
      ]
    : [
        BuildMode.SuppressSplitRow,
        BuildMode.SuppressSplitChecker,
        BuildMode.SuppressStepPairs,
        BuildMode.SuppressStepChecker,
        BuildMode.Suppress2Layer,
      ];
}

// Callers:
// - src/Index.tsx
export function resolveBuildModeSelection(
  buildMode: BuildMode,
  lockFlatBuildMode: boolean,
  switchToSuppressCheckerIfContainsVoidShadows: boolean,
  hasVoidShadow: boolean,
  preferLatePairs: boolean,
  staircaseModes: readonly BuildMode[],
  suppressModes: readonly BuildMode[],
): BuildMode {
  let nextBuildMode = buildMode;

  if (lockFlatBuildMode) return BuildMode.Flat;
  if (switchToSuppressCheckerIfContainsVoidShadows && hasVoidShadow && isStaircaseBuildMode(nextBuildMode)) {
    nextBuildMode = BuildMode.SuppressStepChecker;
  } else if (nextBuildMode === BuildMode.Flat) {
    nextBuildMode = BuildMode.StaircaseClassic;
  }

  const visibleModes = new Set([...staircaseModes, ...suppressModes]);
  if (visibleModes.has(nextBuildMode)) {
    return nextBuildMode;
  }
  if (
    nextBuildMode === BuildMode.Suppress2Layer &&
    preferLatePairs &&
    visibleModes.has(BuildMode.Suppress2LayerLatePairs)
  ) {
    nextBuildMode = BuildMode.Suppress2LayerLatePairs;
  } else if (nextBuildMode === BuildMode.Suppress2Layer && visibleModes.has(BuildMode.Suppress2LayerLateFillers)) {
    nextBuildMode = BuildMode.Suppress2LayerLateFillers;
  } else if (
    (nextBuildMode === BuildMode.Suppress2LayerLateFillers || nextBuildMode === BuildMode.Suppress2LayerLatePairs) &&
    visibleModes.has(BuildMode.Suppress2Layer)
  ) {
    nextBuildMode = BuildMode.Suppress2Layer;
  } else if (nextBuildMode === BuildMode.Suppress2LayerLatePairs && visibleModes.has(BuildMode.Suppress2LayerLateFillers)) {
    nextBuildMode = BuildMode.Suppress2LayerLateFillers;
  } else {
    nextBuildMode = staircaseModes[0] ?? BuildMode.StaircaseClassic;
  }

  return nextBuildMode;
}

// Callers:
// - src/Index.tsx
// - src/components/ToolbarBuildSettings.tsx
export function cycleSuppressStepDirection(
  stepDirection: SuppressStepDirection,
  isSelectable: (direction: SuppressStepDirection) => boolean = () => true,
): SuppressStepDirection {
  const index = SUPPRESS_STEP_DIRECTIONS.indexOf(stepDirection);
  if (index < 0) return SUPPRESS_STEP_DIRECTIONS.find(isSelectable) ?? SUPPRESS_STEP_DIRECTIONS[0];
  for (let offset = 1; offset <= SUPPRESS_STEP_DIRECTIONS.length; ++offset) {
    const candidate = SUPPRESS_STEP_DIRECTIONS[(index + offset) % SUPPRESS_STEP_DIRECTIONS.length];
    if (isSelectable(candidate)) return candidate;
  }
  return stepDirection;
}
