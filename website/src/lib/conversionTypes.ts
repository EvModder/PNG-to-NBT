/**
 * Public API:
 * - CustomColor
 * - BuildMode
 * - FillerRole
 * - isStaircaseBuildMode()
 * - isSuppressBuildMode()
 * - buildModeUsesLayerGap()
 * - buildModeUsesMixSteps()
 * - buildModeUsesPaletteSeed()
 * - getBuildModeRangeMax()
 * - FillerAssignment
 *
 * Callers:
 * - src/Index.tsx
 * - src/data/i18n/*
 * - src/lib/fillerRules.ts
 * - src/lib/materialRules.ts
 * - src/lib/messages.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeCellRules.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/shapeSubstitution.ts
 * - src/lib/shapeTypes.ts
 */
// Callers:
// - src/Index.tsx
// - src/lib/materialRules.ts
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
// - src/Index.tsx
// - src/data/i18n/*
// - src/lib/messages.ts
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
  SuppressCheckerEW = "suppress_checker_ew",
  SuppressPairsEW = "suppress_pairs_ew",
  Suppress2Layer = "suppress_2layer",
  Suppress2LayerLateFillers = "suppress_2layer_late_fillers",
  Suppress2LayerLatePairs = "suppress_2layer_late_pairs",
}

// Callers:
// - src/Index.tsx
// - src/lib/fillerRules.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeCellRules.ts
// - src/lib/shapeGeneration.ts
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
export function buildModeUsesMixSteps(buildMode: BuildMode): boolean {
  switch (buildMode) {
    case BuildMode.SuppressCheckerEW:
    case BuildMode.SuppressPairsEW:
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
    case BuildMode.SuppressCheckerEW:
      return 64;
    case BuildMode.SuppressPairsEW:
      return 128;
    default:
      return 127;
  }
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
