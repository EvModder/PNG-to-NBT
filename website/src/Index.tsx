import { startTransition, useState, useEffect, useCallback, useRef, useMemo, useDeferredValue, useLayoutEffect, useEffectEvent, type ChangeEvent } from "react";
import { Languages, Moon, Sun } from "lucide-react";
import {
  DEFAULT_ACTIVE_PRESET_NAME,
  DEFAULT_SUPPORT_FILLER_BLOCK,
  DEFAULT_SHADE_FILLER_BLOCK,
  DEFAULT_CRUBTECH_SHADE_BREAKABLE_FILLER_BLOCK,
  DEFAULT_CRUBTECH_SHADE_PUSHABLE_FILLER_BLOCK,
  DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK,
  DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK,
  DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK,
  DEFAULT_BUILD_MODE,
  DEFAULT_SUPPORT_MODE,
  DEFAULT_SUPPRESS_STEP_DIRECTION,
  DEFAULT_VS_FILLER_LOAD_DIRECTION,
  DEFAULT_PALETTE_SEED,
  DEFAULT_LAYER_GAP,
  DEFAULT_SUPPRESS_2LAYER_LATE_PAIRS_GAP,
  DEFAULT_CRUBTECH_LAYER_GAP,
  DEFAULT_CRUBTECH_LATE_PAIRS_GAP,
  DEFAULT_CRUBTECH,
  DEFAULT_MIX_STEPS,
  DEFAULT_LIGHT_WATER_DROP,
  DEFAULT_FLAT_WATER_DROP,
  DEFAULT_DARK_WATER_DROP,
  DEFAULT_CRUBTECH_LIGHT_WATER_DROP,
  DEFAULT_CRUBTECH_FLAT_WATER_DROP,
  DEFAULT_CRUBTECH_DARK_WATER_DROP,
  DEFAULT_BUILD_AT_WORLD_MIN_Y,
  DEFAULT_SHOW_VS_FILLERS_IN_PREVIEW,
  DEFAULT_SHOW_IDS,
  DEFAULT_SHOW_NAMES,
  DEFAULT_SHOW_OPTIONS,
  DEFAULT_BLOCK_DISPLAY_MODE,
  DEFAULT_BLOCK_COLUMN_EXPANDED,
  DEFAULT_SORT_KEY,
  DEFAULT_SORT_DIR,
  DEFAULT_MC_UNITS,
  DEFAULT_MAX_PER_SPLIT,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_SHOW_TRANSPARENT_ROW,
  DEFAULT_SHOW_EXCLUDED_BLOCKS,
  DEFAULT_COLLAPSE_DUPLICATE_NBT_PALETTE_STATES,
  DEFAULT_FORCE_XZ128,
  DEFAULT_FORCE_Z129,
  DEFAULT_APPLY_SUPPORT_FLOOR_YS,
  DEFAULT_BELOW_PLATFORM_WATER,
  DEFAULT_SKIP_EMPTY_SUPPRESS_STEPS,
  DEFAULT_SHOW_FLAT_NBT_SUPPRESS_STEP_MODES,
  DEFAULT_MARK_SUPPRESS_LOAD_SPOTS_IN_SCHEMATIC,
  SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS,
  type SuppressLoadSpotMarkerBlock,
  DEFAULT_SUPPRESS_LOAD_SPOT_MARKER_BLOCK,
  DEFAULT_SHOW_VS_FILLER_WARNINGS,
  DEFAULT_SHOW_ALIGNMENT_REMINDER,
  DEFAULT_SHOW_NOOBLINE_WARNINGS,
  DEFAULT_CONVERT_UNSUPPORTED_COLORS,
  DEFAULT_CROP_IMAGE,
  DEFAULT_SWITCH_TO_SUPPRESS_CHECKER_IF_CONTAINS_VOID_SHADOWS,
} from "@/data/defaultSettings";
import { BASE_COLORS, TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX, Shade } from "@/data/mapColors";
import { STORAGE_KEYS as LS_KEYS } from "@/data/storageKeys";
import { convertToNbtEntries } from "@/lib/nbtExport";
import {
  convertImageToColorGridSet,
  convertImageToColorGridSetAsync,
  type ColorGridSetParseResult,
  type ParsedColorGridTile,
  loadImageDataFromFile,
} from "@/lib/colorGridParsing";
import {
  collectShadeCountsByColorRefKey,
  type ColorFrequencyMap,
  computeColorGridStats,
  FlatModeBehavior,
  hasStepMixOpportunity,
  type ColorGridStats,
  type WaterDrops,
} from "@/lib/colorGridAnalysis";
import { decodeColorGrid, encodeColorGrid } from "@/lib/codecColorGrid";
import { createImageDataFromColorGrid, MAP_SIZE } from "@/utils/color";
import {
  areCustomColorsEqual,
  areCustomSelectedBlocksEqual,
  buildCustomBlocksByBase,
  cloneCustomColors,
  getParseRelevantCustomColorsKey,
  getSelectedCustomColorBlock,
  normalizeCustomSelectedBlocks,
  removeCustomColorBlock,
  sanitizeCustomRgbDraftValue,
  selectCustomColorBlock,
  upsertCustomColorBlock,
} from "@/utils/customColors";
import type { ColorGrid, ColorRgb } from "@/types/color";
import {
  analyzeFragileSupportOverrideNeeds,
  analyzeMaterialNeeds,
  hasBuildAtWorldMinYOpportunity,
} from "@/lib/shapeAnalysis";
import { getCachedShapeFillerNeeds, getCachedShapeNooblineIsSingleY } from "@/lib/shapeAnalysisCache";
import {
  type ColorBlockSelections,
  hasAssignedColorBlock,
  normalizeBlockId,
  resolveAssignedColorBlock,
  sanitizeUserBlockEntry,
} from "@/lib/blockId";
import { getColorRefKey, parseColorRefKey, type ColorRefKey } from "@/lib/colorRefs";
import {
  createFillerAssignments,
  getSupportModeFillerRoles,
  isCrubTechBreakableValid,
  isCrubTechPushableValid,
  isFillerDisabled,
  isShadeFillerDisabled,
  isWaterSideSupportFillerValid,
} from "@/lib/fillerRules";
import {
  LOCALE_BROWSER,
  messages,
  PaletteNoticeKind,
  getLocaleLabel,
  getLocalePreference,
  setLocalePreference,
  SUPPORTED_LOCALES,
  type LocalePreference,
  type PaletteNotice,
} from "@/lib/messages";
import { decodeFullPreset, encodeFullPreset, loadPresets } from "@/lib/codecPreset";
import { getColorGridCacheKey } from "@/utils/colorGridKey";
import { getShapeForBuildMode } from "@/lib/buildModeShapes";
import {
  collectVsFillerPreviewReplacements,
  usePreviewVisiblePixelMask,
  useVsFillerPreviewReplacements,
  type PreviewPixelMask,
  type PreviewPixelReplacement,
} from "@/lib/previewImageEdits";
import { usePreviewImageUrl } from "@/lib/previewImageStore";
import { getSupportedColorAbove, isShapeFillerCell, isWithinShapeBounds, NO_SUPPORT_FLOORS, parseShapeCoordKey } from "@/lib/shapeModel";
import { type BlockDisplayMode, type ColumnId, type SortDir, type SortKey, SupportMode } from "@/types/ui";
import { INITIAL_COLOR_TABLE_LAYOUT, type ColorTableLayout } from "@/utils/colorTableLayout";
import {
  getBuildModeDownloadSuffix,
  buildModeUsesLayerGap,
  isSuppressStepsBuildMode,
  buildModeUsesPaletteSeed,
  cycleSuppressStepDirection,
  getBuildModeRangeMax,
  isSuppressStepDirection,
  isStaircaseBuildMode,
  isSuppressBuildMode,
  isCrubTechBuildMode,
  getVisibleSuppressBuildModes,
  shouldIncludeTransparentBlocks,
} from "@/utils/conversion";
import { getClipboardImageFile } from "@/utils/imageInput";
import { formatStacks } from "@/utils/minecraft";
import { BuildMode, SuppressStepDirection, type FillerAssignment, FillerRole } from "@/types/conversion";
import { getPaletteSeedOffset } from "@/lib/paletteSeed";
import { FRAGILE_SUPPORT_RULES, isFragileBlock } from "@/data/fragileBlocks";
import {
  arePresetBlocksEqual,
  BUILTIN_PRESET_NAMES,
  CRUBTECH_PRESET_NAME,
  findMatchingBuiltinPresetName,
  getBuiltinPreset,
  isAutoCustomPresetName,
  type BlockPreset,
} from "@/data/presets";
import { ToolbarPresetSettings } from "@/components/ToolbarPresetSettings";
import { ToolbarFillerSettings } from "@/components/ToolbarFillerSettings";
import { PanelColorBlockTable } from "@/components/PanelColorBlockTable";
import { PanelCustomColors } from "@/components/PanelCustomColors";
import { PanelCredits } from "@/components/PanelCredits";
import { PanelImagePreview } from "@/components/PanelImagePreview";
import { SecretsSettingsDialog } from "@/components/SecretsSettingsDialog";
import { createZip } from "@/utils/zip";
import type { GeneratedShape } from "@/types/shape";
import { yieldToMainThread } from "@/utils/asyncWork";
import { getTileBaseGeometry, getTileFinalGeometry } from "@/lib/tileGeometryWorkerClient";
import type { TileWaterSetting } from "@/lib/tileGeometryWorkerTypes";

function loadCached<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return JSON.parse(v);
  } catch {
    /* ignore */
  }
  return fallback;
}

function clampLatePairsGap(value: number, maxGap: number): number {
  const nextValue = Number.isFinite(value) ? Math.trunc(value) : DEFAULT_SUPPRESS_2LAYER_LATE_PAIRS_GAP;
  return Math.max(1, Math.min(maxGap, nextValue));
}

const DEFAULT_WEST_EAST_SLOPE_RUN = 0;
const DEFAULT_WEST_EAST_SLOPE_RISE = 0;

function clampWestEastSlopeRun(value: number): number {
  const nextValue = Number.isFinite(value) ? Math.trunc(value) : DEFAULT_WEST_EAST_SLOPE_RUN;
  return Math.max(0, Math.min(MAP_SIZE - 1, nextValue));
}

function clampWestEastSlopeRise(value: number): number {
  const nextValue = Number.isFinite(value) ? Math.trunc(value) : DEFAULT_WEST_EAST_SLOPE_RISE;
  return nextValue;
}

const WATER_DROP_INPUT_ORDER = [Shade.Light, Shade.Flat, Shade.Dark] as const;
type WaterDropShade = typeof WATER_DROP_INPUT_ORDER[number];
const CRUBTECH_WATER_DROPS = [
  DEFAULT_CRUBTECH_DARK_WATER_DROP,
  DEFAULT_CRUBTECH_FLAT_WATER_DROP,
  DEFAULT_CRUBTECH_LIGHT_WATER_DROP,
] as const satisfies WaterDrops;
const CRUBTECH_SHAPE_WATER_DROPS = CRUBTECH_WATER_DROPS.map(drop => drop + 1) as WaterDrops;
type TileSelectionModifiers = {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
};
type DerivedImageStats = {
  allSameShade?: Shade;
  flatModeBehavior: FlatModeBehavior;
  hasTransparency: boolean;
  paletteUsageInfo: {
    uniqueShadeCount: number;
    uniqueBaseColorCount: number;
  };
  usedShadesByColorKey: Map<ColorRefKey, Set<Shade>>;
};
type MaterialCountsLike = Pick<
  ReturnType<typeof analyzeMaterialNeeds>,
  "blockCounts" | "colorCounts" | "fillerRoleCounts"
>;
type TileBaseAnalysis = {
  tile: ParsedColorGridTile;
  derivedImageStats: DerivedImageStats;
  hasWater: boolean;
  waterSetting: TileWaterSetting;
  baseShapeMap: Partial<Record<BuildMode, GeneratedShape>>;
  baseNorthlineShape: GeneratedShape | null;
  flatModeBehavior: FlatModeBehavior;
  isFlatShape: boolean;
};
type TileGeometryAnalysis = TileBaseAnalysis & {
  shapeMap: Partial<Record<BuildMode, GeneratedShape>>;
  northlineShape: GeneratedShape | null;
  supportShape: GeneratedShape | null;
  fillerNeedStats: { roleCounts: Map<FillerRole, number> } | null;
  northRowSingleLine: boolean;
};
type TileAnalysis = TileGeometryAnalysis & {
  materialNeedStats: ReturnType<typeof analyzeMaterialNeeds> | null;
  fragileSupportOverrideNeedStats: ReturnType<typeof analyzeFragileSupportOverrideNeeds> | null;
};
type TileAnalysisResult = {
  tileGeometryAnalyses: TileGeometryAnalysis[];
  aggregateFillerRoleCounts: Map<FillerRole, number>;
};
type AnalysisProgress = {
  completed: number;
  total: number;
};
type TileAnalysisPhase = "generating" | "fillerAnalysis";

const EMPTY_USED_SHADES_BY_COLOR_KEY = new Map<ColorRefKey, Set<Shade>>();
const EMPTY_USED_COLOR_KEYS = new Set<ColorRefKey>();
const EMPTY_USED_WATER_SHADES = new Set<Shade>();
const EMPTY_FILLER_ROLE_COUNTS = new Map<FillerRole, number>();
const EMPTY_COLOR_COUNTS: Readonly<Record<string, number>> = Object.freeze({});
const EMPTY_MATERIAL_COUNTS: Readonly<MaterialCountsLike> = Object.freeze({
  blockCounts: EMPTY_COLOR_COUNTS,
  colorCounts: EMPTY_COLOR_COUNTS,
  fillerRoleCounts: EMPTY_FILLER_ROLE_COUNTS,
});

function areTileAnalysesShallowEqual(left: readonly TileAnalysis[], right: readonly TileAnalysis[]): boolean {
  return left.length === right.length && left.every((tile, index) => tile === right[index]);
}

