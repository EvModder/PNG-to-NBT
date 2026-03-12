/**
 * Public API:
 * - CustomColor
 * - BuildMode
 * - FillerRole
 * - FillerAssignment
 * - getCanonicalBuildMode()
 * - isStaircaseBuildMode()
 * - isSuppressBuildMode()
 * - buildModeUsesLayerGap()
 * - buildModeUsesPaletteSeed()
 * - getBuildModeRangeMax()
 * - SubstitutionOptions
 * - ExportOptions
 *
 * Used by:
 * - src/Index.tsx
 * - src/lib/nbtExport.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/shapeSubstitution.ts
 * - src/lib/shapeTypes.ts
 */
export interface CustomColor {
  r: number;
  g: number;
  b: number;
  block: string;
}

export enum BuildMode {
  Flat = "flat",
  InclineUp = "incline_up",
  InclineDown = "incline_down",
  StaircaseNorthline = "staircase_northline",
  StaircaseSouthline = "staircase_southline",
  StaircaseClassic = "staircase_classic",
  StaircaseGrouped = "staircase_grouped",
  StaircaseValley = "staircase_valley",
  StaircaseParty = "staircase_party",
  SuppressSplitRow = "suppress_split_row",
  SuppressSplitChecker = "suppress_split_checker",
  SuppressCheckerEW = "suppress_checker_ew",
  SuppressPairsEW = "suppress_pairs_ew",
  Suppress2Layer = "suppress_2layer",
  Suppress2LayerLateFillers = "suppress_2layer_late_fillers",
  Suppress2LayerLatePairs = "suppress_2layer_late_pairs",
}

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
}

type CanonicalBuildMode = Exclude<
  BuildMode,
  BuildMode.Flat | BuildMode.InclineUp | BuildMode.InclineDown | BuildMode.Suppress2Layer
>;

export function getCanonicalBuildMode(buildMode: BuildMode): CanonicalBuildMode {
  switch (buildMode) {
    case BuildMode.Flat:
    case BuildMode.InclineUp:
    case BuildMode.InclineDown:
      return BuildMode.StaircaseNorthline;
    case BuildMode.Suppress2Layer:
      return BuildMode.Suppress2LayerLateFillers;
    default:
      return buildMode;
  }
}

export function isStaircaseBuildMode(buildMode: BuildMode): boolean {
  switch (buildMode) {
    case BuildMode.Flat:
    case BuildMode.InclineUp:
    case BuildMode.InclineDown:
    case BuildMode.StaircaseNorthline:
    case BuildMode.StaircaseSouthline:
    case BuildMode.StaircaseClassic:
    case BuildMode.StaircaseGrouped:
    case BuildMode.StaircaseValley:
    case BuildMode.StaircaseParty:
      return true;
    default:
      return false;
  }
}

export function isSuppressBuildMode(buildMode: BuildMode): boolean {
  return !isStaircaseBuildMode(buildMode);
}

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

export function buildModeUsesPaletteSeed(buildMode: BuildMode): boolean {
  return buildMode === BuildMode.StaircaseParty;
}

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

export interface FillerAssignment {
  role: FillerRole;
  block: string;
}

export interface SubstitutionOptions {
  blockMapping: Record<number, string>;
  fillerAssignments: FillerAssignment[];
  assumeFloor: boolean;
  forceZ129?: boolean;
  customColors: CustomColor[];
  columnRange?: [number, number];
  stepRange?: [number, number];
}

export interface ExportOptions extends SubstitutionOptions {
  baseName: string;
}
