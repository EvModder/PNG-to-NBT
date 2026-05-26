/**
 * Public API:
 * - BuildMode
 * - SuppressStepDirection
 * - FillerRole
 * - FillerAssignment
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelImagePreview.tsx
 * - src/components/ToolbarBuildSettings.tsx
 * - src/data/defaultSettings.ts
 * - src/data/i18n/*
 * - src/utils/conversion.ts
 * - src/lib/fillerRules.ts
 * - src/lib/messages.ts
 * - src/lib/codecPreset.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeModel.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/nbtExport.ts
 * - src/lib/suppressLoadMarkers.ts
 * - src/types/shape.ts
 * - tests/run.mts
 */

// Callers:
// - src/Index.tsx
// - src/components/PanelImagePreview.tsx
// - src/components/ToolbarBuildSettings.tsx
// - src/data/defaultSettings.ts
// - src/data/i18n/*
// - src/utils/conversion.ts
// - src/lib/messages.ts
// - src/lib/codecPreset.ts
// - src/lib/nbtExport.ts
// - src/lib/shapeGeneration.ts
// - src/lib/suppressLoadMarkers.ts
// - tests/run.mts
export enum BuildMode {
  Flat = "flat",
  InclineUp = "incline_up",
  InclineDown = "incline_down",
  StaircaseNorthline = "staircase_northline",
  StaircaseSouthline = "staircase_southline",
  StaircaseClassic = "staircase_classic",
  StaircaseValley = "staircase_valley",
  StaircaseGroup = "staircase_group",
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
// - src/Index.tsx
// - src/components/ToolbarBuildSettings.tsx
// - src/data/defaultSettings.ts
// - src/data/i18n/*
// - src/utils/conversion.ts
// - src/lib/messages.ts
// - src/lib/codecPreset.ts
// - src/lib/nbtExport.ts
// - src/lib/shapeGeneration.ts
// - src/lib/suppressLoadMarkers.ts
// - tests/run.mts
export enum SuppressStepDirection {
  EastToWest = "east_to_west",
  WestToEast = "west_to_east",
  NorthToSouth = "north_to_south",
  SouthToNorth = "south_to_north",
}

// Callers:
// - src/Index.tsx
// - src/lib/fillerRules.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeModel.ts
// - src/lib/shapeGeneration.ts
// - src/types/shape.ts
export enum FillerRole {
  ShadeNorthRow = "shade_north_row",
  ShadeSuppress = "shade_suppress",
  ShadeNorthRowBreakable = "shade_north_row_breakable",
  ShadeNorthRowPushable = "shade_north_row_pushable",
  ShadeSuppressBreakable = "shade_suppress_breakable",
  ShadeSuppressPushable = "shade_suppress_pushable",
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
// - src/lib/fillerRules.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/nbtExport.ts
export interface FillerAssignment {
  role: FillerRole;
  block: string;
}
