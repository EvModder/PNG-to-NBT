/**
 * Public API:
 * - isStaircaseBuildMode()
 * - isSuppressBuildMode()
 * - isSuppressStepsBuildMode()
 * - buildModeUsesLayerGap()
 * - buildModeUsesPaletteSeed()
 * - shouldIncludeTransparentBlocks()
 * - getBuildModeRangeMax()
 * - getVisibleSuppressBuildModes()
 * - isSuppressStepDirection()
 * - getBuildModeDownloadSuffix()
 * - getSuppressStepDirectionRotationDegrees()
 * - cycleSuppressStepDirection()
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/ToolbarBuildSettings.tsx
 * - src/lib/codecPreset.ts
 * - src/lib/suppressLoadMarkers.ts
 * - src/lib/shapeGeneration.ts
 * - tests/run.mts
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
// - tests/run.mts
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
    case BuildMode.Suppress2Layer:
    case BuildMode.Suppress2LayerLateFillers:
      return "-suppress_2layer";
    case BuildMode.Suppress2LayerLatePairs:
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
// - src/lib/suppressLoadMarkers.ts
export function isSuppressBuildMode(buildMode: BuildMode): boolean {
  return !isStaircaseBuildMode(buildMode);
}

// Callers:
// - src/Index.tsx
// - src/lib/shapeGeneration.ts
// - tests/run.mts
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
// - src/lib/shapeGeneration.ts
// - tests/run.mts
export function buildModeUsesPaletteSeed(buildMode: BuildMode): boolean {
  return buildMode === BuildMode.StaircaseParty;
}

// Callers:
// - src/Index.tsx
// - tests/run.mts
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
export function getVisibleSuppressBuildModes(hasTwoLayerLateVoidNeed: boolean): BuildMode[] {
  return hasTwoLayerLateVoidNeed
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