function buildTileSelectionRange(anchorIndex: number, targetIndex: number): number[] {
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function normalizeTileSelection(selection: readonly number[], tileCount: number): number[] {
  const next = [...new Set(selection)]
    .filter(index => index >= 0 && index < tileCount)
    .toSorted((a, b) => a - b);
  return next.length === 0 || next.length === tileCount ? [] : next;
}

function getEffectiveTileSelection(selection: readonly number[], tileCount: number): number[] {
  if (selection.length > 0) return [...selection];
  return Array.from({ length: tileCount }, (_, index) => index);
}

function mergeTileSelections(current: readonly number[], next: readonly number[]): number[] {
  return [...new Set([...current, ...next])].toSorted((a, b) => a - b);
}

function toggleTileSelectionIndex(current: readonly number[], tileIndex: number): number[] {
  if (current.includes(tileIndex)) return current.filter(index => index !== tileIndex);
  return [...current, tileIndex].toSorted((a, b) => a - b);
}

function normalizeUsedWaterDrops(
  rawDrops: Record<WaterDropShade, number>,
  usedWaterShades: ReadonlySet<Shade>,
  preferredFirstShade?: WaterDropShade,
): readonly [dark: number, flat: number, light: number] {
  const next: [number, number, number] = [
    Math.max(0, rawDrops[Shade.Dark] || 0),
    Math.max(0, rawDrops[Shade.Flat] || 0),
    Math.max(0, rawDrops[Shade.Light] || 0),
  ];
  const usedValues = new Set<number>();
  const orderedShades = preferredFirstShade === undefined
    ? WATER_DROP_INPUT_ORDER
    : [preferredFirstShade, ...WATER_DROP_INPUT_ORDER.filter(shade => shade !== preferredFirstShade)];

  for (const shade of orderedShades) {
    if (!usedWaterShades.has(shade)) continue;
    let value = next[shade];
    while (usedValues.has(value)) ++value;
    next[shade] = value;
    usedValues.add(value);
  }

  return next;
}

function buildWaterDropInputs(dark: number, flat: number, light: number): Record<WaterDropShade, number> {
  return {
    [Shade.Dark]: dark,
    [Shade.Flat]: flat,
    [Shade.Light]: light,
  };
}

function hasAnySharedValue<T>(values: Iterable<T>, target: ReadonlySet<T>): boolean {
  for (const value of values) {
    if (target.has(value)) return true;
  }
  return false;
}

function useHeldValueWhilePending<T>(value: T, pending: boolean): T {
  const heldValueRef = useRef(value);

  useEffect(() => {
    if (!pending) {
      heldValueRef.current = value;
    }
  }, [pending, value]);

  return pending ? heldValueRef.current : value;
}

function hasCurrentTileGeometryAnalyses(
  parsedTiles: readonly ParsedColorGridTile[],
  tileGeometryAnalyses: readonly TileGeometryAnalysis[],
): boolean {
  if (parsedTiles.length === 0 || tileGeometryAnalyses.length !== parsedTiles.length) return false;
  return parsedTiles.every((tile, index) => tileGeometryAnalyses[index]?.tile.cacheKey === tile.cacheKey);
}

function hasCurrentMaterialAnalyses(
  tileGeometryAnalyses: readonly TileGeometryAnalysis[],
  tileAnalyses: readonly TileAnalysis[],
): boolean {
  if (tileAnalyses.length !== tileGeometryAnalyses.length) return false;
  return tileGeometryAnalyses.every((tile, index) => {
    const tileAnalysis = tileAnalyses[index];
    if (!tileAnalysis) return false;
    if (tileAnalysis.tile.cacheKey !== tile.tile.cacheKey) return false;
    if (tileAnalysis.supportShape !== tile.supportShape) return false;
    return !tile.supportShape || tileAnalysis.materialNeedStats !== null;
  });
}

function collectUsedShadesByColorKey(colorFrequencyMap: ColorFrequencyMap): Map<ColorRefKey, Set<Shade>> {
  const usedShadesByColorKey = new Map<ColorRefKey, Set<Shade>>();
  for (const [colorKey, shadeFrequencyMap] of colorFrequencyMap) {
    usedShadesByColorKey.set(getColorRefKey(colorKey), new Set(shadeFrequencyMap.keys()));
  }
  return usedShadesByColorKey;
}

function summarizeUsedShadesByColorKey(
  usedShadesByColorKey: ReadonlyMap<ColorRefKey, ReadonlySet<Shade>>,
): Pick<DerivedImageStats, "hasTransparency" | "paletteUsageInfo"> {
  let hasTransparency = false;
  let uniqueShadeCount = 0;
  let uniqueBaseColorCount = 0;

  for (const [colorKey, shades] of usedShadesByColorKey) {
    const color = parseColorRefKey(colorKey);
    if (color.isCustom) {
      uniqueShadeCount += shades.size;
      continue;
    }

    if (color.id === TRANSPARENCY_BASE_INDEX) {
      if (shades.has(Shade.Dark)) {
        hasTransparency = true;
      }
      continue;
    }

    ++uniqueBaseColorCount;
    uniqueShadeCount += shades.size;
  }

  return {
    hasTransparency,
    paletteUsageInfo: { uniqueShadeCount, uniqueBaseColorCount },
  };
}

function getUsedWaterShades(
  usedShadesByColorKey: ReadonlyMap<ColorRefKey, ReadonlySet<Shade>>,
): ReadonlySet<Shade> {
  return usedShadesByColorKey.get(getColorRefKey({ id: WATER_BASE_INDEX, isCustom: false })) ?? EMPTY_USED_WATER_SHADES;
}

function deriveImageStats(imageStats: ColorGridStats): DerivedImageStats {
  const usedShadesByColorKey = collectUsedShadesByColorKey(imageStats.colorFrequencyMap);
  return {
    allSameShade: imageStats.allSameShade,
    flatModeBehavior: imageStats.flatModeBehavior,
    usedShadesByColorKey,
    ...summarizeUsedShadesByColorKey(usedShadesByColorKey),
  };
}

function aggregateDerivedImageStats(tileImageStats: readonly ColorGridStats[]): DerivedImageStats {
  const usedShadesByColorKey = new Map<ColorRefKey, Set<Shade>>();
  for (const imageStats of tileImageStats) {
    for (const [colorKey, shadeFrequencyMap] of imageStats.colorFrequencyMap) {
      const stableKey = getColorRefKey(colorKey);
      let shades = usedShadesByColorKey.get(stableKey);
      if (!shades) {
        shades = new Set<Shade>();
        usedShadesByColorKey.set(stableKey, shades);
      }
      for (const shade of shadeFrequencyMap.keys()) shades.add(shade);
    }
  }

  return {
    allSameShade: undefined,
    flatModeBehavior: FlatModeBehavior.None,
    usedShadesByColorKey,
    ...summarizeUsedShadesByColorKey(usedShadesByColorKey),
  };
}

function aggregateMaterialCounts(
  stats: readonly MaterialCountsLike[],
  mode: "sum" | "max",
): MaterialCountsLike {
  const blockCounts: Record<string, number> = {};
  const colorCounts: Record<string, number> = {};
  const fillerRoleCounts = new Map<FillerRole, number>();

  for (const stat of stats) {
    for (const [blockName, count] of Object.entries(stat.blockCounts)) {
      blockCounts[blockName] = mode === "sum"
        ? (blockCounts[blockName] || 0) + count
        : Math.max(blockCounts[blockName] || 0, count);
    }
    for (const [colorKey, count] of Object.entries(stat.colorCounts)) {
      colorCounts[colorKey] = mode === "sum"
        ? (colorCounts[colorKey] || 0) + count
        : Math.max(colorCounts[colorKey] || 0, count);
    }
    for (const [role, count] of stat.fillerRoleCounts) {
      fillerRoleCounts.set(role, mode === "sum"
        ? (fillerRoleCounts.get(role) ?? 0) + count
        : Math.max(fillerRoleCounts.get(role) ?? 0, count),
      );
    }
  }

  return { blockCounts, colorCounts, fillerRoleCounts };
}

function aggregateOverrideCounts(
  stats: readonly NonNullable<ReturnType<typeof analyzeFragileSupportOverrideNeeds>>[],
): Record<string, number> {
  const overrideCounts: Record<string, number> = {};
  for (const stat of stats) {
    for (const [blockId, count] of Object.entries(stat.overrideCounts)) {
      overrideCounts[blockId] = (overrideCounts[blockId] || 0) + count;
    }
  }
  return overrideCounts;
}

function getAggregatedFlatModeBehavior(tileAnalyses: readonly TileBaseAnalysis[]): FlatModeBehavior {
  if (tileAnalyses.length === 0 || tileAnalyses.some(tile => !tile.isFlatShape)) return FlatModeBehavior.None;
  return tileAnalyses.some(tile => tile.flatModeBehavior === FlatModeBehavior.ToggleableBuildAtWorldMinY)
    ? FlatModeBehavior.ToggleableBuildAtWorldMinY
    : FlatModeBehavior.Plain;
}

function getTilePositionSuffix(tile: ParsedColorGridTile): string {
  return `-${tile.row + 1}_${tile.col + 1}`;
}

function buildExportStem(
  baseName: string,
  buildModeSuffix: string,
  tile: ParsedColorGridTile | null,
  splitName?: string,
): string {
  return `${baseName}${buildModeSuffix}${splitName ? `-${splitName}` : ""}${tile ? getTilePositionSuffix(tile) : ""}`;
}

type TileShape = {
  tileRows: number;
  tileCols: number;
  tileCount: number;
};

function getTileShapeForDimensions(width: number, height: number): TileShape {
  const tileRows = height > 0 && height % MAP_SIZE === 0 ? height / MAP_SIZE : 0;
  const tileCols = width > 0 && width % MAP_SIZE === 0 ? width / MAP_SIZE : 0;
  return {
    tileRows,
    tileCols,
    tileCount: tileRows * tileCols,
  };
}

function getExpectedTileShape(imageData: ImageData | null, cropImage: boolean): TileShape {
  if (!imageData) return { tileRows: 0, tileCols: 0, tileCount: 0 };
  return cropImage
    ? getTileShapeForDimensions(
        imageData.width - (imageData.width % MAP_SIZE),
        imageData.height - (imageData.height % MAP_SIZE),
      )
    : getTileShapeForDimensions(imageData.width, imageData.height);
}

function shouldUpdateMainThreadProgress(
  completed: number,
  total: number,
  lastUpdateAtMs: number,
  nowMs: number,
): boolean {
  return completed === total || nowMs - lastUpdateAtMs >= MAIN_THREAD_PROGRESS_INTERVAL_MS;
}

function offsetPreviewPixelReplacements(
  replacements: readonly PreviewPixelReplacement[],
  tile: ParsedColorGridTile,
): PreviewPixelReplacement[] {
  return replacements.map(replacement => ({
    ...replacement,
    x: replacement.x + tile.startX,
    z: replacement.z + tile.startZ,
  }));
}

function buildSelectedTileVisibleMask(
  imageData: ImageData,
  tile: ParsedColorGridTile,
  tileVisibleMask?: PreviewPixelMask | null,
  xColumnRange?: readonly [number, number],
): PreviewPixelMask | null {
  if (!tileVisibleMask && !xColumnRange) return null;
  const mask = new Uint8Array(imageData.width * imageData.height);
  mask.fill(1);

  for (let z = 0; z < 128; ++z) {
    for (let x = 0; x < 128; ++x) {
      const visibleByRange = !xColumnRange || (x >= xColumnRange[0] && x <= xColumnRange[1]);
      const visibleByMask = !tileVisibleMask || tileVisibleMask[z * 128 + x] !== 0;
      if (visibleByRange && visibleByMask) continue;
      const globalX = tile.startX + x;
      const globalZ = tile.startZ + z;
      mask[globalZ * imageData.width + globalX] = 0;
    }
  }

  return mask;
}

type ShapeWarning = {
  text: string;
  invalid: boolean;
};
type ModeOption = { value: BuildMode; label: string; disabled?: boolean; muted?: boolean };

const DEFAULT_STAIRCASE_OPTIONS: ModeOption[] = [
  { value: BuildMode.Flat, label: messages.buildMode.optionLabel(BuildMode.Flat) },
  { value: BuildMode.InclineUp, label: messages.buildMode.optionLabel(BuildMode.InclineUp) },
  { value: BuildMode.InclineDown, label: messages.buildMode.optionLabel(BuildMode.InclineDown) },
  { value: BuildMode.StaircaseNorthline, label: messages.buildMode.optionLabel(BuildMode.StaircaseNorthline) },
  { value: BuildMode.StaircaseSouthline, label: messages.buildMode.optionLabel(BuildMode.StaircaseSouthline) },
  { value: BuildMode.StaircaseClassic, label: messages.buildMode.optionLabel(BuildMode.StaircaseClassic) },
  { value: BuildMode.StaircaseValley, label: messages.buildMode.optionLabel(BuildMode.StaircaseValley) },
  { value: BuildMode.StaircaseGroup, label: messages.buildMode.optionLabel(BuildMode.StaircaseGroup) },
  { value: BuildMode.StaircaseParty, label: messages.buildMode.optionLabel(BuildMode.StaircaseParty) },
];
const PAGE_CONTENT_PADDING_PX = 8; // from outer wrapper `p-2`
const LAYOUT_GAP_PX = 8;
const MAIN_THREAD_PROGRESS_INTERVAL_MS = 32;
const PREVIEW_PAGE_COLUMN_MIN_WIDTH_PX = 320;
// Approximates the non-preview vertical chrome on the page (header, layout padding, and panel text/buttons)
// so the square preview can expand with viewport height on wide displays without forcing obvious vertical overflow.
const PREVIEW_PAGE_COLUMN_VERTICAL_OFFSET_PX = 120;
const PREVIEW_PAGE_COLUMN_MAX_WIDTH_CSS = `calc(100vh - ${PREVIEW_PAGE_COLUMN_VERTICAL_OFFSET_PX}px)`;

const BASE_SUPPRESS_OPTIONS: ModeOption[] = [
  { value: BuildMode.SuppressSplitRow, label: messages.buildMode.optionLabel(BuildMode.SuppressSplitRow), disabled: true, muted: true },
  { value: BuildMode.SuppressSplitChecker, label: messages.buildMode.optionLabel(BuildMode.SuppressSplitChecker), disabled: true, muted: true },
  { value: BuildMode.SuppressStepPairs, label: messages.buildMode.optionLabel(BuildMode.SuppressStepPairs) },
  { value: BuildMode.SuppressStepChecker, label: messages.buildMode.optionLabel(BuildMode.SuppressStepChecker) },
  { value: BuildMode.Suppress2Layer, label: messages.buildMode.optionLabel(BuildMode.Suppress2Layer) },
  { value: BuildMode.Suppress2LayerLateFillers, label: messages.buildMode.optionLabel(BuildMode.Suppress2LayerLateFillers) },
  { value: BuildMode.Suppress2LayerLatePairs, label: messages.buildMode.optionLabel(BuildMode.Suppress2LayerLatePairs) },
];

function getStaircaseModeOptionsForState(
  imageValid: boolean,
  tileBaseAnalyses: readonly TileBaseAnalysis[],
  tileDerivedImageStats: readonly DerivedImageStats[],
  isFlatShape: boolean,
  hasMultipleTiles: boolean,
  showFlatNbtSuppressStepOptions: boolean,
): ModeOption[] {
  if (!imageValid) {
    return DEFAULT_STAIRCASE_OPTIONS;
  }
  if (showFlatNbtSuppressStepOptions) {
    return DEFAULT_STAIRCASE_OPTIONS.filter(option => option.value === BuildMode.Flat);
  }
  if (hasMultipleTiles) {
    if (tileDerivedImageStats.length === 0) return DEFAULT_STAIRCASE_OPTIONS;
    const flatVisible = tileDerivedImageStats.every(tile => tile.flatModeBehavior !== FlatModeBehavior.None);
    const inclineUpVisible = tileDerivedImageStats.every(tile =>
      tile.allSameShade === Shade.Dark &&
      getUsedWaterShades(tile.usedShadesByColorKey).size === 0 &&
      !tile.hasTransparency,
    );
    const inclineDownVisible = tileDerivedImageStats.every(tile =>
      tile.allSameShade === Shade.Light &&
      getUsedWaterShades(tile.usedShadesByColorKey).size === 0 &&
      !tile.hasTransparency,
    );
    return DEFAULT_STAIRCASE_OPTIONS.filter(option => {
      switch (option.value) {
        case BuildMode.Flat:
          return flatVisible;
        case BuildMode.InclineUp:
          return inclineUpVisible;
        case BuildMode.InclineDown:
          return inclineDownVisible;
        default:
          return true;
      }
    });
  }
  if (tileBaseAnalyses.length === 0) {
    return DEFAULT_STAIRCASE_OPTIONS;
  }
  const visibleModes = new Set<BuildMode>();
  for (const tile of tileBaseAnalyses) {
    for (const mode of Object.keys(tile.baseShapeMap) as BuildMode[]) visibleModes.add(mode);
  }
  const inclineUpVisible = tileBaseAnalyses.every(tile => !!tile.baseShapeMap[BuildMode.InclineUp]);
  const inclineDownVisible = tileBaseAnalyses.every(tile => !!tile.baseShapeMap[BuildMode.InclineDown]);
  return DEFAULT_STAIRCASE_OPTIONS.filter(option => {
    switch (option.value) {
      case BuildMode.Flat:
        return isFlatShape;
      case BuildMode.InclineUp:
        return inclineUpVisible;
      case BuildMode.InclineDown:
        return inclineDownVisible;
      default:
        return visibleModes.has(option.value);
    }
  });
}

function getSuppressModeOptionsForState(
  twoLayerHasLateVoidNeed: boolean,
  hasMultipleTiles: boolean,
  showFlatNbtSuppressStepOptions: boolean,
): ModeOption[] {
  if (showFlatNbtSuppressStepOptions) {
    return BASE_SUPPRESS_OPTIONS.filter(option => isSuppressStepsBuildMode(option.value));
  }
  const visibleModes = new Set(getVisibleSuppressBuildModes(twoLayerHasLateVoidNeed));
  return BASE_SUPPRESS_OPTIONS.filter(option => {
    if (hasMultipleTiles && (option.value === BuildMode.SuppressSplitRow || option.value === BuildMode.SuppressSplitChecker)) {
      return false;
    }
    return visibleModes.has(option.value);
  });
}

function getFlatBuildAtWorldMinYEligible(
  tileBaseAnalyses: readonly TileBaseAnalysis[],
  applySupportFloorYs: boolean,
): boolean {
  return tileBaseAnalyses.some(tile =>
    tile.flatModeBehavior === FlatModeBehavior.ToggleableBuildAtWorldMinY &&
    !!tile.baseNorthlineShape &&
    hasBuildAtWorldMinYOpportunity(tile.tile.colorGrid, tile.baseNorthlineShape, applySupportFloorYs),
  );
}

function getBuildAtWorldMinYEligibleForBuildMode(
  tileBaseAnalyses: readonly TileBaseAnalysis[],
  buildMode: BuildMode,
  applySupportFloorYs: boolean,
): boolean {
  if (!isStaircaseBuildMode(buildMode)) return false;
  if (buildMode === BuildMode.Flat) {
    return getFlatBuildAtWorldMinYEligible(tileBaseAnalyses, applySupportFloorYs);
  }
  return tileBaseAnalyses.some(tile => {
    const shape = getShapeForBuildMode(tile.baseShapeMap, buildMode, tile.isFlatShape);
    return !!shape && hasBuildAtWorldMinYOpportunity(tile.tile.colorGrid, shape, applySupportFloorYs);
  });
}

function resolveBuildModeSelection(
  buildMode: BuildMode,
  suppressStepDirection: SuppressStepDirection,
  lockFlatBuildMode: boolean,
  hasVoidShadow: boolean,
  staircaseModeOptions: readonly ModeOption[],
  suppressModeOptions: readonly ModeOption[],
): { buildMode: BuildMode; suppressStepDirection: SuppressStepDirection } {
  let nextBuildMode = buildMode;
  let nextSuppressStepDirection = suppressStepDirection;

  if (lockFlatBuildMode) {
    return { buildMode: BuildMode.Flat, suppressStepDirection };
  }

  if (DEFAULT_SWITCH_TO_SUPPRESS_CHECKER_IF_CONTAINS_VOID_SHADOWS && hasVoidShadow && isStaircaseBuildMode(nextBuildMode)) {
    nextBuildMode = BuildMode.SuppressStepChecker;
    nextSuppressStepDirection = SuppressStepDirection.EastToWest;
  } else if (nextBuildMode === BuildMode.Flat) {
    nextBuildMode = BuildMode.StaircaseClassic;
  }

  const visibleModes = new Set<BuildMode>([
    ...staircaseModeOptions.map(option => option.value),
    ...suppressModeOptions.map(option => option.value),
  ]);

  if (!visibleModes.has(nextBuildMode)) {
    if (nextBuildMode === BuildMode.Suppress2Layer && visibleModes.has(BuildMode.Suppress2LayerLateFillers)) {
      nextBuildMode = BuildMode.Suppress2LayerLateFillers;
    } else if (nextBuildMode === BuildMode.Suppress2LayerLatePairs && visibleModes.has(BuildMode.Suppress2Layer)) {
      nextBuildMode = BuildMode.Suppress2Layer;
    } else if (nextBuildMode === BuildMode.Suppress2LayerLatePairs && visibleModes.has(BuildMode.Suppress2LayerLateFillers)) {
      nextBuildMode = BuildMode.Suppress2LayerLateFillers;
    } else {
      nextBuildMode = staircaseModeOptions[0]?.value ?? BuildMode.StaircaseClassic;
    }
  }

  return { buildMode: nextBuildMode, suppressStepDirection: nextSuppressStepDirection };
}

const getStoredTheme = (): "light" | "dark" | null => {
  const raw = localStorage.getItem(LS_KEYS.theme);
  return raw === "light" || raw === "dark" ? raw : null;
};

const getSystemPrefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

const resolveDarkTheme = () => {
  const stored = getStoredTheme();
  return stored ? stored === "dark" : getSystemPrefersDark();
};

// ── Component ──
const Index = () => {
  const [presets, setPresets] = useState<BlockPreset[]>(loadPresets);
  const [activeIdx, setActiveIdx] = useState(() => {
    try {
      const name = JSON.parse(localStorage.getItem(LS_KEYS.activePreset) || '""');
      const targetName = name || DEFAULT_ACTIVE_PRESET_NAME;
      const idx = loadPresets().findIndex(p => p.name === targetName);
      if (idx >= 0) return idx;
    } catch {
      /* ignore */
    }
    const idx = loadPresets().findIndex(p => p.name === DEFAULT_ACTIVE_PRESET_NAME);
    return idx >= 0 ? idx : 0;
  });
  const [supportFillerBlock, setSupportFillerBlock] = useState(() => loadCached(LS_KEYS.supportFiller, DEFAULT_SUPPORT_FILLER_BLOCK));
  const [shadeFillerBlock, setShadeFillerBlock] = useState(() => loadCached(LS_KEYS.shadeFiller, DEFAULT_SHADE_FILLER_BLOCK));
  const [crubTechShadeBreakableFillerBlock, setCrubTechShadeBreakableFillerBlock] = useState(() =>
    loadCached(LS_KEYS.crubTechShadeBreakableFiller, DEFAULT_CRUBTECH_SHADE_BREAKABLE_FILLER_BLOCK),
  );
  const [crubTechShadePushableFillerBlock, setCrubTechShadePushableFillerBlock] = useState(() =>
    loadCached(LS_KEYS.crubTechShadePushableFiller, DEFAULT_CRUBTECH_SHADE_PUSHABLE_FILLER_BLOCK),
  );
  const [suppress2LayerLateFillerBlock, setSuppress2LayerLateFillerBlock] = useState(() => loadCached(LS_KEYS.suppress2LayerLateFiller, DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK));
  const [dominateVoidFillerBlock, setDominateVoidFillerBlock] = useState(() => loadCached(LS_KEYS.dominateVoidFiller, DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK));
  const [recessiveVoidFillerBlock, setRecessiveVoidFillerBlock] = useState(() => loadCached(LS_KEYS.recessiveVoidFiller, DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK));
  const [buildMode, setBuildMode] = useState<BuildMode>(() => {
    const storedBuildMode = loadCached(LS_KEYS.buildMode, DEFAULT_BUILD_MODE);
    return Object.values(BuildMode).includes(storedBuildMode as BuildMode) ? storedBuildMode : DEFAULT_BUILD_MODE;
  });
  const [supportMode, setSupportMode] = useState<SupportMode>(() =>
    loadCached(LS_KEYS.supportMode, DEFAULT_SUPPORT_MODE),
  );
  const [suppressStepDirection, setSuppressDirection] = useState<SuppressStepDirection>(() => {
    const storedDirection = loadCached(LS_KEYS.suppressStepDirection, DEFAULT_SUPPRESS_STEP_DIRECTION);
    return isSuppressStepDirection(storedDirection) ? storedDirection : DEFAULT_SUPPRESS_STEP_DIRECTION;
  });
  const [vsFillerLoadSpotDirection, setVsFillerLoadSpotDirection] = useState<SuppressStepDirection>(() => {
    const storedDirection = loadCached(LS_KEYS.vsFillerLoadSpotDirection, DEFAULT_VS_FILLER_LOAD_DIRECTION);
    return isSuppressStepDirection(storedDirection) ? storedDirection : DEFAULT_VS_FILLER_LOAD_DIRECTION;
  });
  const [proPaletteSeed, setProPaletteSeed] = useState(() => loadCached(LS_KEYS.paletteSeed, DEFAULT_PALETTE_SEED));
  const calcProPaletteSeed = useDeferredValue(proPaletteSeed);
  const [layerGap, setLayerGap] = useState(() => loadCached(LS_KEYS.layerGap, DEFAULT_LAYER_GAP));
  const calcLayerGap = useDeferredValue(layerGap);
  const [suppress2LayerLatePairsGap, setSuppress2LayerLatePairsGap] = useState(() =>
    loadCached(LS_KEYS.suppress2LayerLatePairsGap, DEFAULT_SUPPRESS_2LAYER_LATE_PAIRS_GAP),
  );
  const calcSuppress2LayerLatePairsGap = useDeferredValue(suppress2LayerLatePairsGap);
  const [crubTech, setCrubTech] = useState(() => loadCached(LS_KEYS.crubTech, DEFAULT_CRUBTECH));
  const [mixSteps, setMixSteps] = useState(() => loadCached(LS_KEYS.mixSteps, DEFAULT_MIX_STEPS));
  const calcMixSteps = useDeferredValue(mixSteps);
  const [lightWaterDrop, setLightWaterDrop] = useState(() => loadCached(LS_KEYS.lightWaterDrop, DEFAULT_LIGHT_WATER_DROP));
  const calcLightWaterDrop = useDeferredValue(lightWaterDrop);
  const [flatWaterDrop, setFlatWaterDrop] = useState(() => loadCached(LS_KEYS.flatWaterDrop, DEFAULT_FLAT_WATER_DROP));
  const calcFlatWaterDrop = useDeferredValue(flatWaterDrop);
  const [darkWaterDrop, setDarkWaterDrop] = useState(() => loadCached(LS_KEYS.darkWaterDrop, DEFAULT_DARK_WATER_DROP));
  const calcDarkWaterDrop = useDeferredValue(darkWaterDrop);
  const [buildAtWorldMinY, setBuildAtWorldMinY] = useState(() => loadCached(LS_KEYS.buildAtWorldMinY, DEFAULT_BUILD_AT_WORLD_MIN_Y));
  const [showVsFillersInPreview, setShowVsFillersInPreview] = useState(() => loadCached(LS_KEYS.showVsFillersInPreview, DEFAULT_SHOW_VS_FILLERS_IN_PREVIEW));
  const [showIds, setShowIds] = useState(() => loadCached(LS_KEYS.showIds, DEFAULT_SHOW_IDS));
  const [showNames, setShowNames] = useState(() => loadCached(LS_KEYS.showNames, DEFAULT_SHOW_NAMES));
  const [showOptions, setShowOptions] = useState(() => loadCached(LS_KEYS.showOptions, DEFAULT_SHOW_OPTIONS));
  const [blockDisplayMode, setBlockDisplayMode] = useState<BlockDisplayMode>(() =>
    loadCached(LS_KEYS.blockDisplayMode, DEFAULT_BLOCK_DISPLAY_MODE),
  );
  const [blockColExpanded, setBlockColExpanded] = useState(() => loadCached(LS_KEYS.blockColExpanded, DEFAULT_BLOCK_COLUMN_EXPANDED));
  const [sortKey, setSortKey] = useState<SortKey>(() => loadCached(LS_KEYS.sortKey, DEFAULT_SORT_KEY));
  const [sortDir, setSortDir] = useState<SortDir>(() => loadCached(LS_KEYS.sortDir, DEFAULT_SORT_DIR));
  const [showStacks, setShowStacks] = useState(() => loadCached(LS_KEYS.showStacks, DEFAULT_MC_UNITS));
  const [showMaxPerSplit, setShowMaxPerSplit] = useState(() => loadCached(LS_KEYS.maxPerSplit, DEFAULT_MAX_PER_SPLIT));
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => loadCached(LS_KEYS.columnOrder, DEFAULT_COLUMN_ORDER));
  const [showTransparentRow, setShowTransparentRow] = useState(() => loadCached(LS_KEYS.showTransparentRow, DEFAULT_SHOW_TRANSPARENT_ROW));
  const [showExcludedBlocks, setShowExcludedBlocks] = useState(() => loadCached(LS_KEYS.showExcludedBlocks, DEFAULT_SHOW_EXCLUDED_BLOCKS));
  const [collapseDuplicateNbtPaletteStates, setCollapseDuplicateNbtPaletteStates] = useState(() => loadCached(
    LS_KEYS.collapseDuplicateNbtPaletteStates,
    DEFAULT_COLLAPSE_DUPLICATE_NBT_PALETTE_STATES,
  ));
  const [forceXZ128, setForceXZ128] = useState(() => loadCached(LS_KEYS.forceXZ128, DEFAULT_FORCE_XZ128));
  const [forceZ129, setForceZ129] = useState(() => loadCached(LS_KEYS.forceZ129, DEFAULT_FORCE_Z129));
  const [applySupportFloorYs, setApplySupportFloorYs] = useState(() => loadCached(LS_KEYS.applySupportFloorYs, DEFAULT_APPLY_SUPPORT_FLOOR_YS));
  const [belowPlatformWater, setBelowPlatformWater] = useState(() => loadCached(LS_KEYS.belowPlatformWater, DEFAULT_BELOW_PLATFORM_WATER));
  const [skipEmptySuppressSteps, setSkipEmptySuppressSteps] = useState(() => loadCached(LS_KEYS.skipEmptySuppressSteps, DEFAULT_SKIP_EMPTY_SUPPRESS_STEPS));
  const [showFlatNbtSuppressStepModes, setShowFlatNbtSuppressStepModes] = useState(() => loadCached(
    LS_KEYS.showFlatNbtSuppressStepModes,
    DEFAULT_SHOW_FLAT_NBT_SUPPRESS_STEP_MODES,
  ));
  const [markSuppressLoadSpotsInSchematic, setMarkSuppressLoadSpotsInSchematic] = useState(() =>
    loadCached(LS_KEYS.markSuppressLoadSpotsInSchematic, DEFAULT_MARK_SUPPRESS_LOAD_SPOTS_IN_SCHEMATIC),
  );
  const [suppressLoadSpotMarkerBlock, setSuppressLoadSpotMarkerBlock] = useState<SuppressLoadSpotMarkerBlock>(() => {
    const stored = loadCached(LS_KEYS.suppressLoadSpotMarkerBlock, DEFAULT_SUPPRESS_LOAD_SPOT_MARKER_BLOCK);
    return SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS.includes(stored as SuppressLoadSpotMarkerBlock)
      ? stored as SuppressLoadSpotMarkerBlock
      : DEFAULT_SUPPRESS_LOAD_SPOT_MARKER_BLOCK;
  });
  const [showVsFillerWarnings, setShowVsFillerWarnings] = useState(() => loadCached(LS_KEYS.showVsFillerWarnings, DEFAULT_SHOW_VS_FILLER_WARNINGS));
  const [showAlignmentReminder, setShowAlignmentReminder] = useState(() => loadCached(LS_KEYS.showAlignmentReminder, DEFAULT_SHOW_ALIGNMENT_REMINDER));
  const [showNooblineWarnings, setShowNooblineWarnings] = useState(() => loadCached(LS_KEYS.showNooblineWarnings, DEFAULT_SHOW_NOOBLINE_WARNINGS));
  const [convertUnsupported, /* setConvertUnsupported */] = useState(DEFAULT_CONVERT_UNSUPPORTED_COLORS); // always on; checkbox not shown
  const [cropImage, /* setCropImage */] = useState(DEFAULT_CROP_IMAGE); // always on; checkbox not shown
  const [customColors, setCustomColors] = useState<ColorRgb[]>([]);
  const [selectedBlocksCustom, setSelectedBlocksCustom] = useState<Record<number, string>>({});
  const [customMode, setCustomMode] = useState<"custom" | number>("custom");
  const [newCustom, setNewCustom] = useState({ r: "", g: "", b: "", block: "" });
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [imageValid, setImageValid] = useState(false);
  const [paletteNotices, setPaletteNotices] = useState<PaletteNotice[]>([]);
  const [converting, setConverting] = useState(false);
  const [showUnusedColors, setShowUnusedColors] = useState(false);
  const [isDark, setIsDark] = useState(resolveDarkTheme);
  const [localePreference, setLocalePreferenceState] = useState<LocalePreference>(getLocalePreference);
  const [showSecretsDialog, setShowSecretsDialog] = useState(false);
  const [colRangeEnabled, setColRangeEnabled] = useState(false);
  const [colStart, setColStart] = useState(0);
  const [colEnd, setColEnd] = useState(127);
  const [westEastSlopeEnabled, setWestEastSlopeEnabled] = useState(false);
  const [westEastSlopeRun, setWestEastSlopeRunState] = useState(DEFAULT_WEST_EAST_SLOPE_RUN);
  const [westEastSlopeRise, setWestEastSlopeRiseState] = useState(DEFAULT_WEST_EAST_SLOPE_RISE);
  const setWestEastSlopeRun = useCallback((value: number) => setWestEastSlopeRunState(clampWestEastSlopeRun(value)), []);
  const setWestEastSlopeRise = useCallback((value: number) => setWestEastSlopeRiseState(clampWestEastSlopeRise(value)), []);
  const colStartRef = useRef(0);
  const colEndRef = useRef(127);
  useEffect(() => { colStartRef.current = colStart; }, [colStart]);
  useEffect(() => { colEndRef.current = colEnd; }, [colEnd]);
  const [decodedColorGrid, setDecodedColorGrid] = useState<ColorGrid | null>(null);
  const [parsedImageSetState, setParsedImageSetState] = useState<ColorGridSetParseResult | null>(null);
  const [isParsingImage, setIsParsingImage] = useState(false);
  const [pendingIncomingTileCount, setPendingIncomingTileCount] = useState<number | null>(null);
  const [parseProgress, setParseProgress] = useState<AnalysisProgress | null>(null);
  const [selectedTileIndices, setSelectedTileIndices] = useState<number[]>([]);
  const [tileSelectionAnchorIndex, setTileSelectionAnchorIndex] = useState<number | null>(null);
  const [imageLossyFormatLabel, setImageLossyFormatLabel] = useState<string | null>(null);
  const previousMaterialInputsRef = useRef<{
    signature: string;
    colorAssignmentsByKey: Map<ColorRefKey, string>;
    fillerAssignmentsByRole: Map<FillerRole, string>;
    applySupportFloorYs: boolean;
    supportModeEnabled: boolean;
  } | null>(null);
  const decodedImageSet = useMemo<ColorGridSetParseResult | null>(
    () => decodedColorGrid
      ? {
          imageData: createImageDataFromColorGrid(decodedColorGrid, customColors),
          tiles: [{
            row: 0,
            col: 0,
            startX: 0,
            startZ: 0,
            colorGrid: decodedColorGrid,
            imageStats: computeColorGridStats(decodedColorGrid),
            cacheKey: getColorGridCacheKey(decodedColorGrid),
          }],
          tileRows: 1,
          tileCols: 1,
          paletteNotices: [],
          hasBlockingIssue: false,
        }
      : null,
    [decodedColorGrid, customColors],
  );
  const parsedImageSet = decodedImageSet ?? parsedImageSetState;
  const parsedTiles = parsedImageSet?.tiles ?? [];
  const hasBlockingSizeError = !!parsedImageSetState && parsedImageSetState.hasBlockingIssue && parsedImageSetState.tiles.length === 0;
  const hasRejectedUploadedImage =
    !decodedColorGrid &&
    !isParsingImage &&
    !imageValid &&
    (
      (parsedImageSetState?.hasBlockingIssue ?? false) ||
      paletteNotices.length > 0
    );
  const expectedTileShape = getExpectedTileShape(imageData, cropImage);
  const tileRows = parsedImageSet?.tileRows ?? expectedTileShape.tileRows;
  const tileCols = parsedImageSet?.tileCols ?? expectedTileShape.tileCols;
  const tileCount = parsedTiles.length > 0 ? parsedTiles.length : expectedTileShape.tileCount;
  const hasMultipleTiles = tileCount > 1;
  const displayImageData =
    hasBlockingSizeError
      ? null
      : pendingIncomingTileCount !== null
        ? imageData
        : (parsedImageSet?.imageData ?? imageData);
  const imageColorGrid = tileCount === 1 ? (parsedTiles[0]?.colorGrid ?? null) : null;
  const parseRelevantCustomColorKey = useMemo(() => getParseRelevantCustomColorsKey(customColors), [customColors]);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadedPreviewUrlRef = useRef<string | null>(null);
  const fileLoadRequestIdRef = useRef(0);

  const replaceUploadedPreviewUrl = useCallback((nextUrl: string | null) => {
    if (uploadedPreviewUrlRef.current) URL.revokeObjectURL(uploadedPreviewUrlRef.current);
    uploadedPreviewUrlRef.current = nextUrl;
    setUploadedPreviewUrl(nextUrl);
  }, []);
  const presetToolbarSectionRef = useRef<HTMLElement>(null);
  const fillerToolbarSectionRef = useRef<HTMLElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const layoutRootRef = useRef<HTMLDivElement>(null);
  const creditsRef = useRef<HTMLDivElement>(null);
  const [presetToolbarMinWidthPx, setPresetToolbarMinWidthPx] = useState(0);
  const [fillerToolbarMinWidthPx, setFillerToolbarMinWidthPx] = useState(0);
  const [colorTableMinWidthPx, setColorTableMinWidthPx] = useState(0);
  const [colorTableLayout, setColorTableLayout] = useState<ColorTableLayout>(INITIAL_COLOR_TABLE_LAYOUT);
  const [isStackedLayout, setIsStackedLayout] = useState(false);
  const [creditsFloatGapPx, setCreditsFloatGapPx] = useState(0);
  const creditsFloatGapRef = useRef(0);

  // Dynamic favicon: outlined version when an image is loaded
  useEffect(() => {
    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!link) return;
    const base = import.meta.env.BASE_URL || "/";
    link.href = `${base}${imageData ? "favicon-active.png" : "favicon.png"}`;
  }, [imageData]);
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => { if (!getStoredTheme()) setIsDark(e.matches); };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  useEffect(
    () => () => {
      if (uploadedPreviewUrlRef.current) {
        URL.revokeObjectURL(uploadedPreviewUrlRef.current);
        uploadedPreviewUrlRef.current = null;
      }
    },
    [],
  );

  const preset = presets[activeIdx] || getBuiltinPreset(DEFAULT_ACTIVE_PRESET_NAME)!;
  const activePresetBuiltinTooltip = activeIdx < BUILTIN_PRESET_NAMES.length
    ? messages.presets.builtinTooltip(preset.name)
    : undefined;

  const [savedPresetSnapshot, setSavedPresetSnapshot] = useState<{
    selectedBlocks: Record<number, string>;
    customColors: ColorRgb[];
    selectedBlocksCustom: Record<number, string>;
  } | null>(null);
  const activePresetCustomColors = preset.customColors ?? [];
  const activePresetCustomSelectedBlocks = useMemo(
    () => normalizeCustomSelectedBlocks(activePresetCustomColors, preset.selectedBlocksCustom),
    [activePresetCustomColors, preset.selectedBlocksCustom],
  );

  const capturePresetSnapshot = useCallback(
    () => ({
      selectedBlocks: { ...preset.selectedBlocks },
      customColors: cloneCustomColors(customColors),
      selectedBlocksCustom: normalizeCustomSelectedBlocks(customColors, selectedBlocksCustom),
    }),
    [preset.selectedBlocks, customColors, selectedBlocksCustom],
  );

  // Compute dirty by comparing current preset-owned state to saved snapshot
  const presetDirty = useMemo(() => {
    if (!savedPresetSnapshot) return false;
    const current = preset.selectedBlocks;
    const allKeys = new Set([...Object.keys(savedPresetSnapshot.selectedBlocks), ...Object.keys(current)]);
    for (const k of allKeys) {
      if ((savedPresetSnapshot.selectedBlocks[Number(k)] ?? "") !== (current[Number(k)] ?? "")) return true;
    }
    return (
      !areCustomColorsEqual(customColors, savedPresetSnapshot.customColors) ||
      !areCustomSelectedBlocksEqual(selectedBlocksCustom, savedPresetSnapshot.selectedBlocksCustom, customColors)
    );
  }, [preset.selectedBlocks, customColors, selectedBlocksCustom, savedPresetSnapshot]);
  const currentPresetIsUnsavedAuto = useMemo(
    () => activeIdx >= BUILTIN_PRESET_NAMES.length && isAutoCustomPresetName(preset.name) && presetDirty,
    [activeIdx, preset.name, presetDirty],
  );

  const markSavedDeferred = useCallback(() => {
    setSavedPresetSnapshot(null);
    markSavedNextRef.current = true;
  }, []);

  const markSavedImmediate = useCallback(() => {
    setSavedPresetSnapshot(capturePresetSnapshot());
  }, [capturePresetSnapshot]);

  const markSavedNextRef = useRef(true);

  useEffect(() => {
    if (markSavedNextRef.current) {
      if (!areCustomColorsEqual(customColors, activePresetCustomColors)) return;
      if (!areCustomSelectedBlocksEqual(selectedBlocksCustom, activePresetCustomSelectedBlocks, activePresetCustomColors)) return;
      setSavedPresetSnapshot(capturePresetSnapshot());
      markSavedNextRef.current = false;
    }
  }, [activePresetCustomColors, activePresetCustomSelectedBlocks, capturePresetSnapshot, customColors, selectedBlocksCustom]);

  useEffect(() => {
    setCustomColors(current =>
      areCustomColorsEqual(current, activePresetCustomColors) ? current : cloneCustomColors(activePresetCustomColors),
    );
    setSelectedBlocksCustom(current =>
      areCustomSelectedBlocksEqual(current, activePresetCustomSelectedBlocks, activePresetCustomColors)
        ? current
        : normalizeCustomSelectedBlocks(activePresetCustomColors, activePresetCustomSelectedBlocks),
    );
  }, [activeIdx, activePresetCustomColors, activePresetCustomSelectedBlocks]);

  // Persist settings to localStorage
  useEffect(() => {
    const persistedPresets = presets.filter((p, idx) => {
      if (getBuiltinPreset(p.name)) return false;
      if (!isAutoCustomPresetName(p.name)) return true;
      if (idx !== activeIdx) return true;
      // Reuse yellow-dot logic: active auto-Custom with unsaved changes is discarded.
      return !presetDirty;
    });
    localStorage.setItem(LS_KEYS.presets, JSON.stringify(persistedPresets));
  }, [presets, activeIdx, presetDirty]);
  const persistedSettings = useMemo(
    () => ({
      [LS_KEYS.activePreset]: preset.name,
      [LS_KEYS.supportFiller]: supportFillerBlock,
      [LS_KEYS.shadeFiller]: shadeFillerBlock,
      [LS_KEYS.crubTechShadeBreakableFiller]: crubTechShadeBreakableFillerBlock,
      [LS_KEYS.crubTechShadePushableFiller]: crubTechShadePushableFillerBlock,
      [LS_KEYS.suppress2LayerLateFiller]: suppress2LayerLateFillerBlock,
      [LS_KEYS.dominateVoidFiller]: dominateVoidFillerBlock,
      [LS_KEYS.recessiveVoidFiller]: recessiveVoidFillerBlock,
      [LS_KEYS.buildMode]: buildMode,
      [LS_KEYS.supportMode]: supportMode,
      [LS_KEYS.suppressStepDirection]: suppressStepDirection,
      [LS_KEYS.vsFillerLoadSpotDirection]: vsFillerLoadSpotDirection,
      [LS_KEYS.paletteSeed]: proPaletteSeed,
      [LS_KEYS.layerGap]: layerGap,
      [LS_KEYS.suppress2LayerLatePairsGap]: suppress2LayerLatePairsGap,
      [LS_KEYS.crubTech]: crubTech,
      [LS_KEYS.mixSteps]: mixSteps,
      [LS_KEYS.lightWaterDrop]: lightWaterDrop,
      [LS_KEYS.flatWaterDrop]: flatWaterDrop,
      [LS_KEYS.darkWaterDrop]: darkWaterDrop,
      [LS_KEYS.buildAtWorldMinY]: buildAtWorldMinY,
      [LS_KEYS.showVsFillersInPreview]: showVsFillersInPreview,
      [LS_KEYS.showIds]: showIds,
      [LS_KEYS.showNames]: showNames,
      [LS_KEYS.showOptions]: showOptions,
      [LS_KEYS.blockDisplayMode]: blockDisplayMode,
      [LS_KEYS.blockColExpanded]: blockColExpanded,
      [LS_KEYS.sortKey]: sortKey,
      [LS_KEYS.sortDir]: sortDir,
      [LS_KEYS.showStacks]: showStacks,
      [LS_KEYS.maxPerSplit]: showMaxPerSplit,
      [LS_KEYS.columnOrder]: columnOrder,
      [LS_KEYS.showTransparentRow]: showTransparentRow,
      [LS_KEYS.showExcludedBlocks]: showExcludedBlocks,
      [LS_KEYS.collapseDuplicateNbtPaletteStates]: collapseDuplicateNbtPaletteStates,
      [LS_KEYS.forceXZ128]: forceXZ128,
      [LS_KEYS.forceZ129]: forceZ129,
      [LS_KEYS.applySupportFloorYs]: applySupportFloorYs,
      [LS_KEYS.belowPlatformWater]: belowPlatformWater,
      [LS_KEYS.skipEmptySuppressSteps]: skipEmptySuppressSteps,
      [LS_KEYS.showFlatNbtSuppressStepModes]: showFlatNbtSuppressStepModes,
      [LS_KEYS.markSuppressLoadSpotsInSchematic]: markSuppressLoadSpotsInSchematic,
      [LS_KEYS.suppressLoadSpotMarkerBlock]: suppressLoadSpotMarkerBlock,
      [LS_KEYS.showVsFillerWarnings]: showVsFillerWarnings,
      [LS_KEYS.showAlignmentReminder]: showAlignmentReminder,
      [LS_KEYS.showNooblineWarnings]: showNooblineWarnings,
    }),
    [
      preset.name,
      supportFillerBlock,
      shadeFillerBlock,
      crubTechShadeBreakableFillerBlock,
      crubTechShadePushableFillerBlock,
      suppress2LayerLateFillerBlock,
      dominateVoidFillerBlock,
      recessiveVoidFillerBlock,
      buildMode,
      supportMode,
      suppressStepDirection,
      vsFillerLoadSpotDirection,
      proPaletteSeed,
      layerGap,
      suppress2LayerLatePairsGap,
      crubTech,
      mixSteps,
      lightWaterDrop,
      flatWaterDrop,
      darkWaterDrop,
      buildAtWorldMinY,
      showVsFillersInPreview,
      showIds,
      showNames,
      showOptions,
      blockDisplayMode,
      blockColExpanded,
      sortKey,
      sortDir,
      showStacks,
      showMaxPerSplit,
      columnOrder,
      showTransparentRow,
      showExcludedBlocks,
      collapseDuplicateNbtPaletteStates,
      forceXZ128,
      forceZ129,
      applySupportFloorYs,
      belowPlatformWater,
      skipEmptySuppressSteps,
      showFlatNbtSuppressStepModes,
      markSuppressLoadSpotsInSchematic,
      suppressLoadSpotMarkerBlock,
      showVsFillerWarnings,
      showAlignmentReminder,
      showNooblineWarnings,
    ],
  );
  const persistedSettingsRef = useRef<Record<string, unknown>>({});
  useEffect(() => {
    for (const [k, v] of Object.entries(persistedSettings)) {
      if (persistedSettingsRef.current[k] === v) continue;
      localStorage.setItem(k, JSON.stringify(v));
      persistedSettingsRef.current[k] = v;
    }
  }, [persistedSettings]);

  const showPaletteSeedToggle = buildModeUsesPaletteSeed(buildMode);
  const paletteSeedOffset = useMemo(
    () => (showPaletteSeedToggle && calcProPaletteSeed ? getPaletteSeedOffset(preset.selectedBlocks) : 0),
    [showPaletteSeedToggle, calcProPaletteSeed, preset.selectedBlocks],
  );
  const tileImageStats = useMemo(
    () => (parsedTiles.length > 0 && imageValid ? parsedTiles.map(tile => tile.imageStats) : []),
    [parsedTiles, imageValid],
  );
  const tileDerivedImageStats = useMemo(
    () => tileImageStats.map(deriveImageStats),
    [tileImageStats],
  );
  const derivedImageStats = useMemo(
    () => (tileImageStats.length > 0 ? aggregateDerivedImageStats(tileImageStats) : null),
    [tileImageStats],
  );
  const shadeCountsByColorKey = useMemo(() => collectShadeCountsByColorRefKey(tileImageStats), [tileImageStats]);
  const usedShadesByColorKey = derivedImageStats?.usedShadesByColorKey ?? EMPTY_USED_SHADES_BY_COLOR_KEY;
  const usedColorKeys = useMemo(() => new Set(usedShadesByColorKey.keys()), [usedShadesByColorKey]);
  const imageUsesCustomColors = useMemo(
    () => [...usedColorKeys].some(key => parseColorRefKey(key).isCustom),
    [usedColorKeys],
  );
  const voidShadowSummary = useMemo(() => {
    let hasDominantVoidShadow = false;
    let hasAnyVoidShadow = false;
    let northToSouthSelectable = true;
    let southToNorthSelectable = true;

    for (const stats of tileImageStats) {
      const dominant = stats.voidShadowStats.dominant ?? 0;
      const recessive = stats.voidShadowStats.recessive ?? 0;
      if (dominant > 0) {
        hasDominantVoidShadow = true;
        hasAnyVoidShadow = true;
        northToSouthSelectable = false;
      }
      if (recessive > 0) {
        hasAnyVoidShadow = true;
        southToNorthSelectable = false;
      }
    }

    return {
      hasDominantVoidShadow,
      hasAnyVoidShadow,
      northToSouthSelectable,
      southToNorthSelectable,
    };
  }, [tileImageStats]);
  const usedWaterShades = getUsedWaterShades(usedShadesByColorKey);
  const imageHasWater = usedWaterShades.size > 0;
  const paletteUsageInfo = derivedImageStats?.paletteUsageInfo ?? null;
  const [analysisResult, setAnalysisResult] = useState<TileAnalysisResult | null>(null);
  const [isAnalyzingTiles, setIsAnalyzingTiles] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState<TileAnalysisPhase>("generating");
  const [tileAnalysesState, setTileAnalysesState] = useState<TileAnalysis[]>([]);
  const [isAnalyzingMaterials, setIsAnalyzingMaterials] = useState(false);
  const [materialAnalysisProgress, setMaterialAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [pendingTransparentMaterialRefresh, setPendingTransparentMaterialRefresh] = useState(false);
  useEffect(() => {
    document.documentElement.lang = messages.locale;
  }, []);
  const selectedTileCount = selectedTileIndices.length;
  const selectedTileIndex = selectedTileCount === 1 ? selectedTileIndices[0] ?? null : null;
  const selectedTileIndexSet = useMemo(() => new Set(selectedTileIndices), [selectedTileIndices]);
  const effectiveSelectedTileIndices = useMemo(
    () => getEffectiveTileSelection(selectedTileIndices, parsedTiles.length),
    [selectedTileIndices, parsedTiles.length],
  );
  const effectiveSelectedTileCount = selectedTileCount === 0 ? tileCount : selectedTileCount;
  const showMaxPerSplitOption = hasMultipleTiles && selectedTileCount !== 1;
  const analysisBusy = isParsingImage || isAnalyzingTiles;
  const previewBusy = analysisBusy || isAnalyzingMaterials;
  const selectedWaterBlock = preset.selectedBlocks[WATER_BASE_INDEX] ?? BASE_COLORS[WATER_BASE_INDEX].blocks[0] ?? "";
  const usesWaterForWater = normalizeBlockId(selectedWaterBlock) === "water";
  const usesIceForWater = normalizeBlockId(selectedWaterBlock) === "ice";
  const effectiveSupportFillerBlock = supportFillerBlock.trim() || DEFAULT_SUPPORT_FILLER_BLOCK;
  const effectiveShadeFillerBlock = shadeFillerBlock.trim() || DEFAULT_SHADE_FILLER_BLOCK;
  const effectiveCrubTechShadeBreakableFillerBlock =
    crubTechShadeBreakableFillerBlock.trim() || DEFAULT_CRUBTECH_SHADE_BREAKABLE_FILLER_BLOCK;
  const effectiveCrubTechShadePushableFillerBlock =
    crubTechShadePushableFillerBlock.trim() || DEFAULT_CRUBTECH_SHADE_PUSHABLE_FILLER_BLOCK;
  const effectiveSuppress2LayerLateFillerBlock =
    suppress2LayerLateFillerBlock.trim() || DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK;
  const effectiveDominateVoidFillerBlock =
    dominateVoidFillerBlock.trim() || DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK;
  const effectiveRecessiveVoidFillerBlock =
    recessiveVoidFillerBlock.trim() || DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK;
  const supportFillerDisabled = isFillerDisabled(effectiveSupportFillerBlock);
  const normalizedImmediateWaterDrops = useMemo(
    () => normalizeUsedWaterDrops(buildWaterDropInputs(darkWaterDrop, flatWaterDrop, lightWaterDrop), usedWaterShades),
    [darkWaterDrop, flatWaterDrop, lightWaterDrop, usedWaterShades],
  );
  const normalizedDeferredWaterDrops = useMemo(
    () => normalizeUsedWaterDrops(
      buildWaterDropInputs(calcDarkWaterDrop || 0, calcFlatWaterDrop || 0, calcLightWaterDrop || 0),
      usedWaterShades,
    ),
    [calcDarkWaterDrop, calcFlatWaterDrop, calcLightWaterDrop, usedWaterShades],
  );
  const usesBelowPlatformWaterForBuildMode = useCallback(
    (targetBuildMode: BuildMode) => belowPlatformWater || (crubTech && isCrubTechBuildMode(targetBuildMode)),
    [belowPlatformWater, crubTech],
  );
  const getTileWaterSetting = useCallback(
    (tileDerivedImageStats: DerivedImageStats, targetBuildMode: BuildMode): TileWaterSetting => {
      const targetBelowPlatformWater = usesBelowPlatformWaterForBuildMode(targetBuildMode);
      const tileUsedWaterShades = getUsedWaterShades(tileDerivedImageStats.usedShadesByColorKey);
      const tileHasWater = tileUsedWaterShades.size > 0;
      const tileHasNonLightWater =
        tileUsedWaterShades.has(Shade.Dark) ||
        tileUsedWaterShades.has(Shade.Flat);
      const targetCrubTechWater = crubTech && isCrubTechBuildMode(targetBuildMode);
      if (targetBuildMode === BuildMode.Flat) return undefined;
      if (targetBelowPlatformWater && tileHasWater) {
        return { kind: "below-platform", drops: targetCrubTechWater ? CRUBTECH_SHAPE_WATER_DROPS : normalizedDeferredWaterDrops };
      }
      if (!targetBelowPlatformWater && usesWaterForWater && tileHasNonLightWater) {
        return { kind: "top-aligned" };
      }
      return undefined;
    },
    [crubTech, normalizedDeferredWaterDrops, usesBelowPlatformWaterForBuildMode, usesWaterForWater],
  );
  const showMixStepsToggle = useMemo(
    () =>
      isSuppressStepsBuildMode(buildMode) &&
      imageValid &&
      parsedTiles.some((tile, index) => {
        const waterSetting = getTileWaterSetting(tileDerivedImageStats[index], buildMode);
        return hasStepMixOpportunity(tile.colorGrid, {
          waterDrops: waterSetting?.kind === "below-platform" ? waterSetting.drops : undefined,
        });
      }),
    [buildMode, imageValid, parsedTiles, tileDerivedImageStats, getTileWaterSetting],
  );
  const twoLayerHasLateVoidNeed = voidShadowSummary.hasDominantVoidShadow;
  const crubTechControlsCurrent2LayerSettings = crubTech && isCrubTechBuildMode(buildMode);
  const crubTechControlsLatePairsGap = crubTechControlsCurrent2LayerSettings;
  const effectiveLayerGap = crubTechControlsCurrent2LayerSettings ? DEFAULT_CRUBTECH_LAYER_GAP : layerGap;
  const calcEffectiveLayerGap = crubTechControlsCurrent2LayerSettings ? DEFAULT_CRUBTECH_LAYER_GAP : calcLayerGap;
  const suppress2LayerUpperY = Math.max(1, effectiveLayerGap);
  const calcSuppress2LayerUpperY = Math.max(1, calcEffectiveLayerGap);
  const maxSuppress2LayerLatePairsGap = Math.max(1, 64 - suppress2LayerUpperY);
  const calcMaxSuppress2LayerLatePairsGap = Math.max(1, 64 - calcSuppress2LayerUpperY);
  const effectiveSuppress2LayerLatePairsGap = crubTechControlsLatePairsGap
    ? DEFAULT_CRUBTECH_LATE_PAIRS_GAP
    : clampLatePairsGap(suppress2LayerLatePairsGap, maxSuppress2LayerLatePairsGap);
  const calcEffectiveSuppress2LayerLatePairsGap = crubTechControlsLatePairsGap
    ? DEFAULT_CRUBTECH_LATE_PAIRS_GAP
    : clampLatePairsGap(calcSuppress2LayerLatePairsGap, calcMaxSuppress2LayerLatePairsGap);
  const effectiveSuppress2LayerLatePairY = suppress2LayerUpperY + effectiveSuppress2LayerLatePairsGap;
  const calcEffectiveSuppress2LayerLatePairY = calcSuppress2LayerUpperY + calcEffectiveSuppress2LayerLatePairsGap;
  const isSuppressDirectionSelectable = useCallback(
    (direction: SuppressStepDirection) => {
      if (buildMode !== BuildMode.SuppressStepChecker) return true;
      switch (direction) {
        case SuppressStepDirection.EastToWest:
        case SuppressStepDirection.WestToEast:
          return true;
        case SuppressStepDirection.NorthToSouth:
          return voidShadowSummary.northToSouthSelectable;
        case SuppressStepDirection.SouthToNorth:
          return voidShadowSummary.southToNorthSelectable;
      }
    },
    [buildMode, voidShadowSummary],
  );
  useEffect(() => {
    if (buildMode !== BuildMode.SuppressStepChecker || isSuppressDirectionSelectable(suppressStepDirection)) return;
    setSuppressDirection(current => cycleSuppressStepDirection(current, isSuppressDirectionSelectable));
  }, [buildMode, suppressStepDirection, isSuppressDirectionSelectable]);
  const normalizedSupportFillerBlockId = normalizeBlockId(effectiveSupportFillerBlock);
  const supportFillerIsFragile =
    normalizedSupportFillerBlockId.length > 0 && isFragileBlock(normalizedSupportFillerBlockId);
  const supportWaterSidesFillerValid = isWaterSideSupportFillerValid(effectiveSupportFillerBlock);
  const sanitizeCommittedBlockEntry = useCallback((value: string) => sanitizeUserBlockEntry(value), []);
  const setCommittedSupportFillerBlock = useCallback(
    (value: string) => setSupportFillerBlock(sanitizeCommittedBlockEntry(value)),
    [sanitizeCommittedBlockEntry],
  );
  const setCommittedShadeFillerBlock = useCallback(
    (value: string) => setShadeFillerBlock(sanitizeCommittedBlockEntry(value)),
    [sanitizeCommittedBlockEntry],
  );
  const setCommittedCrubTechShadeBreakableFillerBlock = useCallback(
    (value: string) => setCrubTechShadeBreakableFillerBlock(sanitizeCommittedBlockEntry(value)),
    [sanitizeCommittedBlockEntry],
  );
  const setCommittedCrubTechShadePushableFillerBlock = useCallback(
    (value: string) => setCrubTechShadePushableFillerBlock(sanitizeCommittedBlockEntry(value)),
    [sanitizeCommittedBlockEntry],
  );
  const setCommittedSuppress2LayerLateFillerBlock = useCallback(
    (value: string) => setSuppress2LayerLateFillerBlock(sanitizeCommittedBlockEntry(value)),
    [sanitizeCommittedBlockEntry],
  );
  const setCommittedDominateVoidFillerBlock = useCallback(
    (value: string) => setDominateVoidFillerBlock(sanitizeCommittedBlockEntry(value)),
    [sanitizeCommittedBlockEntry],
  );
  const setCommittedRecessiveVoidFillerBlock = useCallback(
    (value: string) => setRecessiveVoidFillerBlock(sanitizeCommittedBlockEntry(value)),
    [sanitizeCommittedBlockEntry],
  );
  const commitSupportFillerBlock = useCallback((value: string) => {
    const nextValue = sanitizeCommittedBlockEntry(value);
    if (isFillerDisabled(nextValue)) setSupportMode(SupportMode.None);
  }, [sanitizeCommittedBlockEntry]);
  const shadeFillerShadingDisabled = isShadeFillerDisabled(effectiveShadeFillerBlock);
  const crubTechShadeBreakableFillerShadingDisabled = isShadeFillerDisabled(effectiveCrubTechShadeBreakableFillerBlock);
  const crubTechShadePushableFillerShadingDisabled = isShadeFillerDisabled(effectiveCrubTechShadePushableFillerBlock);
  const lateFillerShadingDisabled = isShadeFillerDisabled(effectiveSuppress2LayerLateFillerBlock);
  const dominateVoidFillerShadingDisabled = isShadeFillerDisabled(effectiveDominateVoidFillerBlock);
  const recessiveVoidFillerShadingDisabled = isShadeFillerDisabled(effectiveRecessiveVoidFillerBlock);
  const activeTransparentBlock = derivedImageStats?.hasTransparency
    ? (preset.selectedBlocks[TRANSPARENCY_BASE_INDEX] ?? "")
    : "";
  const transparentBlockMapping = useMemo(
    () => ({ [TRANSPARENCY_BASE_INDEX]: activeTransparentBlock }),
    [activeTransparentBlock],
  );
  useEffect(() => {
    if (!imageValid || parsedTiles.length === 0) {
      if (!isParsingImage) {
        setAnalysisResult(current => (current === null ? current : null));
        setIsAnalyzingTiles(current => (current ? false : current));
        setAnalysisProgress(current => (current === null ? current : null));
        setAnalysisPhase(current => (current === "generating" ? current : "generating"));
      }
      return;
    }
    let cancelled = false;
    const totalTiles = parsedTiles.length;
    const showTileAnalysisProgress = totalTiles > 1;

    setIsAnalyzingTiles(true);
    setAnalysisPhase("generating");
    setAnalysisProgress(showTileAnalysisProgress ? { completed: 0, total: totalTiles } : null);

    void (async () => {
      try {
        await yieldToMainThread();
        let completedSteps = 0;
        let lastProgressUpdateAt = performance.now();
        const advanceProgress = () => {
          if (!showTileAnalysisProgress) return;
          if (cancelled) return;
          completedSteps += 1;
          const now = performance.now();
          if (!shouldUpdateMainThreadProgress(completedSteps, totalTiles, lastProgressUpdateAt, now)) return;
          lastProgressUpdateAt = now;
          setAnalysisProgress(current =>
            current?.completed === completedSteps && current.total === totalTiles
              ? current
              : { completed: completedSteps, total: totalTiles },
          );
        };

        const nextBaseAnalyses = await Promise.all(parsedTiles.map(async (tile, index) => {
          const tileDerivedStats = tileDerivedImageStats[index];
          const hasWater = getUsedWaterShades(tileDerivedStats.usedShadesByColorKey).size > 0;
          const discoveryIncludesTransparentBlocks = shouldIncludeTransparentBlocks(
            transparentBlockMapping,
            tileDerivedStats.hasTransparency,
            BuildMode.StaircaseClassic,
          );
          const waterSetting = getTileWaterSetting(tileDerivedStats, BuildMode.StaircaseClassic);
          const baseGeometry = await getTileBaseGeometry(tile.cacheKey, {
            colorGrid: tile.colorGrid,
            allSameShade: tileDerivedStats.allSameShade,
            hasWater,
            hasTransparency: tileDerivedStats.hasTransparency,
            includeTransparentBlocks: discoveryIncludesTransparentBlocks,
            waterSetting,
            flatModeBehavior: tileDerivedStats.flatModeBehavior,
            layerGap: calcLayerGap,
            paletteSeed: paletteSeedOffset,
            enableWaterConvenience: supportMode !== SupportMode.None,
          });
          advanceProgress();
          return {
            tile,
            derivedImageStats: tileDerivedStats,
            hasWater,
            waterSetting,
            flatModeBehavior: tileDerivedStats.flatModeBehavior,
            ...baseGeometry,
          } satisfies TileBaseAnalysis;
        }));

        if (cancelled) return;

        const nextFlatModeBehavior = getAggregatedFlatModeBehavior(nextBaseAnalyses);
        const nextIsFlatShape = nextBaseAnalyses.length > 0 && nextBaseAnalyses.every(tile => tile.isFlatShape);
        const nextFlatBuildAtWorldMinYEligible = getFlatBuildAtWorldMinYEligible(nextBaseAnalyses, applySupportFloorYs);
        const nextActiveFlatBuildAtWorldMinY = nextFlatBuildAtWorldMinYEligible && buildAtWorldMinY;
        const nextFlatRequiresVsFillers =
          nextFlatModeBehavior === FlatModeBehavior.ToggleableBuildAtWorldMinY &&
          !nextActiveFlatBuildAtWorldMinY;
        const nextShowFlatNbtSuppressStepOptions =
          nextIsFlatShape &&
          !nextFlatRequiresVsFillers &&
          showFlatNbtSuppressStepModes;
        const nextLockFlatBuildMode =
          nextIsFlatShape &&
          !nextFlatRequiresVsFillers &&
          !showFlatNbtSuppressStepModes;
        const nextStaircaseModeOptions = getStaircaseModeOptionsForState(
          imageValid,
          nextBaseAnalyses,
          tileDerivedImageStats,
          nextIsFlatShape,
          hasMultipleTiles,
          nextShowFlatNbtSuppressStepOptions,
        );
        const nextSuppressModeOptions = getSuppressModeOptionsForState(
          twoLayerHasLateVoidNeed,
          hasMultipleTiles,
          nextShowFlatNbtSuppressStepOptions,
        );
        const nextResolvedBuildSelection = resolveBuildModeSelection(
          buildMode,
          suppressStepDirection,
          nextLockFlatBuildMode,
          hasVoidShadow,
          nextStaircaseModeOptions,
          nextSuppressModeOptions,
        );
        const nextResolvedBuildMode = nextResolvedBuildSelection.buildMode;
        const nextResolvedSuppressStepDirection = nextResolvedBuildSelection.suppressStepDirection;

        if (
          nextResolvedBuildMode !== buildMode ||
          nextResolvedSuppressStepDirection !== suppressStepDirection
        ) {
          startTransition(() => {
            if (nextResolvedBuildMode !== buildMode) setBuildMode(nextResolvedBuildMode);
            if (nextResolvedSuppressStepDirection !== suppressStepDirection) {
              setSuppressDirection(nextResolvedSuppressStepDirection);
            }
            setIsAnalyzingTiles(false);
            setAnalysisProgress(null);
            setAnalysisPhase("generating");
          });
          return;
        }

        const nextBuildAtWorldMinYEligible = getBuildAtWorldMinYEligibleForBuildMode(
          nextBaseAnalyses,
          nextResolvedBuildMode,
          applySupportFloorYs || (crubTech && isCrubTechBuildMode(nextResolvedBuildMode)),
        );
        const nextActiveBuildAtWorldMinY = nextBuildAtWorldMinYEligible && buildAtWorldMinY;
        const nextUseCrubTechShadeFillers =
          crubTech &&
          isCrubTechBuildMode(nextResolvedBuildMode);
        const canReuseBaseGeometry =
          !nextActiveBuildAtWorldMinY &&
          isStaircaseBuildMode(nextResolvedBuildMode);
        let nextTileGeometryAnalyses: TileGeometryAnalysis[];
        if (canReuseBaseGeometry) {
          if (showTileAnalysisProgress) {
            completedSteps = 0;
            lastProgressUpdateAt = performance.now();
            setAnalysisPhase("fillerAnalysis");
            setAnalysisProgress({ completed: 0, total: totalTiles });
          }
          nextTileGeometryAnalyses = [];
          for (const [index, tile] of nextBaseAnalyses.entries()) {
            const waterSetting = getTileWaterSetting(tile.derivedImageStats, nextResolvedBuildMode);
            const shapeMap = tile.baseShapeMap;
            const northlineShape = tile.baseNorthlineShape;
            const supportShape = nextResolvedBuildMode === BuildMode.Flat
              ? northlineShape
              : getShapeForBuildMode(shapeMap, nextResolvedBuildMode, tile.isFlatShape);
            const fillerNeedStats = supportShape ? getCachedShapeFillerNeeds(supportShape) : null;
            const northRowSingleLine = supportShape ? getCachedShapeNooblineIsSingleY(supportShape) : true;
            nextTileGeometryAnalyses.push({
              ...tile,
              waterSetting,
              flatModeBehavior: tile.derivedImageStats.flatModeBehavior,
              shapeMap,
              northlineShape,
              supportShape,
              fillerNeedStats,
              northRowSingleLine,
            });
            if (showTileAnalysisProgress) {
              const completed = index + 1;
              completedSteps = completed;
              const now = performance.now();
              if (shouldUpdateMainThreadProgress(completed, totalTiles, lastProgressUpdateAt, now)) {
                lastProgressUpdateAt = now;
                setAnalysisProgress(current =>
                  current?.completed === completed && current.total === totalTiles
                    ? current
                    : { completed, total: totalTiles },
                );
                if (!cancelled && completed < totalTiles) await yieldToMainThread();
              }
            }
          }
        } else {
          if (showTileAnalysisProgress) {
            completedSteps = 0;
            lastProgressUpdateAt = performance.now();
            setAnalysisPhase("generating");
            setAnalysisProgress({ completed: 0, total: totalTiles });
          }
          nextTileGeometryAnalyses = await Promise.all(nextBaseAnalyses.map(async tile => {
            const includeTransparentBlocks = shouldIncludeTransparentBlocks(
              transparentBlockMapping,
              tile.derivedImageStats.hasTransparency,
              nextResolvedBuildMode,
            );
            const waterSetting = getTileWaterSetting(tile.derivedImageStats, nextResolvedBuildMode);
            const finalGeometry = await getTileFinalGeometry(tile.tile.cacheKey, {
              colorGrid: tile.tile.colorGrid,
              allSameShade: tile.derivedImageStats.allSameShade,
              hasWater: tile.hasWater,
              hasTransparency: tile.derivedImageStats.hasTransparency,
              hasTwoLayerLateVoidNeed: twoLayerHasLateVoidNeed,
              includeTransparentBlocks,
              waterSetting,
              flatModeBehavior: tile.derivedImageStats.flatModeBehavior,
              buildAtWorldMinY: nextActiveBuildAtWorldMinY,
              buildMode: nextResolvedBuildMode,
              isFlatShape: tile.isFlatShape,
              layerGap: calcEffectiveLayerGap,
              suppress2LayerLatePairY: calcEffectiveSuppress2LayerLatePairY,
              useCrubTech: nextUseCrubTechShadeFillers,
              mixSteps: isSuppressStepsBuildMode(nextResolvedBuildMode) && calcMixSteps,
              paletteSeed: paletteSeedOffset,
              enableWaterConvenience: supportMode !== SupportMode.None,
              skipEmptySuppressSteps,
              collapseStaircaseModes: !hasMultipleTiles,
              includeFlatNorthline: hasMultipleTiles && tile.flatModeBehavior !== FlatModeBehavior.None,
              selectedStepDirection: nextResolvedSuppressStepDirection,
            });
            advanceProgress();
            return {
              ...tile,
              waterSetting,
              flatModeBehavior: tile.derivedImageStats.flatModeBehavior,
              ...finalGeometry,
            } satisfies TileGeometryAnalysis;
          }));
        }

        if (cancelled) return;

        const nextAggregateFillerRoleCounts = new Map<FillerRole, number>();
        for (const tile of nextTileGeometryAnalyses) {
          if (!tile.fillerNeedStats) continue;
          for (const [role, count] of tile.fillerNeedStats.roleCounts) {
            nextAggregateFillerRoleCounts.set(role, (nextAggregateFillerRoleCounts.get(role) ?? 0) + count);
          }
        }

        startTransition(() => {
          setAnalysisResult({
            tileGeometryAnalyses: nextTileGeometryAnalyses,
            aggregateFillerRoleCounts: nextAggregateFillerRoleCounts,
          });
          setIsAnalyzingTiles(false);
          setAnalysisProgress(null);
          setAnalysisPhase("generating");
        });
      } catch (error) {
        if (cancelled) return;
        startTransition(() => {
          setAnalysisResult(null);
          setPaletteNotices([messages.parsing.errorNotice((error as Error)?.message || messages.parsing.conversionFailed)]);
          setImageValid(false);
          setIsAnalyzingTiles(false);
          setAnalysisProgress(null);
          setAnalysisPhase("generating");
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    imageValid,
    parsedTiles,
    tileDerivedImageStats,
    transparentBlockMapping,
    buildMode,
    getTileWaterSetting,
    twoLayerHasLateVoidNeed,
    calcLayerGap,
    calcEffectiveLayerGap,
    calcEffectiveSuppress2LayerLatePairY,
    showMixStepsToggle,
    calcMixSteps,
    paletteSeedOffset,
    supportMode,
    skipEmptySuppressSteps,
    crubTech,
    suppressStepDirection,
    applySupportFloorYs,
    buildAtWorldMinY,
    hasMultipleTiles,
    showFlatNbtSuppressStepModes,
  ]);
  const tileGeometryAnalyses = analysisResult?.tileGeometryAnalyses ?? [];
  const tileBaseAnalyses = tileGeometryAnalyses;
  const aggregateFillerRoleCounts = analysisResult?.aggregateFillerRoleCounts ?? EMPTY_FILLER_ROLE_COUNTS;
  const hasVoidShadow = voidShadowSummary.hasAnyVoidShadow;
  const flatModeBehavior = useMemo(
    () => getAggregatedFlatModeBehavior(tileBaseAnalyses),
    [tileBaseAnalyses],
  );
  const isFlatShape = tileBaseAnalyses.length > 0 && tileBaseAnalyses.every(tile => tile.isFlatShape);
  const flatBuildAtWorldMinYEligible = useMemo(
    () => getFlatBuildAtWorldMinYEligible(tileBaseAnalyses, applySupportFloorYs),
    [tileBaseAnalyses, applySupportFloorYs],
  );
  const flatShowBuildAtWorldMinYToggle = imageValid && flatBuildAtWorldMinYEligible;
  const activeFlatBuildAtWorldMinY = flatShowBuildAtWorldMinYToggle && buildAtWorldMinY;
  const flatRequiresVsFillers =
    flatModeBehavior === FlatModeBehavior.ToggleableBuildAtWorldMinY &&
    !activeFlatBuildAtWorldMinY;
  const showFlatNbtSuppressStepOptions =
    isFlatShape &&
    !flatRequiresVsFillers &&
    showFlatNbtSuppressStepModes;
  const lockFlatBuildMode =
    isFlatShape &&
    !flatRequiresVsFillers &&
    !showFlatNbtSuppressStepModes;
  const effectiveBuildMode = lockFlatBuildMode ? BuildMode.Flat : buildMode;
  const crubTechControlsActive2LayerSettings = crubTech && isCrubTechBuildMode(effectiveBuildMode);
  const effectiveSupportMode = crubTechControlsActive2LayerSettings && supportMode !== SupportMode.None
    ? SupportMode.Steps
    : supportMode;
  const effectiveShowTransparentRow = !crubTechControlsActive2LayerSettings && showTransparentRow;
  const effectiveForceXZ128 = crubTechControlsActive2LayerSettings || forceXZ128;
  const effectiveForceZ129 = crubTechControlsActive2LayerSettings || forceZ129;
  const effectiveApplySupportFloorYs = crubTechControlsActive2LayerSettings || applySupportFloorYs;
  const effectiveBelowPlatformWater = crubTechControlsActive2LayerSettings || belowPlatformWater;
  const uiFillerAssignments = useMemo(
    () => createFillerAssignments(
      effectiveSupportFillerBlock,
      effectiveShadeFillerBlock,
      effectiveCrubTechShadeBreakableFillerBlock,
      effectiveCrubTechShadePushableFillerBlock,
      effectiveSuppress2LayerLateFillerBlock,
      effectiveDominateVoidFillerBlock,
      effectiveRecessiveVoidFillerBlock,
      effectiveSupportMode,
      crubTechControlsActive2LayerSettings,
      usesWaterForWater,
      usesIceForWater,
    ),
    [
      effectiveSupportFillerBlock,
      effectiveShadeFillerBlock,
      effectiveCrubTechShadeBreakableFillerBlock,
      effectiveCrubTechShadePushableFillerBlock,
      effectiveSuppress2LayerLateFillerBlock,
      effectiveDominateVoidFillerBlock,
      effectiveRecessiveVoidFillerBlock,
      effectiveSupportMode,
      crubTechControlsActive2LayerSettings,
      usesWaterForWater,
      usesIceForWater,
    ],
  );
  const colorBlockSelections = useMemo<ColorBlockSelections>(
    () => ({ selectedBlocks: preset.selectedBlocks, selectedBlocksCustom, customColors }),
    [preset.selectedBlocks, selectedBlocksCustom, customColors],
  );
  const usedMaterialColorAssignments = useMemo(
    () => [...usedColorKeys]
      .toSorted((a, b) => a - b)
      .map(key => `${key}=${resolveAssignedColorBlock(parseColorRefKey(key), colorBlockSelections)}`)
      .join("|"),
    [usedColorKeys, colorBlockSelections],
  );
  const usedMaterialFillerAssignments = useMemo(() => {
    if (aggregateFillerRoleCounts.size === 0) return "";
    const assignmentByRole = new Map(uiFillerAssignments.map(assignment => [assignment.role, assignment.block]));
    return [...aggregateFillerRoleCounts.keys()]
      .toSorted()
      .map(role => `${role}=${assignmentByRole.get(role) ?? ""}`)
      .join("|");
  }, [aggregateFillerRoleCounts, uiFillerAssignments]);
  const currentMaterialInputSignature = useMemo(
    () =>
      [
        usedMaterialColorAssignments,
        usedMaterialFillerAssignments,
        `support=${effectiveSupportMode !== SupportMode.None ? 1 : 0}`,
        `supportFloorY=${effectiveApplySupportFloorYs ? 1 : 0}`,
      ].join("||"),
    [usedMaterialColorAssignments, usedMaterialFillerAssignments, effectiveSupportMode, effectiveApplySupportFloorYs],
  );
  const currentWaterDrops = crubTechControlsActive2LayerSettings
    ? CRUBTECH_WATER_DROPS
    : buildWaterDropInputs(darkWaterDrop, flatWaterDrop, lightWaterDrop);
  const visibleWaterLevelControls = !imageHasWater || !effectiveBelowPlatformWater || effectiveBuildMode === BuildMode.Flat
    ? []
    : WATER_DROP_INPUT_ORDER
      .filter(shade => usedWaterShades.has(shade))
      .map(shade => ({ shade, value: currentWaterDrops[shade] }));

  useEffect(() => {
    if (!effectiveBelowPlatformWater || crubTechControlsActive2LayerSettings) return;
    if (lightWaterDrop !== normalizedImmediateWaterDrops[Shade.Light]) setLightWaterDrop(normalizedImmediateWaterDrops[Shade.Light]);
    if (flatWaterDrop !== normalizedImmediateWaterDrops[Shade.Flat]) setFlatWaterDrop(normalizedImmediateWaterDrops[Shade.Flat]);
    if (darkWaterDrop !== normalizedImmediateWaterDrops[Shade.Dark]) setDarkWaterDrop(normalizedImmediateWaterDrops[Shade.Dark]);
  }, [
    effectiveBelowPlatformWater,
    crubTechControlsActive2LayerSettings,
    lightWaterDrop,
    flatWaterDrop,
    darkWaterDrop,
    normalizedImmediateWaterDrops,
  ]);

  useEffect(() => {
    if (tileGeometryAnalyses.length === 0) {
      previousMaterialInputsRef.current = null;
      setTileAnalysesState(current => (current.length === 0 ? current : []));
      setIsAnalyzingMaterials(false);
      setMaterialAnalysisProgress(current => (current === null ? current : null));
      return;
    }

    let cancelled = false;
    const totalTiles = tileGeometryAnalyses.length;
    const previousMaterialInputs = previousMaterialInputsRef.current;
    const materialAnalysisOptions = {
      selectedBlocks: preset.selectedBlocks,
      selectedBlocksCustom,
      fillerAssignments: uiFillerAssignments,
      applySupportFloorYs: effectiveApplySupportFloorYs,
      customColors,
    };
    const currentColorAssignmentsByKey = new Map(
      [...usedColorKeys].map(key => [key, resolveAssignedColorBlock(parseColorRefKey(key), colorBlockSelections)] as const),
    );
    const currentFillerAssignmentsByRole = new Map(uiFillerAssignments.map(assignment => [assignment.role, assignment.block]));
    const currentSupportModeEnabled = effectiveSupportMode !== SupportMode.None;
    const changedColorKeys = previousMaterialInputs
      ? new Set(
          [...usedColorKeys].filter(key =>
            previousMaterialInputs.colorAssignmentsByKey.get(key) !== currentColorAssignmentsByKey.get(key),
          ),
        )
      : EMPTY_USED_COLOR_KEYS;
    const changedFillerRoles = previousMaterialInputs
      ? new Set(
          [...aggregateFillerRoleCounts.keys()].filter(role =>
            (previousMaterialInputs.fillerAssignmentsByRole.get(role) ?? "") !== (currentFillerAssignmentsByRole.get(role) ?? ""),
          ),
        )
      : new Set<FillerRole>();
    const canReuseMaterialStats = (
      previousTile: TileAnalysis | undefined,
      tile: TileGeometryAnalysis,
    ): previousTile is TileAnalysis => {
      if (!previousTile?.materialNeedStats || !tile.supportShape) return false;
      if (previousTile.tile.cacheKey !== tile.tile.cacheKey || previousTile.supportShape !== tile.supportShape) return false;
      if (!previousMaterialInputs || previousMaterialInputs.applySupportFloorYs !== effectiveApplySupportFloorYs) return false;
      if (hasAnySharedValue(tile.derivedImageStats.usedShadesByColorKey.keys(), changedColorKeys)) return false;
      if (hasAnySharedValue(tile.fillerNeedStats?.roleCounts.keys() ?? [], changedFillerRoles)) return false;
      return true;
    };
    const canReuseFragileStats = (
      previousTile: TileAnalysis | undefined,
      tile: TileGeometryAnalysis,
    ): previousTile is TileAnalysis => {
      if (!currentSupportModeEnabled || !previousTile?.fragileSupportOverrideNeedStats) return false;
      if (!previousMaterialInputs?.supportModeEnabled) return false;
      return canReuseMaterialStats(previousTile, tile);
    };
    const reusableTileAnalyses = tileGeometryAnalyses.map((tile, index) => {
      if (!tile.supportShape) {
        return {
          ...tile,
          materialNeedStats: null,
          fragileSupportOverrideNeedStats: null,
        } satisfies TileAnalysis;
      }
      const previousTile = tileAnalysesState[index];
      if (!canReuseMaterialStats(previousTile, tile)) return null;
      return {
        ...tile,
        materialNeedStats: previousTile.materialNeedStats,
        fragileSupportOverrideNeedStats: canReuseFragileStats(previousTile, tile)
          ? previousTile.fragileSupportOverrideNeedStats
          : null,
      } satisfies TileAnalysis;
    });

    if (
      reusableTileAnalyses.every((tile): tile is TileAnalysis => tile !== null) &&
      (
        !currentSupportModeEnabled ||
        reusableTileAnalyses.every((tile, index) =>
          !tileGeometryAnalyses[index]?.supportShape || tile.fragileSupportOverrideNeedStats !== null,
        )
      )
    ) {
      previousMaterialInputsRef.current = {
        signature: currentMaterialInputSignature,
        colorAssignmentsByKey: new Map(currentColorAssignmentsByKey),
        fillerAssignmentsByRole: new Map(currentFillerAssignmentsByRole),
        applySupportFloorYs: effectiveApplySupportFloorYs,
        supportModeEnabled: currentSupportModeEnabled,
      };
      setTileAnalysesState(current => (areTileAnalysesShallowEqual(current, reusableTileAnalyses) ? current : reusableTileAnalyses));
      setIsAnalyzingMaterials(false);
      setMaterialAnalysisProgress(current => (current === null ? current : null));
      return;
    }

    setIsAnalyzingMaterials(true);
    setMaterialAnalysisProgress(totalTiles > 1 ? { completed: 0, total: totalTiles } : null);

    void (async () => {
      await yieldToMainThread();
      let lastMainThreadProgressUpdateAt = performance.now();
      const nextTileAnalyses: TileAnalysis[] = [];

      for (const [index, tile] of tileGeometryAnalyses.entries()) {
        const reusableTileAnalysis = reusableTileAnalyses[index];
        if (reusableTileAnalysis && (!currentSupportModeEnabled || reusableTileAnalysis.fragileSupportOverrideNeedStats !== null)) {
          nextTileAnalyses.push(reusableTileAnalysis);
        } else if (!tile.supportShape) {
          nextTileAnalyses.push({
            ...tile,
            materialNeedStats: null,
            fragileSupportOverrideNeedStats: null,
          });
        } else {
          const previousTile = tileAnalysesState[index];
          const materialNeedStats =
            reusableTileAnalysis?.materialNeedStats ??
            (canReuseMaterialStats(previousTile, tile) ? previousTile.materialNeedStats : analyzeMaterialNeeds(tile.tile.colorGrid, tile.supportShape, materialAnalysisOptions));
          const fragileSupportOverrideNeedStats =
            currentSupportModeEnabled
              ? canReuseFragileStats(previousTile, tile)
                ? previousTile.fragileSupportOverrideNeedStats
                : analyzeFragileSupportOverrideNeeds(tile.supportShape, materialAnalysisOptions)
              : null;
          nextTileAnalyses.push({
            ...tile,
            materialNeedStats,
            fragileSupportOverrideNeedStats,
          });
        }

        if (cancelled) return;
        if (totalTiles > 1) {
          const completed = index + 1;
          const now = performance.now();
          if (shouldUpdateMainThreadProgress(completed, totalTiles, lastMainThreadProgressUpdateAt, now)) {
            lastMainThreadProgressUpdateAt = now;
            setMaterialAnalysisProgress(current =>
              current?.completed === completed && current.total === totalTiles
                ? current
                : { completed, total: totalTiles },
            );
            if (completed < totalTiles) await yieldToMainThread();
          }
        }
      }

      if (cancelled) return;
      previousMaterialInputsRef.current = {
        signature: currentMaterialInputSignature,
        colorAssignmentsByKey: new Map(currentColorAssignmentsByKey),
        fillerAssignmentsByRole: new Map(currentFillerAssignmentsByRole),
        applySupportFloorYs: effectiveApplySupportFloorYs,
        supportModeEnabled: currentSupportModeEnabled,
      };
      setTileAnalysesState(current => (areTileAnalysesShallowEqual(current, nextTileAnalyses) ? current : nextTileAnalyses));
      setIsAnalyzingMaterials(false);
      setMaterialAnalysisProgress(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    tileGeometryAnalyses,
    usedMaterialColorAssignments,
    usedMaterialFillerAssignments,
    currentMaterialInputSignature,
    effectiveApplySupportFloorYs,
    effectiveSupportMode,
  ]);
  const tileAnalyses = tileAnalysesState;
  const hasCurrentTileGeometryAnalysis = hasCurrentTileGeometryAnalyses(parsedTiles, tileGeometryAnalyses);
  const materialInputsMatchCurrent = previousMaterialInputsRef.current?.signature === currentMaterialInputSignature;
  const hasCurrentMaterialAnalysis =
    hasCurrentTileGeometryAnalysis &&
    hasCurrentMaterialAnalyses(tileGeometryAnalyses, tileAnalysesState) &&
    materialInputsMatchCurrent &&
    pendingIncomingTileCount === null;

  const setNormalizedWaterDrop = useCallback((shade: WaterDropShade, rawValue: number) => {
    const normalizedValue = Math.max(0, Math.trunc(rawValue) || 0);
    const nextDrops = normalizeUsedWaterDrops(
      buildWaterDropInputs(
        shade === Shade.Dark ? normalizedValue : darkWaterDrop,
        shade === Shade.Flat ? normalizedValue : flatWaterDrop,
        shade === Shade.Light ? normalizedValue : lightWaterDrop,
      ),
      usedWaterShades,
      shade,
    );

    setLightWaterDrop(nextDrops[Shade.Light]);
    setFlatWaterDrop(nextDrops[Shade.Flat]);
    setDarkWaterDrop(nextDrops[Shade.Dark]);
  }, [darkWaterDrop, flatWaterDrop, lightWaterDrop, usedWaterShades]);

  const missingColorKeys = useMemo(() => {
    if (!imageValid || usedColorKeys.size === 0) return EMPTY_USED_COLOR_KEYS;
    return new Set(
      [...usedColorKeys].filter(key => {
        const color = parseColorRefKey(key);
        return (color.isCustom || color.id !== TRANSPARENCY_BASE_INDEX) && !hasAssignedColorBlock(color, colorBlockSelections);
      }),
    );
  }, [imageValid, usedColorKeys, colorBlockSelections]);
  const missingBlockCount = missingColorKeys.size;

  const activeSingleTileIndex = hasMultipleTiles ? selectedTileIndex : (tileAnalyses.length > 0 ? 0 : null);
  const selectedTileAnalysis = activeSingleTileIndex === null ? null : (tileAnalyses[activeSingleTileIndex] ?? null);
  const isStepRangeMode = isSuppressStepsBuildMode(effectiveBuildMode);
  const showPreviewRangeControls = selectedTileAnalysis !== null && (!hasMultipleTiles || selectedTileCount === 1);
  const showWestEastSlopeControls = showPreviewRangeControls && !isSuppressBuildMode(effectiveBuildMode);
  const isNorthSouthSuppressStepDirection =
    suppressStepDirection === SuppressStepDirection.NorthToSouth ||
    suppressStepDirection === SuppressStepDirection.SouthToNorth;
  const supportShape = selectedTileAnalysis?.supportShape ?? null;
  const maxRangeIndex = useMemo(
    () => {
      if (!selectedTileAnalysis) return getBuildModeRangeMax(effectiveBuildMode);
      return isStepRangeMode
        ? Math.max(0, (supportShape?.parts.length ?? (getBuildModeRangeMax(effectiveBuildMode) + (effectiveBelowPlatformWater && selectedTileAnalysis.hasWater ? 1 : 0))) - 1)
        : getBuildModeRangeMax(effectiveBuildMode);
    },
    [effectiveBuildMode, isStepRangeMode, supportShape, effectiveBelowPlatformWater, selectedTileAnalysis],
  );
  const minLayerGap = supportMode === SupportMode.Fragile || supportMode === SupportMode.All ? 3 : 2;
  const supportModeVisibilityPending =
    !!imageData &&
    (
      isParsingImage ||
      (
        imageValid &&
        parsedTiles.length > 0 &&
        !hasCurrentTileGeometryAnalysis
      )
    );
  const enableStepsSupportOption = crubTechControlsActive2LayerSettings || (
    !buildModeUsesLayerGap(effectiveBuildMode) && (
      !imageData || supportModeVisibilityPending || tileAnalyses.some(tile =>
        !!tile.supportShape?.parts.some(part =>
          part.cells.entries().some(([coord, cell]) => {
            if (!isShapeFillerCell(cell) || !cell.includes(FillerRole.StairStep)) return false;
            const [x, y, z] = parseShapeCoordKey(coord);
            const supportFloorYs = effectiveApplySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
            return isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs);
          }),
        ),
      )
    )
  );
  const enableFragileSupportOption = useMemo(() => {
    if (crubTechControlsActive2LayerSettings) return false;
    const hasFragileMappedBlock = (block: string) => !!block && isFragileBlock(normalizeBlockId(block));
    if (!imageData) {
      return Object.values(preset.selectedBlocks).some(hasFragileMappedBlock) ||
        customColors.some((_, customIndex) =>
          hasFragileMappedBlock(getSelectedCustomColorBlock(selectedBlocksCustom, customIndex, customColors))
        );
    }
    if (supportModeVisibilityPending) return true;
    return tileAnalyses.some(tile =>
      !!tile.supportShape?.parts.some(part =>
        part.cells.entries().some(([coord, cell]) => {
          if (!isShapeFillerCell(cell)) return false;
          const [x, y, z] = parseShapeCoordKey(coord);
          const supportFloorYs = effectiveApplySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
          if (!isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs)) return false;
          if (!cell.includes(FillerRole.SupportFragile)) return false;
          const color = getSupportedColorAbove(part, coord);
          if (!color) return false;
          const mapped = resolveAssignedColorBlock(color, colorBlockSelections);
          return hasFragileMappedBlock(mapped);
        }),
      ),
    );
  }, [
    crubTechControlsActive2LayerSettings,
    imageData,
    supportModeVisibilityPending,
    tileAnalyses,
    colorBlockSelections,
    effectiveApplySupportFloorYs,
  ]);
  const staircaseModeOptions = useMemo(
    () => getStaircaseModeOptionsForState(
      imageValid,
      tileBaseAnalyses,
      tileDerivedImageStats,
      isFlatShape,
      hasMultipleTiles,
      showFlatNbtSuppressStepOptions,
    ),
    [
      imageValid,
      tileBaseAnalyses,
      tileDerivedImageStats,
      isFlatShape,
      hasMultipleTiles,
      showFlatNbtSuppressStepOptions,
    ],
  );

  const suppressModeOptions = useMemo(
    () => getSuppressModeOptionsForState(twoLayerHasLateVoidNeed, hasMultipleTiles, showFlatNbtSuppressStepOptions),
    [twoLayerHasLateVoidNeed, hasMultipleTiles, showFlatNbtSuppressStepOptions],
  );
  const buildAtWorldMinYEligible = useMemo(
    () => getBuildAtWorldMinYEligibleForBuildMode(tileBaseAnalyses, effectiveBuildMode, effectiveApplySupportFloorYs),
    [tileBaseAnalyses, effectiveBuildMode, effectiveApplySupportFloorYs],
  );
  const showBuildAtWorldMinYToggle = imageValid && buildAtWorldMinYEligible;
  const shadingMethodTooltip = messages.buildMode.tooltip(buildMode);
  const supportModeTooltip = messages.supportMode.tooltip(effectiveSupportMode);
  const suppressStepNorthSouthWarning = useMemo(
    () =>
      !!imageData &&
      imageValid &&
      !lockFlatBuildMode &&
      isSuppressStepsBuildMode(buildMode) &&
      isNorthSouthSuppressStepDirection
        ? messages.preview.suppressStepNorthSouthWarning(
            messages.buildMode.optionLabel(buildMode),
            messages.buildMode.stepDirectionLabel(suppressStepDirection),
          )
        : null,
    [
      buildMode,
      imageData,
      imageValid,
      lockFlatBuildMode,
      suppressStepDirection,
      isNorthSouthSuppressStepDirection,
    ],
  );
  const buildMaterialAnalysisOptions = useCallback(
    (fillerAssignments: FillerAssignment[], includeRange: boolean) => ({
      selectedBlocks: preset.selectedBlocks,
      fillerAssignments,
      applySupportFloorYs: effectiveApplySupportFloorYs,
      customColors,
      selectedBlocksCustom,
      ...(includeRange && colRangeEnabled
        ? (isStepRangeMode ? { phaseRange: [colStart, colEnd] as [number, number] } : { xColumnRange: [colStart, colEnd] as [number, number] })
        : {}),
    }),
    [preset.selectedBlocks, effectiveApplySupportFloorYs, customColors, selectedBlocksCustom, colRangeEnabled, isStepRangeMode, colStart, colEnd],
  );

  const selectedTileMaterialNeedStats = useMemo(() => {
    if (!selectedTileAnalysis?.supportShape || !imageValid) return null;
    if (!colRangeEnabled) return selectedTileAnalysis.materialNeedStats;
    return analyzeMaterialNeeds(
      selectedTileAnalysis.tile.colorGrid,
      selectedTileAnalysis.supportShape,
      buildMaterialAnalysisOptions(uiFillerAssignments, true),
    );
  }, [selectedTileAnalysis, imageValid, colRangeEnabled, buildMaterialAnalysisOptions, uiFillerAssignments]);
  const allTileMaterialCountsSum = useMemo(
    () => aggregateMaterialCounts(tileAnalyses.flatMap(tile => (tile.materialNeedStats ? [tile.materialNeedStats] : [])), "sum"),
    [tileAnalyses],
  );
  const selectedTileAnalyses = useMemo(
    () => effectiveSelectedTileIndices.flatMap(index => {
      const tileAnalysis = tileAnalyses[index];
      return tileAnalysis ? [tileAnalysis] : [];
    }),
    [effectiveSelectedTileIndices, tileAnalyses],
  );
  const activeOutputTileAnalyses = selectedTileIndices.length > 0 ? selectedTileAnalyses : tileAnalyses;
  const suppressedTransparentVsCollisionCount = useMemo(
    () => activeOutputTileAnalyses.reduce(
      (sum, tile) => sum + (tile.supportShape?.suppressedTransparentVsCollisionCount ?? 0),
      0,
    ),
    [activeOutputTileAnalyses],
  );
  const selectionMaterialCountsSum = useMemo(
    () => aggregateMaterialCounts(selectedTileAnalyses.flatMap(tile => (tile.materialNeedStats ? [tile.materialNeedStats] : [])), "sum"),
    [selectedTileAnalyses],
  );
  const selectionMaterialCountsMax = useMemo(
    () => aggregateMaterialCounts(selectedTileAnalyses.flatMap(tile => (tile.materialNeedStats ? [tile.materialNeedStats] : [])), "max"),
    [selectedTileAnalyses],
  );
  const fragileSupportOverrideNeedStats = useMemo(() => {
    const aggregateStats = tileAnalyses.flatMap(tile => tile.fragileSupportOverrideNeedStats ? [tile.fragileSupportOverrideNeedStats] : []);
    return aggregateStats.length > 0 ? { overrideCounts: aggregateOverrideCounts(aggregateStats) } : null;
  }, [tileAnalyses]);
  const getSupportModeRoleCount = useCallback(
    (...roles: FillerRole[]) =>
      roles.reduce((sum, role) => sum + (aggregateFillerRoleCounts.get(role) ?? 0), 0),
    [aggregateFillerRoleCounts],
  );
  const allSupportRoles = useMemo(
    () => getSupportModeFillerRoles(
      SupportMode.All,
      usesWaterForWater,
      usesIceForWater,
      false,
    ),
    [usesWaterForWater, usesIceForWater],
  );
  const waterSupportRoles = useMemo(
    () => getSupportModeFillerRoles(SupportMode.Water, usesWaterForWater, usesIceForWater, false),
    [usesWaterForWater, usesIceForWater],
  );
  const activeSupportRoles = useMemo(
    () => getSupportModeFillerRoles(
      effectiveSupportMode,
      usesWaterForWater,
      usesIceForWater,
      crubTechControlsActive2LayerSettings,
    ),
    [effectiveSupportMode, usesWaterForWater, usesIceForWater, crubTechControlsActive2LayerSettings],
  );
  const enableAllSupportOption = !crubTechControlsActive2LayerSettings && (
    !imageData || supportModeVisibilityPending || getSupportModeRoleCount(...allSupportRoles) > 0
  );
  const enableWaterSupportOption = !crubTechControlsActive2LayerSettings && (
    !imageData || supportModeVisibilityPending || getSupportModeRoleCount(...waterSupportRoles) > 0
  );
  const showSupportModeSelector = !imageData || supportModeVisibilityPending || (
    enableAllSupportOption ||
    enableStepsSupportOption ||
    enableWaterSupportOption ||
    (!supportFillerIsFragile && enableFragileSupportOption)
  );
  const materialCountsView = useMemo(
    () => {
      if (selectedTileAnalysis && selectedTileMaterialNeedStats) return selectedTileMaterialNeedStats;
      return showMaxPerSplit ? selectionMaterialCountsMax : selectionMaterialCountsSum;
    },
    [
      selectedTileAnalysis,
      selectedTileMaterialNeedStats,
      showMaxPerSplit,
      selectionMaterialCountsMax,
      selectionMaterialCountsSum,
    ],
  );
  const holdResolvedMaterialUi =
    pendingIncomingTileCount === null &&
    !!imageData &&
    parsedTiles.length === 1 &&
    (pendingTransparentMaterialRefresh || !hasCurrentMaterialAnalysis);
  const materialCountsDisplayView = useHeldValueWhilePending(
    hasCurrentMaterialAnalysis ? materialCountsView : EMPTY_MATERIAL_COUNTS,
    holdResolvedMaterialUi,
  );
  const allTileMaterialCountsDisplaySum = useHeldValueWhilePending(
    hasCurrentMaterialAnalysis ? allTileMaterialCountsSum : EMPTY_MATERIAL_COUNTS,
    holdResolvedMaterialUi,
  );
  const fragileSupportOverrideNeedStatsDisplay = useHeldValueWhilePending(
    hasCurrentMaterialAnalysis ? fragileSupportOverrideNeedStats : null,
    holdResolvedMaterialUi,
  );
  const numUniqueColorShadesForPart =
    selectedTileMaterialNeedStats?.numUniqueColorShadesForPart ??
    (paletteUsageInfo?.uniqueShadeCount ?? 0);
  const formatRequiredCount = (count: number) => (showStacks ? formatStacks(count) : count);
  const numColorBlockTypesForPart = Object.values(materialCountsDisplayView.colorCounts).filter(count => count > 0).length;

  const builtinPreset = getBuiltinPreset(preset.name);
  const isBuiltinUnedited = builtinPreset ? arePresetBlocksEqual(builtinPreset.selectedBlocks, preset.selectedBlocks) : false;

  useEffect(() => {
    const clampedStart = Math.max(0, Math.min(colStart, maxRangeIndex));
    const clampedEnd = Math.max(clampedStart, Math.min(colEnd, maxRangeIndex));
    if (clampedStart !== colStart) setColStart(clampedStart);
    if (clampedEnd !== colEnd) setColEnd(clampedEnd);
  }, [colStart, colEnd, maxRangeIndex]);

  useEffect(() => {
    const nextSelected = normalizeTileSelection(selectedTileIndices, tileCount);
    const selectionChanged =
      nextSelected.length !== selectedTileIndices.length ||
      nextSelected.some((index, position) => index !== selectedTileIndices[position]);
    if (selectionChanged) setSelectedTileIndices(nextSelected);
    if (tileSelectionAnchorIndex !== null && tileSelectionAnchorIndex >= tileCount) {
      setTileSelectionAnchorIndex(nextSelected[nextSelected.length - 1] ?? null);
    }
  }, [selectedTileIndices, tileSelectionAnchorIndex, tileCount]);

  useEffect(() => {
    if (!hasMultipleTiles || selectedTileCount === 1 || !colRangeEnabled) return;
    setColRangeEnabled(false);
  }, [hasMultipleTiles, selectedTileCount, colRangeEnabled]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encodedPreset = params.get("preset");
    const encodedImage = params.get("image");
    let cancelled = false;

    void (async () => {
      const decodedPreset = encodedPreset ? await decodeFullPreset(encodedPreset) : null;
      const decodedColorGrid = encodedImage ? await decodeColorGrid(encodedImage) : null;
      if (cancelled) return;

      if (decodedPreset) {
        setPresets(prev => {
          const decodedBlockPreset: BlockPreset = {
            ...decodedPreset.blockPreset,
            customColors: decodedPreset.customColors ? cloneCustomColors(decodedPreset.customColors) : undefined,
            selectedBlocksCustom: decodedPreset.selectedBlocksCustom,
          };
          const exists = prev.findIndex(p => p.name === decodedPreset.blockPreset.name);
          if (exists >= 0) {
            const n = [...prev];
            n[exists] = decodedBlockPreset;
            setActiveIdx(exists);
            return n;
          }
          setActiveIdx(prev.length);
          return [...prev, decodedBlockPreset];
        });
        if (decodedPreset.supportFiller !== undefined) setSupportFillerBlock(decodedPreset.supportFiller);
        if (decodedPreset.shadeFiller !== undefined) setShadeFillerBlock(decodedPreset.shadeFiller);
        if (decodedPreset.crubTechShadeBreakableFillerBlock !== undefined) {
          setCrubTechShadeBreakableFillerBlock(decodedPreset.crubTechShadeBreakableFillerBlock);
        }
        if (decodedPreset.crubTechShadePushableFillerBlock !== undefined) {
          setCrubTechShadePushableFillerBlock(decodedPreset.crubTechShadePushableFillerBlock);
        }
        if (decodedPreset.supportMode !== undefined) setSupportMode(decodedPreset.supportMode);
        if (decodedPreset.buildMode) setBuildMode(decodedPreset.buildMode);
        setCustomColors(decodedPreset.customColors ?? []);
        setSelectedBlocksCustom(decodedPreset.selectedBlocksCustom ?? {});
        if (decodedPreset.suppress2LayerLateFillerBlock !== undefined) {
          setSuppress2LayerLateFillerBlock(decodedPreset.suppress2LayerLateFillerBlock);
        }
        if (decodedPreset.suppress2LayerLatePairsGap !== undefined) {
          setSuppress2LayerLatePairsGap(decodedPreset.suppress2LayerLatePairsGap);
        }
        if (decodedPreset.proPaletteSeed !== undefined) setProPaletteSeed(decodedPreset.proPaletteSeed);
        if (decodedPreset.mixSteps !== undefined) setMixSteps(decodedPreset.mixSteps);
        if (decodedPreset.buildAtWorldMinY !== undefined) setBuildAtWorldMinY(decodedPreset.buildAtWorldMinY);
        if (decodedPreset.crubTech !== undefined) setCrubTech(decodedPreset.crubTech);
        if (decodedPreset.suppressStepDirection !== undefined && isSuppressStepDirection(decodedPreset.suppressStepDirection)) {
          setSuppressDirection(decodedPreset.suppressStepDirection);
        }
        if (decodedPreset.dominateVoidFillerBlock !== undefined) setDominateVoidFillerBlock(decodedPreset.dominateVoidFillerBlock);
        if (decodedPreset.recessiveVoidFillerBlock !== undefined) setRecessiveVoidFillerBlock(decodedPreset.recessiveVoidFillerBlock);
        // if (decodedPreset.convertUnsupported !== undefined) setConvertUnsupported(decodedPreset.convertUnsupported);
      }

      if (decodedColorGrid) {
        setDecodedColorGrid(decodedColorGrid);
        setImageData(createImageDataFromColorGrid(decodedColorGrid, decodedPreset?.customColors ?? []));
        replaceUploadedPreviewUrl(null);
        setImageName(messages.upload.sharedImageName);
        setImageValid(true);
        setPaletteNotices([]);
        setSelectedTileIndices([]);
        setTileSelectionAnchorIndex(null);
        setColRangeEnabled(false);
        setShowUnusedColors(false);
        if (sortKey === "default") {
          setSortKey("required");
          setSortDir("desc");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [replaceUploadedPreviewUrl]);

  useEffect(() => {
    if (!imageData || previewBusy || crubTechControlsActive2LayerSettings) return;
    if (supportMode === SupportMode.All && !enableAllSupportOption) { setSupportMode(SupportMode.None); return; }
    if (supportMode === SupportMode.Fragile && (supportFillerIsFragile || !enableFragileSupportOption)) { setSupportMode(SupportMode.None); return; }
    if (supportMode === SupportMode.Steps && !enableStepsSupportOption) setSupportMode(SupportMode.None);
    if (supportMode === SupportMode.Water && !enableWaterSupportOption) setSupportMode(SupportMode.None);
  }, [
    imageData,
    previewBusy,
    crubTechControlsActive2LayerSettings,
    enableAllSupportOption,
    enableStepsSupportOption,
    enableFragileSupportOption,
    enableWaterSupportOption,
    supportMode,
    supportFillerIsFragile,
  ]);

  useEffect(() => {
    if ((supportMode === SupportMode.Fragile || supportMode === SupportMode.All) && layerGap < 3) setLayerGap(3);
  }, [supportMode, layerGap]);

  const customBlocksByBase = useMemo(() => buildCustomBlocksByBase(customColors), [customColors]);

  const getNextCustomPresetName = useCallback((existingPresets: readonly BlockPreset[]): string => {
    let customName: string = messages.presets.customGroupLabel;
    const existingNames = new Set(existingPresets.map(existingPreset => existingPreset.name));
    let suffix = 2;
    while (existingNames.has(customName)) {
      customName = `Custom ${suffix++}`;
    }
    return customName;
  }, []);

  const applyPresetAndCustomColorUpdate = useCallback((
    nextBlocks: Record<number, string>,
    nextCustomColors: readonly ColorRgb[],
    nextCustomSelectedBlocks: Record<number, string>,
  ) => {
    const normalizedCustomColors = cloneCustomColors(nextCustomColors);
    const normalizedCustomSelectedBlocks = normalizeCustomSelectedBlocks(normalizedCustomColors, nextCustomSelectedBlocks);
    if (
      arePresetBlocksEqual(nextBlocks, preset.selectedBlocks) &&
      areCustomColorsEqual(normalizedCustomColors, customColors) &&
      areCustomSelectedBlocksEqual(normalizedCustomSelectedBlocks, selectedBlocksCustom, normalizedCustomColors)
    ) return;

    const isBuiltin = activeIdx < BUILTIN_PRESET_NAMES.length;
    const matchingBuiltinName = findMatchingBuiltinPresetName(nextBlocks);

    if (isBuiltin) {
      setSavedPresetSnapshot(capturePresetSnapshot());
      setPresets(prev => [
        ...prev,
        {
          name: getNextCustomPresetName(prev),
          selectedBlocks: nextBlocks,
          customColors: normalizedCustomColors.length > 0 ? normalizedCustomColors : undefined,
          selectedBlocksCustom: normalizedCustomColors.length > 0 ? normalizedCustomSelectedBlocks : undefined,
        },
      ]);
      setCustomColors(normalizedCustomColors);
      setSelectedBlocksCustom(normalizedCustomSelectedBlocks);
      setActiveIdx(presets.length);
      return;
    }

    setCustomColors(normalizedCustomColors);
    setSelectedBlocksCustom(normalizedCustomSelectedBlocks);

    if (matchingBuiltinName && normalizedCustomColors.length === 0) {
      const matchingBuiltinIdx = BUILTIN_PRESET_NAMES.findIndex(name => name === matchingBuiltinName);
      setPresets(prev => prev.filter((_, idx) => idx !== activeIdx));
      setActiveIdx(matchingBuiltinIdx);
      markSavedDeferred();
      return;
    }

    setPresets(prev => {
      const next = [...prev];
      next[activeIdx] = {
        ...next[activeIdx],
        selectedBlocks: nextBlocks,
        customColors: normalizedCustomColors.length > 0 ? normalizedCustomColors : undefined,
        selectedBlocksCustom: normalizedCustomColors.length > 0 ? normalizedCustomSelectedBlocks : undefined,
      };
      return next;
    });
  }, [
    activeIdx,
    capturePresetSnapshot,
    customColors,
    selectedBlocksCustom,
    getNextCustomPresetName,
    markSavedDeferred,
    preset.selectedBlocks,
    presets.length,
  ]);

  const applyCustomColorUpdate = useCallback((
    updater: (current: { customColors: readonly ColorRgb[]; selectedBlocksCustom: Record<number, string> }) => {
      customColors: readonly ColorRgb[];
      selectedBlocksCustom: Record<number, string>;
    },
  ) => {
    const nextState = updater({
      customColors,
      selectedBlocksCustom,
    });
    applyPresetAndCustomColorUpdate({ ...preset.selectedBlocks }, nextState.customColors, nextState.selectedBlocksCustom);
  }, [applyPresetAndCustomColorUpdate, customColors, selectedBlocksCustom, preset.selectedBlocks]);

  useEffect(() => {
    if (!pendingTransparentMaterialRefresh) return;
    if (!imageData || (imageValid && hasCurrentMaterialAnalysis && !previewBusy)) {
      setPendingTransparentMaterialRefresh(false);
    }
  }, [pendingTransparentMaterialRefresh, imageData, imageValid, hasCurrentMaterialAnalysis, previewBusy]);

  const updateBlock = (baseIndex: number, block: string) => {
    const nextBlock = sanitizeUserBlockEntry(block);
    const currentBlock = preset.selectedBlocks[baseIndex] ?? "";
    if (nextBlock === currentBlock) return;
    if (baseIndex === TRANSPARENCY_BASE_INDEX) setPendingTransparentMaterialRefresh(true);
    applyPresetAndCustomColorUpdate(
      { ...preset.selectedBlocks, [baseIndex]: nextBlock },
      customColors,
      selectedBlocksCustom,
    );
  };

  const selectPreset = (idx: number) => {
    const builtin = getBuiltinPreset(presets[idx].name);
    const nextIdx = currentPresetIsUnsavedAuto && idx > activeIdx ? idx - 1 : idx;
    setPresets(prev => {
      let next = [...prev];
      if (builtin) next[idx] = builtin;
      if (currentPresetIsUnsavedAuto && idx !== activeIdx) {
        next = next.filter((_, i) => i !== activeIdx);
      }
      return next;
    });
    setCustomColors(cloneCustomColors((builtin ?? presets[idx]).customColors ?? []));
    setSelectedBlocksCustom(normalizeCustomSelectedBlocks(
      (builtin ?? presets[idx]).customColors ?? [],
      (builtin ?? presets[idx]).selectedBlocksCustom,
    ));
    setActiveIdx(nextIdx);
    markSavedDeferred();
  };

  const setCrubTechWithPreset = (enabled: boolean) => {
    setCrubTech(enabled);
    if (!enabled) return;
    const crubTechPresetIdx = presets.findIndex(p => p.name === CRUBTECH_PRESET_NAME);
    if (crubTechPresetIdx >= 0 && crubTechPresetIdx !== activeIdx) selectPreset(crubTechPresetIdx);
  };

  const createPreset = () => {
    const name = prompt(messages.presets.namePrompt)?.trim();
    if (!name) return;
    // If a preset with this name already exists, switch to it
    const existingIdx = presets.findIndex(p => p.name === name);
    if (existingIdx !== -1) {
      selectPreset(existingIdx);
      return;
    }
    if (currentPresetIsUnsavedAuto) {
      setPresets(prev => {
        const next = [...prev];
        next[activeIdx] = {
          name,
          selectedBlocks: { ...preset.selectedBlocks },
          customColors: cloneCustomColors(customColors),
          selectedBlocksCustom: normalizeCustomSelectedBlocks(customColors, selectedBlocksCustom),
        };
        return next;
      });
      setActiveIdx(activeIdx);
    } else {
      setPresets(prev => [...prev, {
        name,
        selectedBlocks: { ...preset.selectedBlocks },
        customColors: cloneCustomColors(customColors),
        selectedBlocksCustom: normalizeCustomSelectedBlocks(customColors, selectedBlocksCustom),
      }]);
      setActiveIdx(presets.length);
    }
    markSavedDeferred();
  };

  const deletePreset = () => {
    if (activeIdx < BUILTIN_PRESET_NAMES.length) return;
    setPresets(prev => prev.filter((_, i) => i !== activeIdx));
    setCustomColors([]);
    setSelectedBlocksCustom({});
    setActiveIdx(0);
    markSavedDeferred();
  };

  const copyUrlToClipboard = useCallback(async (url: string, copiedAlert: string) => {
    await navigator.clipboard.writeText(url);
    alert(copiedAlert);
  }, []);

  const buildShareUrl = useCallback(async (includePreset: boolean, includeImage: boolean) => {
    const params = new URLSearchParams();
    const includePresetInUrl = includePreset || (includeImage && (imageUsesCustomColors || (derivedImageStats?.hasTransparency ?? false)));
    if (includePresetInUrl) {
      params.set(
        "preset",
        await encodeFullPreset(
          preset,
          supportFillerBlock,
          shadeFillerBlock,
          supportMode,
          buildMode,
          customColors,
          selectedBlocksCustom,
          convertUnsupported,
          suppress2LayerLateFillerBlock,
          suppress2LayerLatePairsGap,
          proPaletteSeed,
          mixSteps,
          buildAtWorldMinY,
          crubTech,
          suppressStepDirection,
          crubTechShadeBreakableFillerBlock,
          crubTechShadePushableFillerBlock,
          dominateVoidFillerBlock,
          recessiveVoidFillerBlock,
        ),
      );
    }
    if (includeImage && imageColorGrid && imageValid) {
      params.set("image", await encodeColorGrid(imageColorGrid));
    }
    const query = params.toString();
    return query ? `${location.origin}${location.pathname}?${query}` : `${location.origin}${location.pathname}`;
  }, [
    preset,
    supportFillerBlock,
    shadeFillerBlock,
    supportMode,
    buildMode,
    customColors,
    selectedBlocksCustom,
    convertUnsupported,
    suppress2LayerLateFillerBlock,
    suppress2LayerLatePairsGap,
    proPaletteSeed,
    mixSteps,
    buildAtWorldMinY,
    crubTech,
    suppressStepDirection,
    crubTechShadeBreakableFillerBlock,
    crubTechShadePushableFillerBlock,
    dominateVoidFillerBlock,
    recessiveVoidFillerBlock,
    imageColorGrid,
    imageValid,
    imageUsesCustomColors,
    derivedImageStats?.hasTransparency,
  ]);

  const copyImageShareUrl = useCallback(async () => {
    const url = await buildShareUrl(false, true);
    await copyUrlToClipboard(url, messages.upload.copiedImageUrlAlert);
  }, [buildShareUrl, copyUrlToClipboard]);

  const sharePreset = useCallback(async () => {
    if (presetDirty) {
      markSavedImmediate();
      return;
    }
    const url = await buildShareUrl(true, activeIdx >= BUILTIN_PRESET_NAMES.length);
    await copyUrlToClipboard(url, messages.presets.copiedUrlAlert);
  }, [presetDirty, markSavedImmediate, buildShareUrl, activeIdx, copyUrlToClipboard]);

  const clearImage = () => {
    fileLoadRequestIdRef.current += 1;
    setPendingIncomingTileCount(null);
    setDecodedColorGrid(null);
    setParsedImageSetState(null);
    setImageData(null);
    replaceUploadedPreviewUrl(null);
    setImageName("");
    setImageValid(false);
    setIsParsingImage(false);
    setParseProgress(null);
    setImageLossyFormatLabel(null);
    setPaletteNotices([]);
    setSelectedTileIndices([]);
    setTileSelectionAnchorIndex(null);
    setColRangeEnabled(false);
    setShowUnusedColors(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const isLikelyLossyImageFile = useCallback((file: File) => {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    return (
      type === "image/jpeg" ||
      type === "image/jpg" ||
      type === "image/avif" ||
      type === "image/heic" ||
      type === "image/heif" ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".avif") ||
      name.endsWith(".heic") ||
      name.endsWith(".heif")
    );
  }, []);

  const getLossyImageFormatLabel = useCallback((file: File) => {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    if (type === "image/jpeg" || type === "image/jpg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "JPG";
    if (type === "image/avif" || name.endsWith(".avif")) return "AVIF";
    if (type === "image/heic" || name.endsWith(".heic")) return "HEIC";
    if (type === "image/heif" || name.endsWith(".heif")) return "HEIF";
    return "lossy";
  }, []);

  useEffect(() => {
    if (!imageData) {
      setPendingIncomingTileCount(null);
      setParseProgress(null);
      if (!decodedColorGrid) setParsedImageSetState(null);
      return;
    }
    if (decodedColorGrid) {
      setPendingIncomingTileCount(null);
      setIsParsingImage(false);
      setParseProgress(null);
      return;
    }

    let cancelled = false;
    const exactTileCount = getTileShapeForDimensions(imageData.width, imageData.height).tileCount;
    if (!cropImage && exactTileCount === 0) {
      setParsedImageSetState({
        imageData,
        tiles: [],
        tileRows: 0,
        tileCols: 0,
        paletteNotices: [messages.parsing.imageSizeNotice(imageData.width, imageData.height)],
        hasBlockingIssue: true,
      });
      setPaletteNotices([messages.parsing.imageSizeNotice(imageData.width, imageData.height)]);
      setImageValid(false);
      setPendingIncomingTileCount(null);
      setIsParsingImage(false);
      setParseProgress(null);
      return;
    }
    const expectedTileCount = getExpectedTileShape(imageData, cropImage).tileCount;
    const singleTileImage = expectedTileCount === 1;
    setIsParsingImage(true);
    setParseProgress(!singleTileImage && expectedTileCount > 0 ? { completed: 0, total: expectedTileCount } : null);

    void (async () => {
      try {
        await yieldToMainThread();
        let lastParseProgressUpdateAt = performance.now();
        if (cancelled) return;
        const analysis = singleTileImage
          ? convertImageToColorGridSet(imageData, customColors, convertUnsupported, cropImage)
          : await (async () => {
              return convertImageToColorGridSetAsync(
                imageData,
                customColors,
                convertUnsupported,
                cropImage,
                (completed, total) => {
                  if (cancelled) return;
                  const now = performance.now();
                  if (!shouldUpdateMainThreadProgress(completed, total, lastParseProgressUpdateAt, now)) return;
                  lastParseProgressUpdateAt = now;
                  setParseProgress(current => ({ completed, total: current?.total ?? total }));
                },
              );
            })();
        if (cancelled) return;
        const paletteNotices =
          imageLossyFormatLabel && analysis.paletteNotices.some(notice => notice.kind === PaletteNoticeKind.ConvertedPaletteColors)
            ? [...analysis.paletteNotices, messages.parsing.lossyFormatHintNotice(imageLossyFormatLabel)]
            : analysis.paletteNotices;
        startTransition(() => {
          setParsedImageSetState(analysis);
          setPaletteNotices(paletteNotices);
          setImageValid(!analysis.hasBlockingIssue);
        });
      } catch (err: unknown) {
        if (cancelled) return;
        startTransition(() => {
          setParsedImageSetState(null);
          setPaletteNotices([messages.parsing.errorNotice((err as Error)?.message || messages.parsing.genericDecodeFailure)]);
          setImageValid(false);
        });
      } finally {
        if (cancelled) return;
        setPendingIncomingTileCount(null);
        setIsParsingImage(false);
        setParseProgress(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [decodedColorGrid, imageData, parseRelevantCustomColorKey, convertUnsupported, cropImage, imageLossyFormatLabel]);

  const handleFile = useCallback(
    (file: File) => {
      const requestId = fileLoadRequestIdRef.current + 1;
      fileLoadRequestIdRef.current = requestId;
      replaceUploadedPreviewUrl(URL.createObjectURL(file));
      setPendingIncomingTileCount(null);
      setDecodedColorGrid(null);
      setSelectedTileIndices([]);
      setTileSelectionAnchorIndex(null);
      setColRangeEnabled(false);
      setIsParsingImage(true);
      setParseProgress(null);
      loadImageDataFromFile(file)
        .then(nextImageData => {
          if (fileLoadRequestIdRef.current !== requestId) return;
          setPendingIncomingTileCount(getExpectedTileShape(nextImageData, cropImage).tileCount);
          setImageData(nextImageData);
          setImageName(file.name);
          setImageLossyFormatLabel(isLikelyLossyImageFile(file) ? getLossyImageFormatLabel(file) : null);
          setShowUnusedColors(false);
          if (sortKey === "default") {
            setSortKey("required");
            setSortDir("desc");
          }
        })
        .catch((err: unknown) => {
          if (fileLoadRequestIdRef.current !== requestId) return;
          setPendingIncomingTileCount(null);
          setDecodedColorGrid(null);
          setParsedImageSetState(null);
          setImageData(null);
          replaceUploadedPreviewUrl(null);
          setImageName("");
          setImageValid(false);
          setIsParsingImage(false);
          setParseProgress(null);
          setImageLossyFormatLabel(null);
          setPaletteNotices([messages.parsing.errorNotice((err as Error)?.message || messages.parsing.genericDecodeFailure)]);
          setSelectedTileIndices([]);
          setTileSelectionAnchorIndex(null);
          setColRangeEnabled(false);
          if (fileRef.current) fileRef.current.value = "";
        });
    },
    [cropImage, getLossyImageFormatLabel, isLikelyLossyImageFile, replaceUploadedPreviewUrl, sortKey],
  );

  const handlePaste = useEffectEvent((event: ClipboardEvent) => {
    const file = getClipboardImageFile(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    handleFile(file);
  });
  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const handleConvertAndDownload = async () => {
    if (!imageValid || tileAnalyses.length === 0) return;
    setConverting(true);
    try {
      const baseName = imageName.replace(/\.[^/.]+$/, "");
      const suffix = getBuildModeDownloadSuffix(effectiveBuildMode, suppressStepDirection, crubTechControlsActive2LayerSettings);
      const exportTileAnalyses = selectedTileIndices.length > 0 ? selectedTileAnalyses : tileAnalyses;
      const exportEntries: { name: string; data: Uint8Array }[] = [];
      const westEastSlope = westEastSlopeEnabled && westEastSlopeRise !== 0 && !isSuppressBuildMode(effectiveBuildMode)
        ? { run: westEastSlopeRun, rise: westEastSlopeRise }
        : undefined;

      for (const tile of exportTileAnalyses) {
        if (!tile.supportShape) throw new Error(messages.parsing.conversionFailed);
        const tileEntries = await convertToNbtEntries(tile.supportShape, {
          selectedBlocks: preset.selectedBlocks,
          fillerAssignments: uiFillerAssignments,
          applySupportFloorYs: effectiveApplySupportFloorYs,
          collapseDuplicatePaletteStates: collapseDuplicateNbtPaletteStates,
          forceXZ128: effectiveForceXZ128,
          forceZ129: effectiveForceZ129,
          selectedBlocksCustom,
          customColors,
          baseName,
          buildMode: effectiveBuildMode,
          suppressStepDirection: activeSuppressDirection,
          westEastSlope,
          suppress2LayerLatePairY: effectiveSuppress2LayerLatePairY,
          crubTech: crubTechControlsActive2LayerSettings,
          markSuppressLoadSpotsInSchematic,
          suppressLoadSpotMarkerBlock,
        });
        const exportTile = hasMultipleTiles ? tile.tile : null;
        if (tileEntries.length === 1) {
          exportEntries.push({
            name: `${buildExportStem(baseName, suffix, exportTile)}.nbt`,
            data: tileEntries[0].data,
          });
          continue;
        }
        for (const entry of tileEntries) {
          const splitName = entry.name.replace(`${baseName}-`, "").replace(/\.nbt$/, "");
          exportEntries.push({
            name: `${buildExportStem(baseName, suffix, exportTile, splitName)}.nbt`,
            data: entry.data,
          });
        }
      }

      const singleOutputFile = exportEntries.length === 1;
      const singleSelectedTile = exportTileAnalyses.length === 1 ? exportTileAnalyses[0] ?? null : null;
      const downloadName = singleOutputFile
        ? (exportEntries[0]?.name ?? `${buildExportStem(baseName, suffix, singleSelectedTile?.tile ?? null)}.nbt`)
        : singleSelectedTile
          ? `${buildExportStem(baseName, suffix, singleSelectedTile.tile)}.zip`
          : `${baseName}${suffix}.zip`;
      const data = singleOutputFile ? exportEntries[0].data : createZip(exportEntries);
      const mime = singleOutputFile ? "application/octet-stream" : "application/zip";
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: mime })),
        download: downloadName,
      });
      a.click();
    } catch (e: unknown) {
      setPaletteNotices([messages.parsing.errorNotice((e as Error).message || messages.parsing.conversionFailed)]);
    }
    setConverting(false);
  };

  const addCustomColor = () => {
    const block = sanitizeUserBlockEntry(newCustom.block);
    if (!block) return;
    let r = 0, g = 0, b = 0;
    if (customMode === "custom") {
      [r, g, b] = [newCustom.r, newCustom.g, newCustom.b].map(v => Number.parseInt(v, 10));
      if ([r, g, b].some(isNaN)) return;
    } else {
      ({ r, g, b } = BASE_COLORS[customMode]);
    }
    let added = false;
    applyCustomColorUpdate(({ customColors: prevColors, selectedBlocksCustom: prevSelections }) => {
      const nextState = upsertCustomColorBlock(prevColors, prevSelections, { r, g, b }, block);
      added = nextState.added;
      return {
        customColors: nextState.customColors,
        selectedBlocksCustom: nextState.selectedBlocksCustom,
      };
    });
    if (added) setNewCustom({ r: "", g: "", b: "", block: "" });
  };

  const handleCustomChannelChange = useCallback((channel: "r" | "g" | "b", value: string) => {
    setNewCustom(prev => ({ ...prev, [channel]: sanitizeCustomRgbDraftValue(value) }));
  }, []);

  const handleCustomBlockChange = useCallback((value: string) => {
    setNewCustom(prev => ({ ...prev, block: value }));
  }, []);
  const commitCustomBlockDraft = useCallback(() => {
    setNewCustom(prev => ({ ...prev, block: sanitizeUserBlockEntry(prev.block) }));
  }, []);

  const handleSelectCustomBlock = useCallback((customIndex: number, block: string) => {
    applyCustomColorUpdate(({ customColors: prevColors, selectedBlocksCustom: prevSelections }) =>
      selectCustomColorBlock(prevColors, prevSelections, customIndex, block),
    );
  }, [applyCustomColorUpdate]);

  const handleRemoveCustomBlock = useCallback((customIndex: number, block: string, baseIndex: number | null) => {
    const nextCustomState = removeCustomColorBlock(
      customColors,
      selectedBlocksCustom,
      customIndex,
      block,
    );

    const nextPresetBlocks =
      baseIndex !== null && (preset.selectedBlocks[baseIndex] ?? "") === block
        ? { ...preset.selectedBlocks, [baseIndex]: "" }
        : { ...preset.selectedBlocks };

    applyPresetAndCustomColorUpdate(nextPresetBlocks, nextCustomState.customColors, nextCustomState.selectedBlocksCustom);
  }, [applyPresetAndCustomColorUpdate, customColors, selectedBlocksCustom, preset.selectedBlocks]);

  const copyColorToClipboard = (r: number, g: number, b: number) =>
    navigator.clipboard.writeText(`#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`);

  const handleTileSelection = useCallback((tileIndex: number, modifiers: TileSelectionModifiers) => {
    const additive = modifiers.metaKey || modifiers.ctrlKey;
    setSelectedTileIndices(current => {
      const effectiveCurrent = getEffectiveTileSelection(current, tileCount);
      if (modifiers.shiftKey) {
        const anchorIndex = tileSelectionAnchorIndex ?? current[current.length - 1] ?? tileIndex;
        const range = buildTileSelectionRange(anchorIndex, tileIndex);
        return normalizeTileSelection(additive ? mergeTileSelections(effectiveCurrent, range) : range, tileCount);
      }
      if (additive) return normalizeTileSelection(toggleTileSelectionIndex(effectiveCurrent, tileIndex), tileCount);
      if (current.length === 1 && current[0] === tileIndex) return [];
      return [tileIndex];
    });
    setTileSelectionAnchorIndex(tileIndex);
  }, [tileSelectionAnchorIndex, tileCount]);

  const toggleTheme = () => {
    const next = isDark ? "light" : "dark";
    const systemTheme = getSystemPrefersDark() ? "dark" : "light";
    if (next === systemTheme) localStorage.removeItem(LS_KEYS.theme);
    else localStorage.setItem(LS_KEYS.theme, next);
    document.documentElement.classList.toggle("dark", next === "dark");
    setIsDark(next === "dark");
  };
  const handleLocalePreferenceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as LocalePreference;
    if (next === localePreference) return;
    setLocalePreferenceState(next);
    setLocalePreference(next);
    window.location.reload();
  };
  const localePreferenceDisplay = localePreference === LOCALE_BROWSER ? "auto" : localePreference;

  const aggregateNorthRowSingleLine = tileGeometryAnalyses.every(tile => tile.northRowSingleLine);

  const canGenerate = imageValid && missingBlockCount === 0;
  const hasRequiredCol = imageValid && (hasCurrentMaterialAnalysis || holdResolvedMaterialUi);
  const transparentSortColorCount = useMemo(() => {
    const transparentShadeCounts = shadeCountsByColorKey.get(getColorRefKey({ id: TRANSPARENCY_BASE_INDEX, isCustom: false }));
    if (!transparentShadeCounts) return 0;
    let total = 0;
    for (const count of transparentShadeCounts.values()) total += count;
    return total;
  }, [shadeCountsByColorKey]);
  const colorTableSortCounts = useMemo(() => {
    if (transparentSortColorCount <= 0) return materialCountsDisplayView.colorCounts;
    return {
      ...materialCountsDisplayView.colorCounts,
      [getColorRefKey({ id: TRANSPARENCY_BASE_INDEX, isCustom: false })]: transparentSortColorCount,
    };
  }, [materialCountsDisplayView.colorCounts, transparentSortColorCount]);
  const preserveSingleTileMaterialUi =
    !!imageData &&
    (
      pendingIncomingTileCount === null
        ? parsedTiles.length === 1
        : pendingIncomingTileCount === 1 && parsedTiles.length === 1
    );
  // Preserve material-analysis layout only for single-tile -> single-tile handoffs.
  // If the outgoing image is multi-tile, we clear immediately.
  // If the incoming image resolves to multi-tile, we clear as soon as its dimensions are known.
  const colorTableDisplayPending =
    preserveSingleTileMaterialUi &&
    (
      pendingTransparentMaterialRefresh ||
      isParsingImage ||
      !imageValid ||
      parsedTiles.length === 0 ||
      !hasCurrentTileGeometryAnalysis ||
      !hasCurrentMaterialAnalysis
    );
  const colorTableDisplayState = useHeldValueWhilePending(
    useMemo(
      () => ({
        imageValid,
        hasRequiredCol,
        showUsageInfo: !!paletteUsageInfo && imageValid,
        usedShadesByColorKey,
        shadeCountsByColorKey,
        sortColorCounts: colorTableSortCounts,
        missingColorKeys,
      }),
      [
        imageValid,
        hasRequiredCol,
        paletteUsageInfo,
        usedShadesByColorKey,
        shadeCountsByColorKey,
        colorTableSortCounts,
        missingColorKeys,
      ],
    ),
    colorTableDisplayPending,
  );
  const northRowFillerCount =
    (aggregateFillerRoleCounts.get(FillerRole.ShadeNorthRow) ?? 0) +
    (aggregateFillerRoleCounts.get(FillerRole.ShadeNorthRowBreakable) ?? 0) +
    (aggregateFillerRoleCounts.get(FillerRole.ShadeNorthRowPushable) ?? 0);
  const suppressFillerCount =
    (aggregateFillerRoleCounts.get(FillerRole.ShadeSuppress) ?? 0) +
    (aggregateFillerRoleCounts.get(FillerRole.ShadeSuppressBreakable) ?? 0) +
    (aggregateFillerRoleCounts.get(FillerRole.ShadeSuppressPushable) ?? 0);
  const lateSuppressFillerCount = aggregateFillerRoleCounts.get(FillerRole.ShadeSuppressLate) ?? 0;
  const getAggregateRequiredFillerRoleCount = useCallback(
    (...roles: FillerRole[]) =>
      roles.reduce((sum, role) => sum + (allTileMaterialCountsDisplaySum.fillerRoleCounts.get(role) ?? 0), 0),
    [allTileMaterialCountsDisplaySum],
  );
  const getRequiredFillerRoleCount = useCallback(
    (...roles: FillerRole[]) => roles.reduce((sum, role) => sum + (materialCountsDisplayView.fillerRoleCounts.get(role) ?? 0), 0),
    [materialCountsDisplayView],
  );
  const aggregateCrubTechBreakableRequiredCount = getAggregateRequiredFillerRoleCount(
    FillerRole.ShadeSuppressBreakable,
    FillerRole.SupportBreakable,
  );
  const aggregateCrubTechPushableRequiredCount = getAggregateRequiredFillerRoleCount(
    FillerRole.ShadeSuppressPushable,
    FillerRole.SupportPushable,
  );
  const aggregateLateFillerRequiredCount = getAggregateRequiredFillerRoleCount(FillerRole.ShadeSuppressLate);
  const aggregateDominateVoidFillerRequiredCount = getAggregateRequiredFillerRoleCount(FillerRole.ShadeVoidDominant);
  const aggregateRecessiveVoidFillerRequiredCount = getAggregateRequiredFillerRoleCount(FillerRole.ShadeVoidRecessive);
  const aggregateSupportFillerRequiredCount = getAggregateRequiredFillerRoleCount(...activeSupportRoles);
  const shadeFillerRequiredCount = getRequiredFillerRoleCount(
    FillerRole.ShadeNorthRow,
    FillerRole.ShadeSuppress,
    FillerRole.ShadeNorthRowBreakable,
    FillerRole.ShadeSuppressBreakable,
    FillerRole.ShadeNorthRowPushable,
    FillerRole.ShadeSuppressPushable,
  );
  const crubTechBreakableFillerRequiredCount = getRequiredFillerRoleCount(
    FillerRole.ShadeSuppressBreakable,
    FillerRole.SupportBreakable,
  );
  const crubTechPushableFillerRequiredCount = getRequiredFillerRoleCount(
    FillerRole.ShadeSuppressPushable,
    FillerRole.SupportPushable,
  );
  const lateFillerRequiredCount = getRequiredFillerRoleCount(FillerRole.ShadeSuppressLate);
  const dominateVoidFillerRequiredCount = getRequiredFillerRoleCount(FillerRole.ShadeVoidDominant);
  const recessiveVoidFillerRequiredCount = getRequiredFillerRoleCount(FillerRole.ShadeVoidRecessive);
  const vsFillerSpotCount = dominateVoidFillerRequiredCount + recessiveVoidFillerRequiredCount;
  const directionControlUsesVsFillers =
    markSuppressLoadSpotsInSchematic &&
    !isSuppressBuildMode(buildMode) &&
    vsFillerSpotCount > 0;
  const showCrubTechControl = isCrubTechBuildMode(effectiveBuildMode);
  const showSuppressDirectionControl =
    !!imageData &&
    imageValid &&
    (
      (!lockFlatBuildMode && isSuppressStepsBuildMode(buildMode)) ||
      directionControlUsesVsFillers
    );
  const activeSuppressDirection = directionControlUsesVsFillers
    ? vsFillerLoadSpotDirection
    : suppressStepDirection;
  const setActiveSuppressDirection = directionControlUsesVsFillers
    ? setVsFillerLoadSpotDirection
    : setSuppressDirection;
  const showLatePairsGapControl =
    effectiveBuildMode === BuildMode.Suppress2LayerLatePairs &&
    twoLayerHasLateVoidNeed;
  const toolbarBuildSettingsProps = displayImageData && imageValid ? {
    lockFlatBuildMode: lockFlatBuildMode || (
      !!imageData &&
      imageValid &&
      parsedTiles.length > 0 &&
      !hasCurrentTileGeometryAnalysis &&
      analysisResult === null
    ),
    visibleWaterLevelControls,
    waterDropControlsDisabled: crubTechControlsActive2LayerSettings,
    setNormalizedWaterDrop,
    minLayerGap,
    layerGap: effectiveLayerGap,
    layerGapDisabled: crubTechControlsActive2LayerSettings,
    setLayerGap,
    showCrubTechControl,
    crubTech,
    setCrubTech: setCrubTechWithPreset,
    showLatePairsGapControl,
    latePairsGap: effectiveSuppress2LayerLatePairsGap,
    maxLatePairsGap: maxSuppress2LayerLatePairsGap,
    latePairsGapDisabled: crubTechControlsLatePairsGap,
    setLatePairsGap: setSuppress2LayerLatePairsGap,
    showMixStepsToggle,
    mixSteps,
    setMixSteps,
    showPaletteSeedToggle,
    proPaletteSeed,
    setProPaletteSeed,
    showBuildAtWorldMinYToggle,
    buildAtWorldMinY,
    setBuildAtWorldMinY,
    buildMode,
    setBuildMode,
    showSuppressDirectionControl,
    suppressDirection: activeSuppressDirection,
    setSuppressDirection: setActiveSuppressDirection,
    isSuppressDirectionSelectable,
    staircaseModeOptions,
    suppressModeOptions,
    shadingMethodTooltip,
  } : null;
  const showWaterSideSupportWarning =
    imageValid &&
    !crubTechControlsActive2LayerSettings &&
    (supportMode === SupportMode.All || supportMode === SupportMode.Water) &&
    usesWaterForWater &&
    getSupportModeRoleCount(FillerRole.SupportWaterSides) > 0 &&
    !supportWaterSidesFillerValid;
  const supportFillerRequiredCount = getRequiredFillerRoleCount(...activeSupportRoles);
  const hasInGridFillerNeed = suppressFillerCount + lateSuppressFillerCount > 0;
  const inGridShadingCountsAsWarning = hasInGridFillerNeed && isSuppressBuildMode(effectiveBuildMode);
  const hasComplexNorthNeed = northRowFillerCount > 0 && (showNooblineWarnings || !aggregateNorthRowSingleLine);
  const showNoFillerWarning =
    !crubTechControlsActive2LayerSettings &&
    imageValid &&
    ((inGridShadingCountsAsWarning && shadeFillerShadingDisabled) || (hasComplexNorthNeed && shadeFillerShadingDisabled));
  const showSupportFillerInput =
    effectiveSupportMode !== SupportMode.None &&
    !crubTechControlsActive2LayerSettings &&
    (!imageData || aggregateSupportFillerRequiredCount > 0 || showWaterSideSupportWarning);
  const showShadeFillerControlFamily = !!imageData && (suppressFillerCount + northRowFillerCount) > 0;
  const showShadeFillerInput = showShadeFillerControlFamily && !crubTechControlsActive2LayerSettings;
  const showCrubTechFillerInputs =
    crubTechControlsActive2LayerSettings &&
    crubTechBreakableFillerRequiredCount + crubTechPushableFillerRequiredCount > 0;
  const showLateFillerInput =
    !!imageData &&
    effectiveBuildMode === BuildMode.Suppress2LayerLateFillers &&
    aggregateLateFillerRequiredCount > 0;
  const shadeFillerIsNorthRowOnly = northRowFillerCount > 0 && suppressFillerCount === 0;
  const showDominateVoidFillerInput =
    !!imageData &&
    aggregateDominateVoidFillerRequiredCount > 0;
  const showRecessiveVoidFillerInput =
    !!imageData &&
    aggregateRecessiveVoidFillerRequiredCount > 0;
  const fillerUiVisibilityPending =
    !!imageData &&
    imageValid &&
    (previewBusy || !hasCurrentMaterialAnalysis);
  const fillerUiVisibilityState = useHeldValueWhilePending(
    useMemo(
      () => ({
        showSupportFillerInput,
        showShadeFillerInput,
        showShadeBreakableFillerInput: showCrubTechFillerInputs,
        showShadePushableFillerInput: showCrubTechFillerInputs,
        showLateFillerInput,
        showDominateVoidFillerInput,
        showRecessiveVoidFillerInput,
      }),
      [
        showSupportFillerInput,
        showShadeFillerInput,
        showCrubTechFillerInputs,
        showLateFillerInput,
        showDominateVoidFillerInput,
        showRecessiveVoidFillerInput,
      ],
    ),
    fillerUiVisibilityPending,
  );
  const previewXColumnRange = useMemo<[number, number] | undefined>(
    () => (selectedTileAnalysis && colRangeEnabled && !isStepRangeMode ? [colStart, colEnd] : undefined),
    [selectedTileAnalysis, colRangeEnabled, isStepRangeMode, colStart, colEnd],
  );
  const previewPhaseRange = useMemo<[number, number] | undefined>(
    () => (selectedTileAnalysis && colRangeEnabled && isStepRangeMode ? [colStart, colEnd] : undefined),
    [selectedTileAnalysis, colRangeEnabled, isStepRangeMode, colStart, colEnd],
  );
  const selectedTilePreviewVsFillerReplacements = useVsFillerPreviewReplacements({
    shape: selectedTileAnalysis?.supportShape ?? null,
    shadeFillerBlock,
    dominateVoidFillerBlock,
    recessiveVoidFillerBlock,
    xColumnRange: previewXColumnRange,
  });
  const selectedTilePreviewVisiblePixelMask = usePreviewVisiblePixelMask({
    shape: previewPhaseRange ? (selectedTileAnalysis?.supportShape ?? null) : null,
    phaseRange: previewPhaseRange,
  });
  const showVsFillersInPreviewToggle =
    vsFillerSpotCount > 0 && (!dominateVoidFillerShadingDisabled || !recessiveVoidFillerShadingDisabled);
  const previewVsFillerReplacements = useMemo(
    () => {
      if (!showVsFillersInPreview || !showVsFillersInPreviewToggle) return [];
      if (selectedTileAnalysis) {
        return offsetPreviewPixelReplacements(selectedTilePreviewVsFillerReplacements, selectedTileAnalysis.tile);
      }
      return tileAnalyses.flatMap(tile =>
        !tile.supportShape
          ? []
          : offsetPreviewPixelReplacements(
              collectVsFillerPreviewReplacements({
                shape: tile.supportShape,
                shadeFillerBlock,
                dominateVoidFillerBlock,
                recessiveVoidFillerBlock,
              }),
              tile.tile,
            ),
      );
    },
    [
      showVsFillersInPreview,
      showVsFillersInPreviewToggle,
      selectedTileAnalysis,
      selectedTilePreviewVsFillerReplacements,
      tileAnalyses,
      shadeFillerBlock,
      dominateVoidFillerBlock,
      recessiveVoidFillerBlock,
    ],
  );
  const previewVisiblePixelMask = useMemo(
    () => {
      if (!displayImageData || !selectedTileAnalysis) return null;
      return buildSelectedTileVisibleMask(
        displayImageData,
        selectedTileAnalysis.tile,
        previewPhaseRange ? selectedTilePreviewVisiblePixelMask : null,
        previewXColumnRange,
      );
    },
    [displayImageData, selectedTileAnalysis, previewPhaseRange, selectedTilePreviewVisiblePixelMask, previewXColumnRange],
  );
  const previewStatusText = useMemo(
    () => {
      if (isParsingImage) {
        if (parseProgress && parseProgress.total > 0) {
          return messages.upload.parsingProgress(parseProgress.completed, parseProgress.total);
        }
        return null;
      }
      if (isAnalyzingTiles) {
        if (!hasMultipleTiles) return null;
        if (analysisProgress && analysisProgress.total > 0) {
          return analysisPhase === "fillerAnalysis"
            ? messages.upload.fillerAnalysisProgress(analysisProgress.completed, analysisProgress.total)
            : messages.upload.analyzingProgress(analysisProgress.completed, analysisProgress.total);
        }
        return analysisPhase === "fillerAnalysis" ? messages.upload.fillerAnalysis : messages.upload.analyzing;
      }
      if (isAnalyzingMaterials) {
        if (!hasMultipleTiles) return messages.upload.materialAnalysis;
        if (materialAnalysisProgress && materialAnalysisProgress.total > 0) {
          return messages.upload.materialAnalysisProgress(
            materialAnalysisProgress.completed,
            materialAnalysisProgress.total,
          );
        }
        return messages.upload.materialAnalysis;
      }
      return null;
    },
    [
      isParsingImage,
      parseProgress,
      isAnalyzingTiles,
      analysisProgress,
      analysisPhase,
      isAnalyzingMaterials,
      materialAnalysisProgress,
      hasMultipleTiles,
    ],
  );
  const previewImageUrl = usePreviewImageUrl({
    enabled: !!displayImageData,
    imageData: displayImageData,
    pixelReplacements: previewVsFillerReplacements,
    visiblePixelMask: previewVisiblePixelMask ?? undefined,
  });
  const showTileSelection = hasMultipleTiles && !!displayImageData && imageValid;
  const generateButtonLabel = useMemo(
    () => {
      if (hasMultipleTiles) {
        return effectiveSelectedTileCount === 1
          ? messages.upload.convertButton(false, false)
          : messages.upload.convertButtonZipCount(effectiveSelectedTileCount);
      }
      return messages.upload.convertButton(
        false,
        !hasMultipleTiles &&
          (buildMode === BuildMode.SuppressSplitRow || buildMode === BuildMode.SuppressSplitChecker),
      );
    },
    [hasMultipleTiles, effectiveSelectedTileCount, buildMode],
  );
  const canCopyImageShareUrl = tileCount === 1 && !!imageColorGrid && imageValid;
  const presetPrimaryActionTitle = presetDirty ? messages.presets.saveTitle : messages.presets.shareTitle;
  const hasValidNorthRowShadeFiller =
    northRowFillerCount > 0 && (crubTechControlsActive2LayerSettings || !shadeFillerShadingDisabled);
  const showNorthRowAlignmentInfo =
	    showAlignmentReminder &&
	    imageValid &&
	    tileGeometryAnalyses.length > 0 &&
	    (effectiveForceZ129 || hasValidNorthRowShadeFiller);
  const noFillerWarning = useMemo(() => {
    if (crubTechControlsActive2LayerSettings) {
      const parts: string[] = [];
      if (aggregateCrubTechBreakableRequiredCount > 0) {
        parts.push(
          crubTechShadeBreakableFillerShadingDisabled
            ? messages.preview.crubTechBreakableInvalid(
              effectiveCrubTechShadeBreakableFillerBlock,
              aggregateCrubTechBreakableRequiredCount,
            )
            : !isCrubTechBreakableValid(effectiveCrubTechShadeBreakableFillerBlock)
              ? messages.preview.crubTechBreakableBehaviorWarning(
                effectiveCrubTechShadeBreakableFillerBlock,
                aggregateCrubTechBreakableRequiredCount,
              )
              : "",
        );
      }
      if (aggregateCrubTechPushableRequiredCount > 0) {
        parts.push(
          crubTechShadePushableFillerShadingDisabled
            ? messages.preview.crubTechPushableInvalid(
              effectiveCrubTechShadePushableFillerBlock,
              aggregateCrubTechPushableRequiredCount,
            )
            : !isCrubTechPushableValid(effectiveCrubTechShadePushableFillerBlock)
              ? messages.preview.crubTechPushableBehaviorWarning(
                effectiveCrubTechShadePushableFillerBlock,
                aggregateCrubTechPushableRequiredCount,
              )
              : "",
        );
      }
      const nonEmptyParts = parts.filter(Boolean);
      return nonEmptyParts.length > 0 ? nonEmptyParts.join("\n\n") : null;
    }
    if (!showNoFillerWarning) return null;
    const parts: string[] = [];
    if (northRowFillerCount > 0 && (showNooblineWarnings || !aggregateNorthRowSingleLine)) {
      parts.push(messages.preview.noFillerNorthRowLine);
    }
    if (hasInGridFillerNeed) {
      const suppressLike = isSuppressBuildMode(effectiveBuildMode) || lateSuppressFillerCount > 0;
      parts.push(
        suppressLike
          ? messages.preview.noFillerSuppressLine
          : messages.preview.noFillerInGridLine,
      );
    }
    if (parts.length === 0) return null;
    return messages.preview.noFillerWarning(effectiveShadeFillerBlock, parts);
  }, [
    aggregateCrubTechBreakableRequiredCount,
    aggregateCrubTechPushableRequiredCount,
    effectiveBuildMode,
    effectiveCrubTechShadeBreakableFillerBlock,
    effectiveCrubTechShadePushableFillerBlock,
    effectiveShadeFillerBlock,
    hasInGridFillerNeed,
    lateSuppressFillerCount,
    northRowFillerCount,
    aggregateNorthRowSingleLine,
    crubTechShadeBreakableFillerShadingDisabled,
    crubTechShadePushableFillerShadingDisabled,
    showNoFillerWarning,
    showNooblineWarnings,
    crubTechControlsActive2LayerSettings,
  ]);
  const waterSideSupportWarning = useMemo<ShapeWarning | null>(() => {
    if (!showWaterSideSupportWarning) return null;
    const value = effectiveSupportFillerBlock;
    return {
      text: messages.preview.waterSideSupportWarning(value, supportFillerDisabled),
      invalid: true,
    };
  }, [showWaterSideSupportWarning, effectiveSupportFillerBlock, supportFillerDisabled]);
  const fragileSupportOverrideWarning = useMemo<ShapeWarning | null>(() => {
    if (!imageValid || !fragileSupportOverrideNeedStatsDisplay || crubTechControlsActive2LayerSettings) return null;
    if (supportMode === SupportMode.None) return null;

    const warningLines: string[] = [];

    for (const [blockId, rule] of FRAGILE_SUPPORT_RULES) {
      if ((fragileSupportOverrideNeedStatsDisplay.overrideCounts[blockId] ?? 0) <= 0) continue;
      warningLines.push(messages.preview.fragileSupportOverrideWarning(blockId, rule.validSupportBlocks));
    }

    return warningLines.length > 0
      ? { text: warningLines.join("\n\n"), invalid: false }
      : null;
  }, [
    fragileSupportOverrideNeedStatsDisplay,
    imageValid,
    crubTechControlsActive2LayerSettings,
    supportMode,
  ]);
  const vsFillerWarning = useMemo<ShapeWarning | null>(() => {
    type VsEntry = {
      label: string;
      value: string;
      invalid: boolean;
      noobPixels: number;
    };
    const makeEntry = (
      show: boolean,
      label: VsEntry["label"],
      value: string,
      noobPixels: number,
    ): VsEntry | null => {
      if (!show) return null;
      return { label, value, invalid: isShadeFillerDisabled(value), noobPixels };
    };
    const formatInvalid = (entry: VsEntry) => messages.preview.vsFillerInvalid(entry.label, entry.value, entry.noobPixels);
    const formatRequired = (label: string, pixels: number, isPluralLabel = false) =>
      messages.preview.vsFillerRequired(label, pixels, isPluralLabel);
    const appendTransparentSwapLine = (text: string) =>
      activeTransparentBlock && suppressedTransparentVsCollisionCount > 0
        ? `${text}\n${messages.preview.vsFillerTransparentSwap(activeTransparentBlock)}`
        : text;

    const dominant = makeEntry(
      showDominateVoidFillerInput,
      messages.fillers.dominateVoidWarningLabel,
      effectiveDominateVoidFillerBlock,
      aggregateDominateVoidFillerRequiredCount,
    );
    const recessive = makeEntry(
      showRecessiveVoidFillerInput,
      messages.fillers.recessiveVoidWarningLabel,
      effectiveRecessiveVoidFillerBlock,
      aggregateRecessiveVoidFillerRequiredCount,
    );

    if (!dominant && !recessive) return null;
    if (!dominant) {
      if (recessive!.invalid) return { text: formatInvalid(recessive!), invalid: true };
      return showVsFillerWarnings
        ? { text: appendTransparentSwapLine(formatRequired(recessive!.label, recessive!.noobPixels)), invalid: false }
        : null;
    }
    if (!recessive) {
      if (dominant.invalid) return { text: formatInvalid(dominant), invalid: true };
      return showVsFillerWarnings
        ? { text: appendTransparentSwapLine(formatRequired(dominant.label, dominant.noobPixels)), invalid: false }
        : null;
    }
    if (dominant.invalid && recessive.invalid) {
      const pixels = dominant.noobPixels + recessive.noobPixels;
      return {
        text: messages.preview.vsFillersInvalid([dominant.value, recessive.value], pixels),
        invalid: true,
      };
    }
    if (dominant.invalid || recessive.invalid) {
      return { text: formatInvalid(dominant.invalid ? dominant : recessive), invalid: true };
    }
    if (!showVsFillerWarnings) return null;
    const pixels = dominant.noobPixels + recessive.noobPixels;
    return { text: appendTransparentSwapLine(formatRequired(messages.fillers.voidFillersWarningLabel, pixels, true)), invalid: false };
  }, [
    activeTransparentBlock,
    effectiveDominateVoidFillerBlock,
    effectiveRecessiveVoidFillerBlock,
    showDominateVoidFillerInput,
    showRecessiveVoidFillerInput,
    showVsFillerWarnings,
    aggregateDominateVoidFillerRequiredCount,
    aggregateRecessiveVoidFillerRequiredCount,
    suppressedTransparentVsCollisionCount,
  ]);
  const lateFillerWarning = useMemo<ShapeWarning | null>(() => {
    if (!showLateFillerInput || aggregateLateFillerRequiredCount <= 0 || !lateFillerShadingDisabled) return null;
    const value = suppress2LayerLateFillerBlock.trim() || effectiveShadeFillerBlock;
    return {
      text: messages.preview.lateFillerInvalid(value, aggregateLateFillerRequiredCount),
      invalid: true,
    };
  }, [
    showLateFillerInput,
    aggregateLateFillerRequiredCount,
    lateFillerShadingDisabled,
    suppress2LayerLateFillerBlock,
    effectiveShadeFillerBlock,
  ]);

  const handleColorTableMinWidthChange = useCallback((nextWidthPx: number) => {
    setColorTableMinWidthPx(prev => (Math.abs(prev - nextWidthPx) > 1 ? nextWidthPx : prev));
  }, []);
  const handleColorTableLayoutChange = useCallback((layout: ColorTableLayout) => {
    setColorTableLayout(current =>
      current.blockWidthPx === layout.blockWidthPx &&
      current.requiredWidthPx === layout.requiredWidthPx &&
      current.blockExpanded === layout.blockExpanded
        ? current
        : layout,
    );
  }, []);

  const measureToolbarMinWidths = useCallback(() => {
    const presetEl = presetToolbarSectionRef.current;
    const fillerEl = fillerToolbarSectionRef.current;
    const measureNoWrapSectionWidth = (el: HTMLElement): number => {
      const { width, minWidth, maxWidth, flexWrap } = el.style;
      el.style.width = "max-content";
      el.style.minWidth = "max-content";
      el.style.maxWidth = "none";
      el.style.flexWrap = "nowrap";
      const measured = Math.ceil(el.getBoundingClientRect().width);
      el.style.width = width;
      el.style.minWidth = minWidth;
      el.style.maxWidth = maxWidth;
      el.style.flexWrap = flexWrap;
      return measured;
    };
    const presetMeasured = presetEl ? measureNoWrapSectionWidth(presetEl) : 0;
    const fillerMeasured = fillerEl ? measureNoWrapSectionWidth(fillerEl) : 0;
    setPresetToolbarMinWidthPx(prev => (Math.abs(prev - presetMeasured) > 1 ? presetMeasured : prev));
    setFillerToolbarMinWidthPx(prev => (Math.abs(prev - fillerMeasured) > 1 ? fillerMeasured : prev));
  }, []);

  const recalcCreditsFloatGap = useCallback(() => {
    // Keep simple flow order for stacked/mobile layouts.
    if (isStackedLayout) {
      if (creditsFloatGapRef.current !== 0) {
        creditsFloatGapRef.current = 0;
        setCreditsFloatGapPx(0);
      }
      return;
    }
    const leftCol = leftColumnRef.current;
    const creditsEl = creditsRef.current;
    if (!leftCol || !creditsEl) return;

    const currentGap = creditsFloatGapRef.current;
    const leftBottom = leftCol.getBoundingClientRect().bottom;
    const creditsRect = creditsEl.getBoundingClientRect();
    const viewportBottom = window.innerHeight;
    const targetBottomRaw = Math.min(viewportBottom - PAGE_CONTENT_PADDING_PX, leftBottom);
    // Keep credits visible on-screen even after scrolling past the left-column bottom.
    const targetBottom = Math.max(creditsRect.height, targetBottomRaw);
    const naturalTop = creditsRect.top - currentGap;
    const desiredTop = targetBottom - creditsRect.height;
    const nextGap = Math.max(0, Math.round(desiredTop - naturalTop));
    if (Math.abs(nextGap - currentGap) > 1) {
      creditsFloatGapRef.current = nextGap;
      setCreditsFloatGapPx(nextGap);
    }
  }, [isStackedLayout]);

  useLayoutEffect(() => {
    measureToolbarMinWidths();
    let rafId = 0;
    const scheduleMeasure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measureToolbarMinWidths);
    };

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
    if (presetToolbarSectionRef.current) ro?.observe(presetToolbarSectionRef.current);
    if (fillerToolbarSectionRef.current) ro?.observe(fillerToolbarSectionRef.current);
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      ro?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [measureToolbarMinWidths, isStackedLayout]);

  useLayoutEffect(() => {
    recalcCreditsFloatGap();
    let rafId = 0;
    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(recalcCreditsFloatGap);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (layoutRootRef.current) ro?.observe(layoutRootRef.current);
    if (leftColumnRef.current) ro?.observe(leftColumnRef.current);
    if (creditsRef.current) ro?.observe(creditsRef.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      ro?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [recalcCreditsFloatGap]);

  // Some image-driven layout updates do not always trigger a reliable resize event chain.
  // Nudge a follow-up recalc after key state transitions so credits updates stay immediate.
  useLayoutEffect(() => {
    let r1 = 0, r2 = 0;
    r1 = requestAnimationFrame(() => {
      recalcCreditsFloatGap();
      r2 = requestAnimationFrame(recalcCreditsFloatGap);
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [
    recalcCreditsFloatGap,
    imageData,
    imageValid,
    paletteNotices.length,
    missingBlockCount,
    showNoFillerWarning,
    showNorthRowAlignmentInfo,
    colRangeEnabled,
    colStart,
    colEnd,
    colorTableMinWidthPx,
    buildMode,
  ]);

  const leftColumnMinWidthPx = useMemo(
    () => Math.max(colorTableMinWidthPx, presetToolbarMinWidthPx, fillerToolbarMinWidthPx),
    [colorTableMinWidthPx, presetToolbarMinWidthPx, fillerToolbarMinWidthPx],
  );

  useLayoutEffect(() => {
    const measure = () => {
      const root = layoutRootRef.current;
      if (!root) return;
      const rootStyle = getComputedStyle(root);
      const paddingInline =
        parseFloat(rootStyle.paddingLeft || "0") +
        parseFloat(rootStyle.paddingRight || "0");
      const availableWidth = root.clientWidth - paddingInline;
      const gap = parseFloat(rootStyle.columnGap || rootStyle.gap || "0") || LAYOUT_GAP_PX;
      const threshold = Math.ceil(leftColumnMinWidthPx + PREVIEW_PAGE_COLUMN_MIN_WIDTH_PX + gap);
      const stackCalc = availableWidth <= threshold;
      if (stackCalc !== isStackedLayout) setIsStackedLayout(stackCalc);
    };

    measure();
    let rafId = 0;
    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (layoutRootRef.current) ro?.observe(layoutRootRef.current);
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [
    leftColumnMinWidthPx,
    isStackedLayout,
    colorTableMinWidthPx,
    presetToolbarMinWidthPx,
    fillerToolbarMinWidthPx,
    imageData,
    buildMode,
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-2 py-1.5 flex items-center justify-between bg-[hsl(var(--header-bg))]">
        <h1 className="text-base font-bold text-primary">
          <button
            type="button"
            className="hover:underline decoration-dotted underline-offset-2"
            onClick={() => setShowSecretsDialog(true)}
            title={messages.common.openSecretsSettings}
          >
            {messages.app.title}
          </button>
        </h1>
        <div className="flex items-center gap-1">
          <label
            className="relative flex h-7 w-14 items-center justify-start gap-1 rounded-md bg-secondary px-1.5 text-secondary-foreground hover:bg-muted focus-within:ring-1 focus-within:ring-ring transition-colors"
            title={messages.common.languageAriaLabel}
          >
            <Languages className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="text-xs tabular-nums">{localePreferenceDisplay}</span>
            <select
              value={localePreference}
              onChange={handleLocalePreferenceChange}
              aria-label={messages.common.languageAriaLabel}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              <option value={LOCALE_BROWSER}>↻ {messages.common.languageBrowserOption}</option>
              {SUPPORTED_LOCALES.map(locale => (
                <option key={locale} value={locale}>
                  {getLocaleLabel(locale)}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={toggleTheme}
            className="h-7 w-7 rounded-md bg-secondary text-secondary-foreground hover:bg-muted transition-colors grid place-items-center"
            aria-label={messages.common.toggleThemeAriaLabel}
            title={messages.common.toggleThemeAriaLabel}
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      <div
        ref={layoutRootRef}
        className={`flex gap-2 p-2 w-full ${
          isStackedLayout ? "flex-col" : "flex-row flex-wrap items-start"
        }`}
      >
        {/* LEFT COLUMN */}
        <div
          ref={leftColumnRef}
          className={isStackedLayout ? "contents" : "block flex-[3_1_0%] min-w-[var(--left-column-min-width)]"}
          style={{
            ["--color-table-min-width" as any]: `${colorTableMinWidthPx}px`,
            ["--left-column-min-width" as any]: `${leftColumnMinWidthPx}px`,
          }}
        >
          <div className={`${isStackedLayout ? "order-1" : ""} space-y-2`}>
          {/* Preset Manager */}
          <ToolbarPresetSettings
            toolbarRef={presetToolbarSectionRef}
            isStackedLayout={isStackedLayout}
            presets={presets}
            builtInPresetCount={BUILTIN_PRESET_NAMES.length}
            showCrubTechPreset={crubTechControlsActive2LayerSettings}
            activeIdx={activeIdx}
            selectPreset={selectPreset}
            activePresetBuiltinTooltip={activePresetBuiltinTooltip}
            presetDirty={presetDirty}
            isBuiltinUnedited={isBuiltinUnedited}
            sharePreset={sharePreset}
            presetPrimaryActionTitle={presetPrimaryActionTitle}
            deletePreset={deletePreset}
            createPreset={createPreset}
            showSupportModeSelector={showSupportModeSelector}
            supportMode={effectiveSupportMode}
            setSupportMode={setSupportMode}
            supportModeTooltip={supportModeTooltip}
            enableAllSupportOption={enableAllSupportOption}
            enableStepsSupportOption={enableStepsSupportOption}
            enableWaterSupportOption={enableWaterSupportOption}
            enableFragileSupportOption={enableFragileSupportOption}
            supportFillerIsFragile={supportFillerIsFragile}
            buildSettingsProps={toolbarBuildSettingsProps}
          />

          {/* Filler Block + Support + Shading Method */}
          <ToolbarFillerSettings
            toolbarRef={fillerToolbarSectionRef}
            isStackedLayout={isStackedLayout}
            hasImageData={!!displayImageData}
            crubTechIncludesSupport={effectiveSupportMode !== SupportMode.None}
            showSupportFillerInput={fillerUiVisibilityState.showSupportFillerInput}
            supportFillerBlock={supportFillerBlock}
            setSupportFillerBlock={setCommittedSupportFillerBlock}
            commitSupportFillerBlock={commitSupportFillerBlock}
            supportFillerDisabled={supportFillerDisabled}
            supportFillerRequiredCount={supportFillerRequiredCount}
            showShadeFillerInput={fillerUiVisibilityState.showShadeFillerInput}
            shadeFillerBlock={shadeFillerBlock}
            setShadeFillerBlock={setCommittedShadeFillerBlock}
            shadeFillerIsNorthRowOnly={shadeFillerIsNorthRowOnly}
            shadeFillerShadingDisabled={shadeFillerShadingDisabled}
            shadeFillerRequiredCount={shadeFillerRequiredCount}
            showShadeBreakableFillerInput={fillerUiVisibilityState.showShadeBreakableFillerInput}
            shadeBreakableFillerBlock={crubTechShadeBreakableFillerBlock}
            setShadeBreakableFillerBlock={setCommittedCrubTechShadeBreakableFillerBlock}
            shadeBreakableFillerShadingDisabled={crubTechShadeBreakableFillerShadingDisabled}
            shadeBreakableFillerRequiredCount={crubTechBreakableFillerRequiredCount}
            showShadePushableFillerInput={fillerUiVisibilityState.showShadePushableFillerInput}
            shadePushableFillerBlock={crubTechShadePushableFillerBlock}
            setShadePushableFillerBlock={setCommittedCrubTechShadePushableFillerBlock}
            shadePushableFillerShadingDisabled={crubTechShadePushableFillerShadingDisabled}
            shadePushableFillerRequiredCount={crubTechPushableFillerRequiredCount}
            showLateFillerInput={fillerUiVisibilityState.showLateFillerInput}
            suppress2LayerLateFillerBlock={suppress2LayerLateFillerBlock}
            setSuppress2LayerLateFillerBlock={setCommittedSuppress2LayerLateFillerBlock}
            lateFillerShadingDisabled={lateFillerShadingDisabled}
            lateFillerRequiredCount={lateFillerRequiredCount}
            showDominateVoidFillerInput={fillerUiVisibilityState.showDominateVoidFillerInput}
            dominateVoidFillerBlock={dominateVoidFillerBlock}
            setDominateVoidFillerBlock={setCommittedDominateVoidFillerBlock}
            dominateVoidFillerShadingDisabled={dominateVoidFillerShadingDisabled}
            dominateVoidFillerRequiredCount={dominateVoidFillerRequiredCount}
            showRecessiveVoidFillerInput={fillerUiVisibilityState.showRecessiveVoidFillerInput}
            recessiveVoidFillerBlock={recessiveVoidFillerBlock}
            setRecessiveVoidFillerBlock={setCommittedRecessiveVoidFillerBlock}
            recessiveVoidFillerShadingDisabled={recessiveVoidFillerShadingDisabled}
            recessiveVoidFillerRequiredCount={recessiveVoidFillerRequiredCount}
            formatRequiredCount={formatRequiredCount}
          />
          </div>

          <div className={`${isStackedLayout ? "order-3" : "mt-2"} space-y-2`}>
          {/* Color → Block */}
          <PanelColorBlockTable
            isStackedLayout={isStackedLayout}
            imageValid={colorTableDisplayState.imageValid}
            belowPlatformWater={effectiveBelowPlatformWater}
            hasRequiredCol={colorTableDisplayState.hasRequiredCol}
            showUsageInfo={colorTableDisplayState.showUsageInfo}
            showIds={showIds}
            setShowIds={setShowIds}
            showNames={showNames}
            setShowNames={setShowNames}
            showOptions={showOptions}
            setShowOptions={setShowOptions}
            showStacks={showStacks}
            setShowStacks={setShowStacks}
            showMaxPerSplit={showMaxPerSplit}
            setShowMaxPerSplit={setShowMaxPerSplit}
            showMaxPerSplitOption={showMaxPerSplitOption}
            blockDisplayMode={blockDisplayMode}
            setBlockDisplayMode={setBlockDisplayMode}
            blockColExpanded={blockColExpanded}
            setBlockColExpanded={setBlockColExpanded}
            sortKey={sortKey}
            setSortKey={setSortKey}
            sortDir={sortDir}
            setSortDir={setSortDir}
            showUnusedColors={showUnusedColors}
            setShowUnusedColors={setShowUnusedColors}
            showTransparentRow={effectiveShowTransparentRow}
            showExcludedBlocks={showExcludedBlocks}
            columnOrder={columnOrder}
            setColumnOrder={setColumnOrder}
            selectedBlocks={preset.selectedBlocks}
            customBlocksByBase={customBlocksByBase}
            usedShadesByColorKey={colorTableDisplayState.usedShadesByColorKey}
            shadeCountsByColorKey={colorTableDisplayState.shadeCountsByColorKey}
            sortColorCounts={colorTableDisplayState.sortColorCounts}
            displayColorCounts={materialCountsDisplayView.colorCounts}
            formatRequiredCount={formatRequiredCount}
            missingColorKeys={colorTableDisplayState.missingColorKeys}
            onUpdateBlock={updateBlock}
            onCopyColorToClipboard={copyColorToClipboard}
            onLayoutChange={handleColorTableLayoutChange}
            onMinWidthChange={handleColorTableMinWidthChange}
          />

          <PanelCustomColors
            isStackedLayout={isStackedLayout}
            customColors={customColors}
            selectedBlocksCustom={selectedBlocksCustom}
            selectedBlocks={preset.selectedBlocks}
            columnOrder={columnOrder}
            blockColumnWidthPx={colorTableLayout.blockWidthPx}
            requiredColumnWidthPx={colorTableLayout.requiredWidthPx}
            blockColumnExpanded={colorTableLayout.blockExpanded}
            blockDisplayMode={blockDisplayMode}
            sortKey={sortKey}
            sortDir={sortDir}
            customMode={customMode}
            setCustomMode={setCustomMode}
            newCustom={newCustom}
            onCustomChannelChange={handleCustomChannelChange}
            onCustomBlockChange={handleCustomBlockChange}
            onCustomBlockCommit={commitCustomBlockDraft}
            addCustomColor={addCustomColor}
            onUpdateBlock={updateBlock}
            onSelectCustomBlock={handleSelectCustomBlock}
            onRemoveCustomBlock={handleRemoveCustomBlock}
            onCopyColorToClipboard={copyColorToClipboard}
            sortColorCounts={colorTableDisplayState.sortColorCounts}
            displayColorCounts={materialCountsDisplayView.colorCounts}
            formatRequiredCount={formatRequiredCount}
            usedShadesByColorKey={colorTableDisplayState.usedShadesByColorKey}
            shadeCountsByColorKey={colorTableDisplayState.shadeCountsByColorKey}
            missingColorKeys={colorTableDisplayState.missingColorKeys}
            imageValid={colorTableDisplayState.imageValid}
            hasRequiredCol={colorTableDisplayState.hasRequiredCol}
            showIds={showIds}
            showNames={showNames}
            showOptions={showOptions}
          />
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div
          className={
            isStackedLayout
              ? "contents"
              : "flex-[1_1_0%] flex flex-col"
          }
          style={isStackedLayout ? undefined : { minWidth: PREVIEW_PAGE_COLUMN_MIN_WIDTH_PX, maxWidth: PREVIEW_PAGE_COLUMN_MAX_WIDTH_CSS }}
        >
          <div className={isStackedLayout ? "order-2" : ""}>
            <PanelImagePreview
              fileRef={fileRef}
              imageData={displayImageData}
              previewImageUrl={previewImageUrl}
              fallbackPreviewImageUrl={hasBlockingSizeError ? null : uploadedPreviewUrl}
              imageName={hasRejectedUploadedImage ? "" : imageName}
              handleFile={handleFile}
              canCopyImageShareUrl={canCopyImageShareUrl}
              copyImageShareUrl={copyImageShareUrl}
              showVsFillersInPreviewToggle={showVsFillersInPreviewToggle}
              showVsFillersInPreview={showVsFillersInPreview}
              setShowVsFillersInPreview={setShowVsFillersInPreview}
              paletteNotices={paletteNotices}
              imageValid={imageValid}
              missingBlockCount={missingBlockCount}
              noFillerWarning={noFillerWarning}
              suppressStepNorthSouthWarning={suppressStepNorthSouthWarning}
              waterSideSupportWarning={waterSideSupportWarning}
              fragileSupportOverrideWarning={fragileSupportOverrideWarning}
              vsFillerWarning={vsFillerWarning}
              lateFillerWarning={lateFillerWarning}
              showNorthRowAlignmentInfo={showNorthRowAlignmentInfo}
              canGenerate={canGenerate}
              imageHasWater={imageHasWater}
              usesIceForWater={usesIceForWater}
              clearImage={clearImage}
              handleConvertAndDownload={handleConvertAndDownload}
              converting={converting}
              generateButtonLabel={generateButtonLabel}
              busy={previewBusy}
              busyText={previewStatusText}
              showUsageInfo={!!paletteUsageInfo && imageValid}
              numUniqueColorShadesForPart={numUniqueColorShadesForPart}
              numColorBlockTypesForPart={numColorBlockTypesForPart}
              vsFillerSpotCount={vsFillerSpotCount}
              showRangeControls={showPreviewRangeControls}
              showWestEastSlopeControls={showWestEastSlopeControls}
              westEastSlopeEnabled={westEastSlopeEnabled}
              setWestEastSlopeEnabled={setWestEastSlopeEnabled}
              westEastSlopeRun={westEastSlopeRun}
              setWestEastSlopeRun={setWestEastSlopeRun}
              westEastSlopeRise={westEastSlopeRise}
              setWestEastSlopeRise={setWestEastSlopeRise}
              showTileSelection={showTileSelection}
              tileRows={tileRows}
              tileCols={tileCols}
              selectedTileIndices={selectedTileIndexSet}
              onTileSelection={handleTileSelection}
              colRangeEnabled={colRangeEnabled}
              setColRangeEnabled={setColRangeEnabled}
              isStepRangeMode={isStepRangeMode}
              colStart={colStart}
              colEnd={colEnd}
              maxRangeIndex={maxRangeIndex}
              colStartRef={colStartRef}
              colEndRef={colEndRef}
              setColStart={setColStart}
              setColEnd={setColEnd}
            />
          </div>

          <PanelCredits
            creditsRef={creditsRef}
            isStackedLayout={isStackedLayout}
            creditsFloatGapPx={creditsFloatGapPx}
          />
        </div>
      </div>
      <SecretsSettingsDialog
        open={showSecretsDialog}
        onClose={() => setShowSecretsDialog(false)}
        showTransparentRow={effectiveShowTransparentRow}
        setShowTransparentRow={setShowTransparentRow}
        showTransparentRowDisabled={crubTechControlsActive2LayerSettings}
        showExcludedBlocks={showExcludedBlocks}
        setShowExcludedBlocks={setShowExcludedBlocks}
        collapseDuplicateNbtPaletteStates={collapseDuplicateNbtPaletteStates}
        setCollapseDuplicateNbtPaletteStates={setCollapseDuplicateNbtPaletteStates}
        forceXZ128={effectiveForceXZ128}
        setForceXZ128={setForceXZ128}
        forceXZ128Disabled={crubTechControlsActive2LayerSettings}
        forceZ129={effectiveForceZ129}
        setForceZ129={setForceZ129}
        forceZ129Disabled={crubTechControlsActive2LayerSettings}
        applySupportFloorYs={effectiveApplySupportFloorYs}
        setApplySupportFloorYs={setApplySupportFloorYs}
        applySupportFloorYsDisabled={crubTechControlsActive2LayerSettings}
        belowPlatformWater={effectiveBelowPlatformWater}
        setBelowPlatformWater={setBelowPlatformWater}
        belowPlatformWaterDisabled={crubTechControlsActive2LayerSettings}
        skipEmptySuppressSteps={skipEmptySuppressSteps}
        setSkipEmptySuppressSteps={setSkipEmptySuppressSteps}
        showFlatNbtSuppressStepModes={showFlatNbtSuppressStepModes}
        setShowFlatNbtSuppressStepModes={setShowFlatNbtSuppressStepModes}
        markSuppressLoadSpotsInSchematic={markSuppressLoadSpotsInSchematic}
        setMarkSuppressLoadSpotsInSchematic={setMarkSuppressLoadSpotsInSchematic}
        suppressLoadSpotMarkerBlock={suppressLoadSpotMarkerBlock}
        setSuppressLoadSpotMarkerBlock={setSuppressLoadSpotMarkerBlock}
        showVsFillerWarnings={showVsFillerWarnings}
        setShowVsFillerWarnings={setShowVsFillerWarnings}
        showAlignmentReminder={showAlignmentReminder}
        setShowAlignmentReminder={setShowAlignmentReminder}
        showNooblineWarnings={showNooblineWarnings}
        setShowNooblineWarnings={setShowNooblineWarnings}
      />
    </div>
  );
};

// Callers:
// - src/main.tsx
export default Index;
