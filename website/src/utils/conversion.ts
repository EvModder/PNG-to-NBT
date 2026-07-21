/**
 * Public API:
 * - isStaircaseBuildMode()
 * - isSuppressBuildMode()
 * - isSuppressStepsBuildMode()
 * - buildModeUsesLayerGap()
 * - isCrubTechBuildMode()
 * - buildModeUsesPaletteSeed()
 * - shouldIncludeTransparentBlocks()
 * - getBuildModeRangeMax()
 * - getVisibleSuppressBuildModes()
 * - resolveBuildModeSelection()
 * - isSuppressStepDirection()
 * - getBuildModeDownloadSuffix()
 * - getSuppressStepDirectionRotationDegrees()
 * - cycleSuppressStepDirection()
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/ToolbarBuildSettings.tsx
 * - src/lib/buildModeShapes.ts
 * - src/lib/codecPreset.ts
 * - src/lib/nbtExport.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/suppressLoadMarkers.ts
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
// - src/lib/codecPreset.ts
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
): string {
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
      return "-suppress_2layer";
    case BuildMode.Suppress2LayerLatePairs:
    case BuildMode.Suppress2Layer:
      return crubTech ? "-suppress_crubtech" : "-suppress_2layer";
  }
}

// Callers:
// - src/components/ToolbarBuildSettings.tsx
export function getSuppressStepDirectionRotationDegrees(direction: SuppressStepDirection): number {
  switch (direction) {
    case SuppressStepDirection.SouthToNorth:
      return 0;
    case SuppressStepDirection.WestToEast:
      return 90;
    case SuppressStepDirection.NorthToSouth:
      return 180;
    case SuppressStepDirection.EastToWest:
      return 270;
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
// - src/lib/shapeGeneration.ts
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
// - src/lib/shapeGeneration.ts
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
export function getBuildModeRangeMax(buildMode: BuildMode): number {
  switch (buildMode) {
    case BuildMode.SuppressStepPairs:
      return 128;
    case BuildMode.SuppressStepChecker:
      return 64;
    default:
      return 127;
  }
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
  suppressStepDirection: SuppressStepDirection,
  lockFlatBuildMode: boolean,
  switchToSuppressCheckerIfContainsVoidShadows: boolean,
  hasVoidShadow: boolean,
  preferLatePairs: boolean,
  staircaseModes: readonly BuildMode[],
  suppressModes: readonly BuildMode[],
): { buildMode: BuildMode; suppressStepDirection: SuppressStepDirection } {
  let nextBuildMode = buildMode;
  let nextSuppressStepDirection = suppressStepDirection;

  if (lockFlatBuildMode) return { buildMode: BuildMode.Flat, suppressStepDirection };
  if (switchToSuppressCheckerIfContainsVoidShadows && hasVoidShadow && isStaircaseBuildMode(nextBuildMode)) {
    nextBuildMode = BuildMode.SuppressStepChecker;
    nextSuppressStepDirection = SuppressStepDirection.EastToWest;
  } else if (nextBuildMode === BuildMode.Flat) {
    nextBuildMode = BuildMode.StaircaseClassic;
  }

  const visibleModes = new Set([...staircaseModes, ...suppressModes]);
  if (visibleModes.has(nextBuildMode)) {
    return { buildMode: nextBuildMode, suppressStepDirection: nextSuppressStepDirection };
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

  return { buildMode: nextBuildMode, suppressStepDirection: nextSuppressStepDirection };
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
