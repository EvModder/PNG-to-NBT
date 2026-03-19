/**
 * Public API:
 * - CustomColor
 * - BuildMode
 * - FillerRole
 * - isStaircaseBuildMode()
 * - isSuppressBuildMode()
 * - buildModeUsesLayerGap()
 * - buildModeUsesPaletteSeed()
 * - getBuildModeRangeMax()
 * - getVisibleSuppressBuildModes()
 * - SuppressStepDirection
 * - isSuppressStepDirection()
 * - getBuildModeDownloadSuffix()
 * - getSuppressStepDirectionRotationDegrees()
 * - cycleSuppressStepDirection()
 * - FillerAssignment
 *
 * Callers:
 * - src/data/defaultSettings.ts
 * - src/Index.tsx
 * - src/data/i18n/*
 * - src/lib/fillerRules.ts
 * - src/lib/materialRules.ts
 * - src/lib/messages.ts
 * - src/lib/presetCodec.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeCellRules.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/shapeSubstitution.ts
 * - src/lib/shapeTypes.ts
 */
// Callers:
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/lib/materialRules.ts
// - src/lib/presetCodec.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeCellRules.ts
// - src/lib/shapeSubstitution.ts
export interface CustomColor {
  r: number;
  g: number;
  b: number;
  block: string;
}

// Callers:
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/data/i18n/*
// - src/lib/messages.ts
// - src/lib/presetCodec.ts
// - src/lib/shapeGeneration.ts
export enum BuildMode {
  Flat = "flat",
  InclineUp = "incline_up",
  InclineDown = "incline_down",
  StaircaseNorthline = "staircase_northline",
  StaircaseSouthline = "staircase_southline",
  StaircaseClassic = "staircase_classic",
  StaircaseValley = "staircase_valley",
  StaircaseGrouped = "staircase_grouped",
  StaircaseParty = "staircase_party",
  SuppressSplitRow = "suppress_split_row",
  SuppressSplitChecker = "suppress_split_checker",
  SuppressStepPairs = "suppress_step_pairs",
  SuppressStepChecker = "suppress_step_checker",
  Suppress2Layer = "suppress_2layer",
  Suppress2LayerLateFillers = "suppress_2layer_late_fillers",
  Suppress2LayerLatePairs = "suppress_2layer_late_pairs",
}

// Callers:
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/lib/messages.ts
// - src/lib/presetCodec.ts
// - src/lib/shapeGeneration.ts
export enum SuppressStepDirection {
  EastToWest = "east_to_west",
  WestToEast = "west_to_east",
  NorthToSouth = "north_to_south",
  SouthToNorth = "south_to_north",
}

const SUPPRESS_STEP_DIRECTIONS = [
  SuppressStepDirection.WestToEast,
  SuppressStepDirection.NorthToSouth,
  SuppressStepDirection.EastToWest,
  SuppressStepDirection.SouthToNorth,
] as const satisfies readonly SuppressStepDirection[];

// Callers:
// - src/Index.tsx
// - src/lib/presetCodec.ts
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
    case BuildMode.StaircaseGrouped:
      return "-grouped";
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
    case BuildMode.Suppress2LayerLatePairs:
      return "-suppress_2layer";
  }
}

// Callers:
// - src/Index.tsx
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
// - src/lib/fillerRules.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeCellRules.ts
// - src/lib/shapeGeneration.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeTypes.ts
export enum FillerRole {
  ShadeNorthRow = "shade_north_row",
  ShadeSuppress = "shade_suppress",
  ShadeSuppressLate = "shade_suppress_late",
  ShadeVoidDominant = "shade_void_dominant",
  ShadeVoidRecessive = "shade_void_recessive",

  StairStep = "convenience_stair_step",
  WaterPath = "convenience_water_path",

  SupportAll = "support_all",
  SupportFragile = "support_fragile",
  SupportWaterBase = "support_water_base",
  SupportWaterSides = "support_water_sides",
  SupportWaterSidesCovered = "support_water_sides_covered",
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
    case BuildMode.StaircaseGrouped:
    case BuildMode.StaircaseParty:
      return true;
    default:
      return false;
  }
}

// Callers:
// - src/Index.tsx
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
export function buildModeUsesPaletteSeed(buildMode: BuildMode): boolean {
  return buildMode === BuildMode.StaircaseParty;
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
export function cycleSuppressStepDirection(
  stepDirection: SuppressStepDirection,
): SuppressStepDirection {
  const index = SUPPRESS_STEP_DIRECTIONS.indexOf(stepDirection);
  if (index < 0) return SUPPRESS_STEP_DIRECTIONS[0];
  return SUPPRESS_STEP_DIRECTIONS[(index + 1) % SUPPRESS_STEP_DIRECTIONS.length];
}

// Callers:
// - src/Index.tsx
// - src/lib/fillerRules.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeSubstitution.ts
export interface FillerAssignment {
  role: FillerRole;
  block: string;
}
