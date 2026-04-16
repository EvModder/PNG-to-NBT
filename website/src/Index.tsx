import { startTransition, useState, useEffect, useCallback, useRef, useMemo, useDeferredValue, useLayoutEffect } from "react";
import { Moon, Sun } from "lucide-react";
import {
  DEFAULT_SWITCH_TO_SUPPRESS_CHECKER_IF_CONTAINS_VOID_SHADOWS,
  DEFAULT_ACTIVE_PRESET_NAME,
  DEFAULT_APPLY_SUPPORT_FLOOR_YS,
  DEFAULT_BELOW_PLATFORM_WATER,
  DEFAULT_BLOCK_COLUMN_EXPANDED,
  DEFAULT_BLOCK_DISPLAY_MODE,
  DEFAULT_BUILD_MODE,
  DEFAULT_BUILD_AT_WORLD_MIN_Y,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_CONVERT_UNSUPPORTED_COLORS,
  DEFAULT_CROP_IMAGE,
  DEFAULT_DARK_WATER_DROP,
  DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK,
  DEFAULT_FLAT_WATER_DROP,
  DEFAULT_FORCE_Z129,
  DEFAULT_LAYER_GAP,
  DEFAULT_LIGHT_WATER_DROP,
  DEFAULT_MARK_SUPPRESS_LOAD_SPOTS_IN_SCHEMATIC,
  DEFAULT_MAX_PER_SPLIT,
  DEFAULT_MIX_STEPS,
  DEFAULT_PALETTE_SEED,
  DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK,
  DEFAULT_SHADE_FILLER_BLOCK,
  DEFAULT_SKIP_EMPTY_SUPPRESS_STEPS,
  DEFAULT_SHOW_ALIGNMENT_REMINDER,
  DEFAULT_SHOW_EXCLUDED_BLOCKS,
  DEFAULT_SHOW_IDS,
  DEFAULT_SHOW_NAMES,
  DEFAULT_SHOW_NOOBLINE_WARNINGS,
  DEFAULT_SHOW_OPTIONS,
  DEFAULT_MC_UNITS,
  DEFAULT_SHOW_TRANSPARENT_ROW,
  DEFAULT_SHOW_VS_FILLERS_IN_PREVIEW,
  DEFAULT_SHOW_VS_FILLER_WARNINGS,
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  DEFAULT_SUPPORT_FILLER_BLOCK,
  DEFAULT_SUPPORT_MODE,
  DEFAULT_SUPPRESS_STEP_DIRECTION,
  DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK,
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
import { computeColorGridStats, FlatModeBehavior, hasStepMixOpportunity, type ColorGridStats } from "@/lib/colorGridAnalysis";
import { decodeColorGrid, encodeColorGrid } from "@/lib/codecColorGrid";
import { createImageDataFromColorGrid, MAP_SIZE } from "@/utils/color";
import type { ColorGrid, ColorRgb } from "@/types/color";
import {
  analyzeFragileSupportOverrideNeeds,
  analyzeMaterialNeeds,
} from "@/lib/shapeAnalysis";
import { getCachedShapeFillerNeeds, getCachedShapeNooblineIsSingleY } from "@/lib/shapeAnalysisCache";
import { sanitizeUserBlockEntry, normalizeBlockId } from "@/lib/blockId";
import {
  createFillerAssignments,
  getSupportModeFillerRoles,
  isFillerDisabled,
  isShadeFillerDisabled,
  isWaterSideSupportFillerValid,
} from "@/lib/fillerRules";
import { messages, PaletteNoticeKind, type PaletteNotice } from "@/lib/messages";
import { decodeFullPreset, encodeFullPreset } from "@/lib/codecPreset";
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
import {
  getBuildModeDownloadSuffix,
  isSuppressStepsBuildMode,
  buildModeUsesPaletteSeed,
  cycleSuppressStepDirection,
  getBuildModeRangeMax,
  isSuppressStepDirection,
  isStaircaseBuildMode,
  isSuppressBuildMode,
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
  findMatchingBuiltinPresetName,
  getBuiltinPreset,
  isAutoCustomPresetName,
  loadPresets,
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

const WATER_DROP_INPUT_ORDER = [Shade.Light, Shade.Flat, Shade.Dark] as const;
type WaterDropShade = typeof WATER_DROP_INPUT_ORDER[number];
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
  usedBaseColors: Set<number>;
  usedShadesByBase: Map<number, Set<Shade>>;
  usedWaterShades: Set<Shade>;
};
type MaterialCountsLike = Pick<
  ReturnType<typeof analyzeMaterialNeeds>,
  "blockCounts" | "baseColorCounts" | "usedShadesByBase" | "fillerRoleCounts"
>;
type TileBaseAnalysis = {
  tile: ParsedColorGridTile;
  derivedImageStats: DerivedImageStats;
  hasWater: boolean;
  includeTransparentBlocks: boolean;
  waterSetting: TileWaterSetting;
  baseShapeMap: Partial<Record<BuildMode, GeneratedShape>>;
  flatModeBehavior: FlatModeBehavior;
  isFlatShape: boolean;
  buildAtWorldMinYEligible: boolean;
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

const EMPTY_USED_SHADES_BY_BASE = new Map<number, Set<Shade>>();
const EMPTY_USED_BASE_COLORS = new Set<number>();
const EMPTY_USED_WATER_SHADES = new Set<Shade>();
const EMPTY_FILLER_ROLE_COUNTS = new Map<FillerRole, number>();

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

function deriveImageStats(imageStats: ColorGridStats): DerivedImageStats {
  const usedShadesByBase = new Map<number, Set<Shade>>();
  const usedBaseColors = new Set<number>();
  let hasTransparency = false;
  let uniqueShadeCount = 0;
  let uniqueBaseColorCount = 0;

  for (const [colorKey, shadeFrequencyMap] of imageStats.colorFrequencyMap) {
    if (colorKey.isCustom) {
      uniqueShadeCount += shadeFrequencyMap.size;
      continue;
    }

    if (colorKey.id === TRANSPARENCY_BASE_INDEX) {
      if ((shadeFrequencyMap.get(Shade.Dark) ?? 0) > 0) {
        hasTransparency = true;
        usedBaseColors.add(TRANSPARENCY_BASE_INDEX);
      }
      continue;
    }

    usedBaseColors.add(colorKey.id);
    ++uniqueBaseColorCount;

    const shades = new Set<Shade>(shadeFrequencyMap.keys());
    uniqueShadeCount += shades.size;
    usedShadesByBase.set(colorKey.id, shades);
  }

  const usedWaterShades = usedShadesByBase.get(WATER_BASE_INDEX) ?? new Set<Shade>();

  return {
    hasTransparency,
    allSameShade: imageStats.allSameShade,
    flatModeBehavior: imageStats.flatModeBehavior,
    paletteUsageInfo: { uniqueShadeCount, uniqueBaseColorCount },
    usedBaseColors,
    usedShadesByBase,
    usedWaterShades,
  };
}

function aggregateDerivedImageStats(tileImageStats: readonly ColorGridStats[]): DerivedImageStats {
  const usedBaseColors = new Set<number>();
  const usedShadesByBase = new Map<number, Set<Shade>>();
  const uniqueShadeKeys = new Set<string>();
  const uniqueBaseColorIds = new Set<number>();
  let hasTransparency = false;

  for (const imageStats of tileImageStats) {
    for (const [colorKey, shadeFrequencyMap] of imageStats.colorFrequencyMap) {
      if (colorKey.isCustom) {
        for (const shade of shadeFrequencyMap.keys()) uniqueShadeKeys.add(`c:${colorKey.id}:${shade}`);
        continue;
      }

      if (colorKey.id === TRANSPARENCY_BASE_INDEX) {
        if ((shadeFrequencyMap.get(Shade.Dark) ?? 0) > 0) {
          hasTransparency = true;
          usedBaseColors.add(TRANSPARENCY_BASE_INDEX);
        }
        continue;
      }

      usedBaseColors.add(colorKey.id);
      uniqueBaseColorIds.add(colorKey.id);
      let shades = usedShadesByBase.get(colorKey.id);
      if (!shades) {
        shades = new Set<Shade>();
        usedShadesByBase.set(colorKey.id, shades);
      }
      for (const shade of shadeFrequencyMap.keys()) {
        shades.add(shade);
        uniqueShadeKeys.add(`b:${colorKey.id}:${shade}`);
      }
    }
  }

  return {
    allSameShade: undefined,
    flatModeBehavior: FlatModeBehavior.None,
    hasTransparency,
    paletteUsageInfo: {
      uniqueShadeCount: uniqueShadeKeys.size,
      uniqueBaseColorCount: uniqueBaseColorIds.size,
    },
    usedBaseColors,
    usedShadesByBase,
    usedWaterShades: usedShadesByBase.get(WATER_BASE_INDEX) ?? new Set<Shade>(),
  };
}

function mergeUsedShadesByBase(
  target: Map<number, Set<Shade>>,
  source: ReadonlyMap<number, ReadonlySet<Shade>>,
): void {
  for (const [baseIndex, shades] of source) {
    let targetShades = target.get(baseIndex);
    if (!targetShades) {
      targetShades = new Set<Shade>();
      target.set(baseIndex, targetShades);
    }
    for (const shade of shades) targetShades.add(shade);
  }
}

function aggregateMaterialCounts(
  stats: readonly MaterialCountsLike[],
  mode: "sum" | "max",
): MaterialCountsLike {
  const blockCounts: Record<string, number> = {};
  const baseColorCounts: Record<number, number> = {};
  const usedShadesByBase = new Map<number, Set<Shade>>();
  const fillerRoleCounts = new Map<FillerRole, number>();

  for (const stat of stats) {
    for (const [blockName, count] of Object.entries(stat.blockCounts)) {
      blockCounts[blockName] = mode === "sum"
        ? (blockCounts[blockName] || 0) + count
        : Math.max(blockCounts[blockName] || 0, count);
    }
    for (const [baseIndexRaw, count] of Object.entries(stat.baseColorCounts)) {
      const baseIndex = Number(baseIndexRaw);
      baseColorCounts[baseIndex] = mode === "sum"
        ? (baseColorCounts[baseIndex] || 0) + count
        : Math.max(baseColorCounts[baseIndex] || 0, count);
    }
    mergeUsedShadesByBase(usedShadesByBase, stat.usedShadesByBase);
    for (const [role, count] of stat.fillerRoleCounts) {
      fillerRoleCounts.set(role, mode === "sum"
        ? (fillerRoleCounts.get(role) ?? 0) + count
        : Math.max(fillerRoleCounts.get(role) ?? 0, count),
      );
    }
  }

  return { blockCounts, baseColorCounts, usedShadesByBase, fillerRoleCounts };
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

function getTileCountForDimensions(width: number, height: number): number {
  if (width % MAP_SIZE !== 0 || height % MAP_SIZE !== 0) return 0;
  return (width / MAP_SIZE) * (height / MAP_SIZE);
}

function getPreprocessedTileCount(imageData: ImageData | null): number {
  if (!imageData) return 0;
  return getTileCountForDimensions(
    imageData.width - (imageData.width % MAP_SIZE),
    imageData.height - (imageData.height % MAP_SIZE),
  );
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
  const [supportFillerBlock, setSupportFillerBlock] = useState(() =>
    sanitizeUserBlockEntry(loadCached(LS_KEYS.supportFiller, DEFAULT_SUPPORT_FILLER_BLOCK)),
  );
  const [shadeFillerBlock, setShadeFillerBlock] = useState(() =>
    sanitizeUserBlockEntry(loadCached(LS_KEYS.shadeFiller, DEFAULT_SHADE_FILLER_BLOCK)),
  );
  const [suppress2LayerLateFillerBlock, setSuppress2LayerLateFillerBlock] = useState(() =>
    sanitizeUserBlockEntry(loadCached(LS_KEYS.suppress2LayerLateFiller, DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK)),
  );
  const [dominateVoidFillerBlock, setDominateVoidFillerBlock] = useState(() =>
    sanitizeUserBlockEntry(loadCached(LS_KEYS.dominateVoidFiller, DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK)),
  );
  const [recessiveVoidFillerBlock, setRecessiveVoidFillerBlock] = useState(() =>
    sanitizeUserBlockEntry(loadCached(LS_KEYS.recessiveVoidFiller, DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK)),
  );
  const [buildMode, setBuildMode] = useState<BuildMode>(() => {
    const storedBuildMode = loadCached(LS_KEYS.buildMode, DEFAULT_BUILD_MODE);
    return Object.values(BuildMode).includes(storedBuildMode as BuildMode) ? storedBuildMode : DEFAULT_BUILD_MODE;
  });
  const [proPaletteSeed, setProPaletteSeed] = useState(() => loadCached(LS_KEYS.paletteSeed, DEFAULT_PALETTE_SEED));
  const calcProPaletteSeed = useDeferredValue(proPaletteSeed);
  const [layerGap, setLayerGap] = useState(() => loadCached(LS_KEYS.layerGap, DEFAULT_LAYER_GAP));
  const calcLayerGap = useDeferredValue(layerGap);
  const [mixSteps, setMixSteps] = useState(() => loadCached(LS_KEYS.mixSteps, DEFAULT_MIX_STEPS));
  const calcMixSteps = useDeferredValue(mixSteps);
  const [buildAtWorldMinY, setBuildAtWorldMinY] = useState(() => loadCached(LS_KEYS.buildAtWorldMinY, DEFAULT_BUILD_AT_WORLD_MIN_Y));
  const [suppressStepDirection, setSuppressStepDirection] = useState<SuppressStepDirection>(() => {
    const storedDirection = loadCached(LS_KEYS.suppressStepDirection, DEFAULT_SUPPRESS_STEP_DIRECTION);
    return isSuppressStepDirection(storedDirection) ? storedDirection : DEFAULT_SUPPRESS_STEP_DIRECTION;
  });
  const [lightWaterDrop, setLightWaterDrop] = useState(() => loadCached(LS_KEYS.lightWaterDrop, DEFAULT_LIGHT_WATER_DROP));
  const calcLightWaterDrop = useDeferredValue(lightWaterDrop);
  const [flatWaterDrop, setFlatWaterDrop] = useState(() => loadCached(LS_KEYS.flatWaterDrop, DEFAULT_FLAT_WATER_DROP));
  const calcFlatWaterDrop = useDeferredValue(flatWaterDrop);
  const [darkWaterDrop, setDarkWaterDrop] = useState(() => loadCached(LS_KEYS.darkWaterDrop, DEFAULT_DARK_WATER_DROP));
  const calcDarkWaterDrop = useDeferredValue(darkWaterDrop);
  const [colRangeEnabled, setColRangeEnabled] = useState(false);
  const [colStart, setColStart] = useState(0);
  const [colEnd, setColEnd] = useState(127);
  const colStartRef = useRef(0);
  const colEndRef = useRef(127);
  const autoSelectedImageRef = useRef<ImageData | null>(null);
  useEffect(() => { colStartRef.current = colStart; }, [colStart]);
  useEffect(() => { colEndRef.current = colEnd; }, [colEnd]);
  const [supportMode, setSupportMode] = useState<SupportMode>(() =>
    loadCached(LS_KEYS.supportMode, DEFAULT_SUPPORT_MODE),
  );
  const [customColors, setCustomColors] = useState<ColorRgb[]>([]);
  const [customMode, setCustomMode] = useState<"custom" | number>("custom");
  const [newCustom, setNewCustom] = useState({ r: "", g: "", b: "", block: "" });
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  const [showVsFillersInPreview, setShowVsFillersInPreview] = useState(() => loadCached(LS_KEYS.showVsFillersInPreview, DEFAULT_SHOW_VS_FILLERS_IN_PREVIEW));
  const [imageName, setImageName] = useState("");
  const [imageValid, setImageValid] = useState(false);
  const [paletteNotices, setPaletteNotices] = useState<PaletteNotice[]>([]);
  const [converting, setConverting] = useState(false);
  const [showNames, setShowNames] = useState(() => loadCached(LS_KEYS.showNames, DEFAULT_SHOW_NAMES));
  const [showIds, setShowIds] = useState(() => loadCached(LS_KEYS.showIds, DEFAULT_SHOW_IDS));
  const [showOptions, setShowOptions] = useState(() => loadCached(LS_KEYS.showOptions, DEFAULT_SHOW_OPTIONS));
  const [blockDisplayMode, setBlockDisplayMode] = useState<BlockDisplayMode>(() =>
    loadCached(LS_KEYS.blockDisplayMode, DEFAULT_BLOCK_DISPLAY_MODE),
  );
  const [blockColExpanded, setBlockColExpanded] = useState(() => loadCached(LS_KEYS.blockColExpanded, DEFAULT_BLOCK_COLUMN_EXPANDED));
  const [sortKey, setSortKey] = useState<SortKey>(() => loadCached(LS_KEYS.sortKey, DEFAULT_SORT_KEY));
  const [sortDir, setSortDir] = useState<SortDir>(() => loadCached(LS_KEYS.sortDir, DEFAULT_SORT_DIR));
  const [showUnusedColors, setShowUnusedColors] = useState(false);
  const [showStacks, setShowStacks] = useState(() => loadCached(LS_KEYS.showStacks, DEFAULT_MC_UNITS));
  const [showMaxPerSplit, setShowMaxPerSplit] = useState(() => loadCached(LS_KEYS.maxPerSplit, DEFAULT_MAX_PER_SPLIT));
  const [isDark, setIsDark] = useState(resolveDarkTheme);
  const [convertUnsupported, /* setConvertUnsupported */] = useState(DEFAULT_CONVERT_UNSUPPORTED_COLORS); // always on; checkbox not shown
  const [cropImage, /* setCropImage */] = useState(DEFAULT_CROP_IMAGE); // always on; checkbox not shown
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => loadCached(LS_KEYS.columnOrder, DEFAULT_COLUMN_ORDER));
  const [showTransparentRow, setShowTransparentRow] = useState(() => loadCached(LS_KEYS.showTransparentRow, DEFAULT_SHOW_TRANSPARENT_ROW));
  const [showExcludedBlocks, setShowExcludedBlocks] = useState(() => loadCached(LS_KEYS.showExcludedBlocks, DEFAULT_SHOW_EXCLUDED_BLOCKS));
  const [forceZ129, setForceZ129] = useState(() => loadCached(LS_KEYS.forceZ129, DEFAULT_FORCE_Z129));
  const [applySupportFloorYs, setApplySupportFloorYs] = useState(() => loadCached(LS_KEYS.applySupportFloorYs, DEFAULT_APPLY_SUPPORT_FLOOR_YS));
  const [belowPlatformWater, setBelowPlatformWater] = useState(() => loadCached(LS_KEYS.belowPlatformWater, DEFAULT_BELOW_PLATFORM_WATER));
  const [skipEmptySuppressSteps, setSkipEmptySuppressSteps] = useState(() => loadCached(LS_KEYS.skipEmptySuppressSteps, DEFAULT_SKIP_EMPTY_SUPPRESS_STEPS));
  const [markSuppressLoadSpotsInSchematic, setMarkSuppressLoadSpotsInSchematic] = useState(() => loadCached(LS_KEYS.markSuppressLoadSpotsInSchematic, DEFAULT_MARK_SUPPRESS_LOAD_SPOTS_IN_SCHEMATIC));
  const [showVsFillerWarnings, setShowVsFillerWarnings] = useState(() => loadCached(LS_KEYS.showVsFillerWarnings, DEFAULT_SHOW_VS_FILLER_WARNINGS));
  const [showAlignmentReminder, setShowAlignmentReminder] = useState(() => loadCached(LS_KEYS.showAlignmentReminder, DEFAULT_SHOW_ALIGNMENT_REMINDER));
  const [showNooblineWarnings, setShowNooblineWarnings] = useState(() => loadCached(LS_KEYS.showNooblineWarnings, DEFAULT_SHOW_NOOBLINE_WARNINGS));
  const [showSecretsDialog, setShowSecretsDialog] = useState(false);
  const [decodedColorGrid, setDecodedColorGrid] = useState<ColorGrid | null>(null);
  const [parsedImageSetState, setParsedImageSetState] = useState<ColorGridSetParseResult | null>(null);
  const [isParsingImage, setIsParsingImage] = useState(false);
  const [parseProgress, setParseProgress] = useState<AnalysisProgress | null>(null);
  const [selectedTileIndices, setSelectedTileIndices] = useState<number[]>([]);
  const [tileSelectionAnchorIndex, setTileSelectionAnchorIndex] = useState<number | null>(null);
  const [imageLossyFormatLabel, setImageLossyFormatLabel] = useState<string | null>(null);
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
  const rawTileRows = imageData && imageData.height > 0 && imageData.height % MAP_SIZE === 0
    ? imageData.height / MAP_SIZE
    : 0;
  const rawTileCols = imageData && imageData.width > 0 && imageData.width % MAP_SIZE === 0
    ? imageData.width / MAP_SIZE
    : 0;
  const rawTileCount = rawTileRows * rawTileCols;
  const tileRows = parsedImageSet?.tileRows ?? rawTileRows;
  const tileCols = parsedImageSet?.tileCols ?? rawTileCols;
  const tileCount = parsedTiles.length > 0 ? parsedTiles.length : rawTileCount;
  const hasMultipleTiles = tileCount > 1;
  const displayImageData = hasBlockingSizeError ? null : (parsedImageSet?.imageData ?? imageData);
  const imageColorGrid = tileCount === 1 ? (parsedTiles[0]?.colorGrid ?? null) : null;
  const imageUsesCustomColors = useMemo(
    () => parsedTiles.some(tile => tile.colorGrid.some(column => column.some(color => color.isCustom))),
    [parsedTiles],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadedPreviewUrlRef = useRef<string | null>(null);
  const fileLoadRequestIdRef = useRef(0);
  const previousParsedTilesRef = useRef<readonly ParsedColorGridTile[] | null>(null);

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

  const [savedSelectedBlocks, setSavedSelectedBlocks] = useState<Record<number, string> | null>(null);

  // Compute dirty by comparing current blocks to saved snapshot
  const presetDirty = useMemo(() => {
    if (!savedSelectedBlocks) return false;
    const current = preset.selectedBlocks;
    const allKeys = new Set([...Object.keys(savedSelectedBlocks), ...Object.keys(current)]);
    for (const k of allKeys) {
      if ((savedSelectedBlocks[Number(k)] ?? "") !== (current[Number(k)] ?? "")) return true;
    }
    return false;
  }, [preset.selectedBlocks, savedSelectedBlocks]);
  const currentPresetIsUnsavedAuto = useMemo(
    () => activeIdx >= BUILTIN_PRESET_NAMES.length && isAutoCustomPresetName(preset.name) && presetDirty,
    [activeIdx, preset.name, presetDirty],
  );

  const markSavedDeferred = useCallback(() => {
    setSavedSelectedBlocks(null);
    markSavedNextRef.current = true;
  }, []);

  const markSavedImmediate = useCallback(() => {
    setSavedSelectedBlocks({ ...preset.selectedBlocks });
  }, [preset.selectedBlocks]);

  const markSavedNextRef = useRef(true);

  useEffect(() => {
    if (markSavedNextRef.current) {
      setSavedSelectedBlocks({ ...preset.selectedBlocks });
      markSavedNextRef.current = false;
    }
  }, [preset.selectedBlocks]);

  // Persist settings to localStorage
  useEffect(() => {
    const persistedPresets = presets.filter((p, idx) => {
      if (!isAutoCustomPresetName(p.name)) return true;
      if (idx !== activeIdx) return true;
      // Reuse yellow-dot logic: active auto-Custom with unsaved changes is discarded.
      return !presetDirty;
    });
    localStorage.setItem(LS_KEYS.presets, JSON.stringify(persistedPresets));
  }, [presets, activeIdx, presetDirty]);
  const persistedSettings = useMemo(
    () => ({
      [LS_KEYS.supportFiller]: supportFillerBlock,
      [LS_KEYS.shadeFiller]: shadeFillerBlock,
      [LS_KEYS.buildMode]: buildMode,
      [LS_KEYS.supportMode]: supportMode,
      [LS_KEYS.showStacks]: showStacks,
      [LS_KEYS.maxPerSplit]: showMaxPerSplit,
      [LS_KEYS.showIds]: showIds,
      [LS_KEYS.showNames]: showNames,
      [LS_KEYS.showOptions]: showOptions,
      [LS_KEYS.blockDisplayMode]: blockDisplayMode,
      [LS_KEYS.blockColExpanded]: blockColExpanded,
      [LS_KEYS.activePreset]: preset.name,
      [LS_KEYS.sortKey]: sortKey,
      [LS_KEYS.sortDir]: sortDir,
      [LS_KEYS.layerGap]: layerGap,
      [LS_KEYS.mixSteps]: mixSteps,
      [LS_KEYS.buildAtWorldMinY]: buildAtWorldMinY,
      [LS_KEYS.suppressStepDirection]: suppressStepDirection,
      [LS_KEYS.lightWaterDrop]: lightWaterDrop,
      [LS_KEYS.flatWaterDrop]: flatWaterDrop,
      [LS_KEYS.darkWaterDrop]: darkWaterDrop,
      [LS_KEYS.suppress2LayerLateFiller]: suppress2LayerLateFillerBlock,
      [LS_KEYS.paletteSeed]: proPaletteSeed,
      [LS_KEYS.dominateVoidFiller]: dominateVoidFillerBlock,
      [LS_KEYS.recessiveVoidFiller]: recessiveVoidFillerBlock,
      [LS_KEYS.showVsFillersInPreview]: showVsFillersInPreview,
      [LS_KEYS.columnOrder]: columnOrder,
      [LS_KEYS.showTransparentRow]: showTransparentRow,
      [LS_KEYS.showExcludedBlocks]: showExcludedBlocks,
      [LS_KEYS.forceZ129]: forceZ129,
      [LS_KEYS.applySupportFloorYs]: applySupportFloorYs,
      [LS_KEYS.belowPlatformWater]: belowPlatformWater,
      [LS_KEYS.skipEmptySuppressSteps]: skipEmptySuppressSteps,
      [LS_KEYS.markSuppressLoadSpotsInSchematic]: markSuppressLoadSpotsInSchematic,
      [LS_KEYS.showVsFillerWarnings]: showVsFillerWarnings,
      [LS_KEYS.showAlignmentReminder]: showAlignmentReminder,
      [LS_KEYS.showNooblineWarnings]: showNooblineWarnings,
    }),
    [
      supportFillerBlock,
      shadeFillerBlock,
      buildMode,
      supportMode,
      showStacks,
      showMaxPerSplit,
      showIds,
      showNames,
      showOptions,
      blockDisplayMode,
      blockColExpanded,
      preset.name,
      sortKey,
      sortDir,
      layerGap,
      mixSteps,
      buildAtWorldMinY,
      suppressStepDirection,
      lightWaterDrop,
      flatWaterDrop,
      darkWaterDrop,
      suppress2LayerLateFillerBlock,
      proPaletteSeed,
      dominateVoidFillerBlock,
      recessiveVoidFillerBlock,
      showVsFillersInPreview,
      columnOrder,
      showTransparentRow,
      showExcludedBlocks,
      forceZ129,
      applySupportFloorYs,
      belowPlatformWater,
      skipEmptySuppressSteps,
      markSuppressLoadSpotsInSchematic,
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
  const fullImageUsedShadesByBase = derivedImageStats?.usedShadesByBase ?? EMPTY_USED_SHADES_BY_BASE;
  const usedWaterShades = derivedImageStats?.usedWaterShades ?? EMPTY_USED_WATER_SHADES;
  const imageHasWater = usedWaterShades.size > 0;
  const paletteUsageInfo = derivedImageStats?.paletteUsageInfo ?? null;
  const [analysisResult, setAnalysisResult] = useState<TileAnalysisResult | null>(null);
  const [isAnalyzingTiles, setIsAnalyzingTiles] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState<TileAnalysisPhase>("generating");
  const [tileAnalysesState, setTileAnalysesState] = useState<TileAnalysis[]>([]);
  const [isAnalyzingMaterials, setIsAnalyzingMaterials] = useState(false);
  const [materialAnalysisProgress, setMaterialAnalysisProgress] = useState<AnalysisProgress | null>(null);
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
  const selectedWaterBlock = preset.selectedBlocks[WATER_BASE_INDEX] || BASE_COLORS[WATER_BASE_INDEX].blocks[0] || "";
  const usesWaterForWater = normalizeBlockId(selectedWaterBlock) === "water";
  const usesIceForWater = normalizeBlockId(selectedWaterBlock) === "ice";
  const effectiveSupportFillerBlock = supportFillerBlock.trim() || DEFAULT_SUPPORT_FILLER_BLOCK;
  const effectiveShadeFillerBlock = shadeFillerBlock.trim() || DEFAULT_SHADE_FILLER_BLOCK;
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
  const flatBuildModeSelected = buildMode === BuildMode.Flat;
  const getTileWaterSetting = useCallback(
    (tileDerivedImageStats: DerivedImageStats): TileWaterSetting => {
      const tileHasWater = tileDerivedImageStats.usedWaterShades.size > 0;
      const tileHasNonLightWater =
        tileDerivedImageStats.usedWaterShades.has(Shade.Dark) ||
        tileDerivedImageStats.usedWaterShades.has(Shade.Flat);
      if (flatBuildModeSelected) return undefined;
      if (belowPlatformWater && tileHasWater) {
        return { kind: "below-platform", drops: normalizedDeferredWaterDrops };
      }
      if (!belowPlatformWater && usesWaterForWater && tileHasNonLightWater) {
        return { kind: "top-aligned" };
      }
      return undefined;
    },
    [belowPlatformWater, flatBuildModeSelected, normalizedDeferredWaterDrops, usesWaterForWater],
  );
  const showMixStepsToggle = useMemo(
    () =>
      isSuppressStepsBuildMode(buildMode) &&
      imageValid &&
      parsedTiles.some((tile, index) => {
        const waterSetting = getTileWaterSetting(tileDerivedImageStats[index]);
        return hasStepMixOpportunity(tile.colorGrid, {
          waterDrops: waterSetting?.kind === "below-platform" ? waterSetting.drops : undefined,
        });
      }),
    [buildMode, imageValid, parsedTiles, tileDerivedImageStats, getTileWaterSetting],
  );
  const twoLayerHasLateVoidNeed = voidShadowSummary.hasDominantVoidShadow;
  const isSuppressStepDirectionSelectable = useCallback(
    (direction: SuppressStepDirection) => {
      if (buildMode !== BuildMode.SuppressStepChecker) return false;
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
    if (buildMode !== BuildMode.SuppressStepChecker || isSuppressStepDirectionSelectable(suppressStepDirection)) return;
    setSuppressStepDirection(current => cycleSuppressStepDirection(current, isSuppressStepDirectionSelectable));
  }, [buildMode, suppressStepDirection, isSuppressStepDirectionSelectable]);
  const normalizedSupportFillerBlockId = normalizeBlockId(effectiveSupportFillerBlock);
  const supportFillerIsFragile =
    normalizedSupportFillerBlockId.length > 0 && isFragileBlock(normalizedSupportFillerBlockId);
  const supportWaterSidesFillerValid = isWaterSideSupportFillerValid(effectiveSupportFillerBlock);
  const commitSupportFillerBlock = useCallback((value: string) => {
    if (isFillerDisabled(value)) setSupportMode(SupportMode.None);
  }, []);
  const shadeFillerShadingDisabled = isShadeFillerDisabled(effectiveShadeFillerBlock);
  const dominateVoidFillerShadingDisabled = isShadeFillerDisabled(effectiveDominateVoidFillerBlock || effectiveShadeFillerBlock);
  const recessiveVoidFillerShadingDisabled = isShadeFillerDisabled(effectiveRecessiveVoidFillerBlock || effectiveShadeFillerBlock);
  const lateFillerShadingDisabled = isShadeFillerDisabled(effectiveSuppress2LayerLateFillerBlock || effectiveShadeFillerBlock);
  const uiFillerAssignments = useMemo(
    () => createFillerAssignments(
      effectiveSupportFillerBlock,
      effectiveShadeFillerBlock,
      effectiveDominateVoidFillerBlock,
      effectiveRecessiveVoidFillerBlock,
      effectiveSuppress2LayerLateFillerBlock,
      supportMode,
      usesWaterForWater,
      usesIceForWater,
    ),
    [
      effectiveSupportFillerBlock,
      effectiveShadeFillerBlock,
      effectiveDominateVoidFillerBlock,
      effectiveRecessiveVoidFillerBlock,
      effectiveSuppress2LayerLateFillerBlock,
      supportMode,
      usesWaterForWater,
      usesIceForWater,
    ],
  );
  const transparentBlockMapping = useMemo(
    () => ({ [TRANSPARENCY_BASE_INDEX]: preset.selectedBlocks[TRANSPARENCY_BASE_INDEX] ?? "" }),
    [preset.selectedBlocks[TRANSPARENCY_BASE_INDEX]],
  );
  useEffect(() => {
    if (!imageValid || parsedTiles.length === 0) {
      previousParsedTilesRef.current = parsedTiles;
      setAnalysisResult(current => (current === null ? current : null));
      setIsAnalyzingTiles(current => (current ? false : current));
      setAnalysisProgress(current => (current === null ? current : null));
      setAnalysisPhase(current => (current === "generating" ? current : "generating"));
      return;
    }

    const parsedTilesChanged = previousParsedTilesRef.current !== parsedTiles;
    previousParsedTilesRef.current = parsedTiles;

    let cancelled = false;
    const totalTiles = parsedTiles.length;
    const showTileAnalysisProgress = totalTiles > 1;

    if (parsedTilesChanged) {
      setAnalysisResult(null);
    }
    setIsAnalyzingTiles(true);
    setAnalysisPhase("generating");
    setAnalysisProgress(showTileAnalysisProgress ? { completed: 0, total: totalTiles } : null);

    void (async () => {
      try {
        await yieldToMainThread();
        const supportsWorldMinYGeometry = supportMode === SupportMode.None || applySupportFloorYs;
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
          const hasWater = tileDerivedStats.usedWaterShades.size > 0;
          const includeTransparentBlocks = shouldIncludeTransparentBlocks(
            transparentBlockMapping,
            tileDerivedStats.hasTransparency,
            buildMode,
          );
          const waterSetting = getTileWaterSetting(tileDerivedStats);
          const flatModeBehavior = includeTransparentBlocks
            ? tileDerivedStats.flatModeBehavior
            : FlatModeBehavior.None;
          const baseGeometry = await getTileBaseGeometry(tile.cacheKey, {
            colorGrid: tile.colorGrid,
            allSameShade: tileDerivedStats.allSameShade,
            hasWater,
            hasTransparency: tileDerivedStats.hasTransparency,
            hasTwoLayerLateVoidNeed: twoLayerHasLateVoidNeed,
            includeTransparentBlocks,
            waterSetting,
            flatModeBehavior: tileDerivedStats.flatModeBehavior,
            selectedBuildMode: buildMode,
            layerGap: calcLayerGap,
            mixSteps: showMixStepsToggle && calcMixSteps,
            paletteSeed: paletteSeedOffset,
            enableWaterConvenience: supportMode !== SupportMode.None,
            skipEmptySuppressSteps,
            collapseStaircaseModes: !hasMultipleTiles,
            includeFlatNorthline: hasMultipleTiles && tileDerivedStats.flatModeBehavior !== FlatModeBehavior.None,
            selectedStepDirection: suppressStepDirection,
            applySupportFloorYs,
            supportsWorldMinYGeometry,
          });
          advanceProgress();
          return {
            tile,
            derivedImageStats: tileDerivedStats,
            hasWater,
            includeTransparentBlocks,
            waterSetting,
            flatModeBehavior,
            ...baseGeometry,
          } satisfies TileBaseAnalysis;
        }));

        if (cancelled) return;

        const nextFlatModeBehavior = getAggregatedFlatModeBehavior(nextBaseAnalyses);
        const nextIsFlatShape = nextBaseAnalyses.length > 0 && nextBaseAnalyses.every(tile => tile.isFlatShape);
        const nextBuildAtWorldMinYEligible = nextBaseAnalyses.some(tile => tile.buildAtWorldMinYEligible);
        const nextActiveBuildAtWorldMinY = nextBuildAtWorldMinYEligible && buildAtWorldMinY;
        const nextFlatRequiresVsFillers =
          nextFlatModeBehavior === FlatModeBehavior.ToggleableBuildAtWorldMinY &&
          !nextActiveBuildAtWorldMinY;
        const nextLockFlatBuildMode = nextIsFlatShape && !nextFlatRequiresVsFillers;
        const nextEffectiveBuildMode = nextLockFlatBuildMode ? BuildMode.Flat : buildMode;
        let nextTileGeometryAnalyses: TileGeometryAnalysis[];
        if (!nextActiveBuildAtWorldMinY) {
          if (showTileAnalysisProgress) {
            completedSteps = 0;
            lastProgressUpdateAt = performance.now();
            setAnalysisPhase("fillerAnalysis");
            setAnalysisProgress({ completed: 0, total: totalTiles });
          }
          nextTileGeometryAnalyses = [];
          for (const [index, tile] of nextBaseAnalyses.entries()) {
            const shapeMap = tile.baseShapeMap;
            const northlineShape = tile.baseNorthlineShape;
            const supportShape = nextEffectiveBuildMode === BuildMode.Flat
              ? northlineShape
              : getShapeForBuildMode(shapeMap, nextEffectiveBuildMode, tile.isFlatShape);
            const fillerNeedStats = supportShape ? getCachedShapeFillerNeeds(supportShape) : null;
            const northRowSingleLine = supportShape ? getCachedShapeNooblineIsSingleY(supportShape) : true;
            nextTileGeometryAnalyses.push({
              ...tile,
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
            const finalGeometry = await getTileFinalGeometry(tile.tile.cacheKey, {
              colorGrid: tile.tile.colorGrid,
              allSameShade: tile.derivedImageStats.allSameShade,
              hasWater: tile.hasWater,
              hasTransparency: tile.derivedImageStats.hasTransparency,
              hasTwoLayerLateVoidNeed: twoLayerHasLateVoidNeed,
              includeTransparentBlocks: tile.includeTransparentBlocks,
              waterSetting: tile.waterSetting,
              flatModeBehavior: tile.flatModeBehavior,
              buildAtWorldMinY: true,
              effectiveBuildMode: nextEffectiveBuildMode,
              selectedBuildMode: buildMode,
              isFlatShape: tile.isFlatShape,
              layerGap: calcLayerGap,
              mixSteps: showMixStepsToggle && calcMixSteps,
              paletteSeed: paletteSeedOffset,
              enableWaterConvenience: supportMode !== SupportMode.None,
              skipEmptySuppressSteps,
              collapseStaircaseModes: !hasMultipleTiles,
              includeFlatNorthline: hasMultipleTiles && tile.flatModeBehavior !== FlatModeBehavior.None,
              selectedStepDirection: suppressStepDirection,
            });
            advanceProgress();
            return {
              ...tile,
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
    showMixStepsToggle,
    calcMixSteps,
    paletteSeedOffset,
    supportMode,
    skipEmptySuppressSteps,
    suppressStepDirection,
    applySupportFloorYs,
    buildAtWorldMinY,
    hasMultipleTiles,
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
    () => tileBaseAnalyses.some(tile => tile.buildAtWorldMinYEligible),
    [tileBaseAnalyses],
  );
  const buildAtWorldMinYEligible = flatBuildAtWorldMinYEligible;
  const showBuildAtWorldMinYToggle = imageValid && buildAtWorldMinYEligible;
  const activeBuildAtWorldMinY = showBuildAtWorldMinYToggle && buildAtWorldMinY;
  const flatRequiresVsFillers =
    flatModeBehavior === FlatModeBehavior.ToggleableBuildAtWorldMinY &&
    !activeBuildAtWorldMinY;
  const lockFlatBuildMode = isFlatShape && !flatRequiresVsFillers;
  const effectiveBuildMode = lockFlatBuildMode ? BuildMode.Flat : buildMode;
  const usedBaseColors = derivedImageStats?.usedBaseColors ?? EMPTY_USED_BASE_COLORS;
  const visibleWaterLevelControls = useMemo(
    () => {
      if (!imageValid || !belowPlatformWater || flatBuildModeSelected) return [];
      const currentWaterDrops = buildWaterDropInputs(darkWaterDrop, flatWaterDrop, lightWaterDrop);
      return WATER_DROP_INPUT_ORDER
        .filter(shade => usedWaterShades.has(shade))
        .map(shade => ({ shade, value: currentWaterDrops[shade] }));
    },
    [
      imageValid,
      belowPlatformWater,
      flatBuildModeSelected,
      usedWaterShades,
      lightWaterDrop,
      flatWaterDrop,
      darkWaterDrop,
    ],
  );

  useEffect(() => {
    if (!belowPlatformWater) return;
    if (lightWaterDrop !== normalizedImmediateWaterDrops[Shade.Light]) setLightWaterDrop(normalizedImmediateWaterDrops[Shade.Light]);
    if (flatWaterDrop !== normalizedImmediateWaterDrops[Shade.Flat]) setFlatWaterDrop(normalizedImmediateWaterDrops[Shade.Flat]);
    if (darkWaterDrop !== normalizedImmediateWaterDrops[Shade.Dark]) setDarkWaterDrop(normalizedImmediateWaterDrops[Shade.Dark]);
  }, [
    belowPlatformWater,
    lightWaterDrop,
    flatWaterDrop,
    darkWaterDrop,
    normalizedImmediateWaterDrops,
  ]);

  useEffect(() => {
    if (tileGeometryAnalyses.length === 0) {
      setTileAnalysesState(current => (current.length === 0 ? current : []));
      setIsAnalyzingMaterials(false);
      setMaterialAnalysisProgress(current => (current === null ? current : null));
      return;
    }

    let cancelled = false;
    const totalTiles = tileGeometryAnalyses.length;
    const materialAnalysisOptions = {
      blockMapping: preset.selectedBlocks,
      fillerAssignments: uiFillerAssignments,
      applySupportFloorYs,
      customColors,
    };
    setIsAnalyzingMaterials(true);
    setMaterialAnalysisProgress(totalTiles > 1 ? { completed: 0, total: totalTiles } : null);

    void (async () => {
      await yieldToMainThread();
      let lastMainThreadProgressUpdateAt = performance.now();
      const nextTileAnalyses: TileAnalysis[] = [];

      for (const [index, tile] of tileGeometryAnalyses.entries()) {
        const materialNeedStats = tile.supportShape
          ? analyzeMaterialNeeds(tile.tile.colorGrid, tile.supportShape, materialAnalysisOptions)
          : null;
        const fragileSupportOverrideNeedStats =
          tile.supportShape && supportMode !== SupportMode.None
            ? analyzeFragileSupportOverrideNeeds(tile.supportShape, materialAnalysisOptions)
            : null;
        nextTileAnalyses.push({
          ...tile,
          materialNeedStats,
          fragileSupportOverrideNeedStats,
        });

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
      setTileAnalysesState(nextTileAnalyses);
      setIsAnalyzingMaterials(false);
      setMaterialAnalysisProgress(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [tileGeometryAnalyses, preset.selectedBlocks, uiFillerAssignments, applySupportFloorYs, customColors, supportMode]);
  const tileAnalyses = tileAnalysesState;

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

  const missingBlocks = useMemo(() => {
    if (!imageValid || usedBaseColors.size === 0) return [];
    return [...usedBaseColors].filter(idx => idx > 0 && !preset.selectedBlocks[idx]);
  }, [imageValid, usedBaseColors, preset.selectedBlocks]);

  const activeSingleTileIndex = hasMultipleTiles ? selectedTileIndex : (tileAnalyses.length > 0 ? 0 : null);
  const selectedTileAnalysis = activeSingleTileIndex === null ? null : (tileAnalyses[activeSingleTileIndex] ?? null);
  const isStepRangeMode = isSuppressStepsBuildMode(effectiveBuildMode);
  const isNorthSouthSuppressStepDirection =
    suppressStepDirection === SuppressStepDirection.NorthToSouth ||
    suppressStepDirection === SuppressStepDirection.SouthToNorth;
  const supportShape = selectedTileAnalysis?.supportShape ?? null;
  const maxRangeIndex = useMemo(
    () => {
      if (!selectedTileAnalysis) return getBuildModeRangeMax(effectiveBuildMode);
      return isStepRangeMode
        ? Math.max(0, (supportShape?.parts.length ?? (getBuildModeRangeMax(effectiveBuildMode) + (belowPlatformWater && selectedTileAnalysis.hasWater ? 1 : 0))) - 1)
        : getBuildModeRangeMax(effectiveBuildMode);
    },
    [effectiveBuildMode, isStepRangeMode, supportShape, belowPlatformWater, selectedTileAnalysis],
  );
  const minLayerGap = supportMode === SupportMode.Fragile || supportMode === SupportMode.All ? 3 : 2;
  const enableStepsSupportOption = !imageData || tileAnalyses.some(tile =>
    !!tile.supportShape?.parts.some(part =>
      part.cells.entries().some(([coord, cell]) => {
        if (!isShapeFillerCell(cell) || !cell.includes(FillerRole.StairStep)) return false;
        const [x, y, z] = parseShapeCoordKey(coord);
        const supportFloorYs = applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
        return isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs);
      }),
    ),
  );
  const enableFragileSupportOption = useMemo(() => {
    const hasFragileMappedBlock = (block: string) => !!block && isFragileBlock(normalizeBlockId(block));
    if (!imageData) {
      return Object.values(preset.selectedBlocks).some(hasFragileMappedBlock) || customColors.some(color => hasFragileMappedBlock(color.blocks[0] ?? ""));
    }
    return tileAnalyses.some(tile =>
      !!tile.supportShape?.parts.some(part =>
        part.cells.entries().some(([coord, cell]) => {
          if (!isShapeFillerCell(cell)) return false;
          const [x, y, z] = parseShapeCoordKey(coord);
          const supportFloorYs = applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
          if (!isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs)) return false;
          if (!cell.includes(FillerRole.SupportFragile)) return false;
          const color = getSupportedColorAbove(part, coord);
          if (!color) return false;
          const mapped = color.isCustom
            ? (customColors[color.id]?.blocks[0] ?? "")
            : (preset.selectedBlocks[color.id] || BASE_COLORS[color.id].blocks[0] || "");
          return hasFragileMappedBlock(mapped);
        }),
      ),
    );
  }, [imageData, tileAnalyses, preset.selectedBlocks, customColors, applySupportFloorYs]);
  const staircaseModeOptions = useMemo((): ModeOption[] => {
    if (!imageValid) {
      return DEFAULT_STAIRCASE_OPTIONS;
    }
    if (hasMultipleTiles) {
      if (tileDerivedImageStats.length === 0) return DEFAULT_STAIRCASE_OPTIONS;
      const includeTransparentBlocksForStaircase = (transparentBlockMapping[TRANSPARENCY_BASE_INDEX] ?? "").trim() !== "";
      const flatVisible = tileDerivedImageStats.every(tile => tile.flatModeBehavior !== FlatModeBehavior.None);
      const inclineUpVisible = tileDerivedImageStats.every(tile =>
        tile.allSameShade === Shade.Dark &&
        tile.usedWaterShades.size === 0 &&
        (!tile.hasTransparency || includeTransparentBlocksForStaircase),
      );
      const inclineDownVisible = tileDerivedImageStats.every(tile =>
        tile.allSameShade === Shade.Light &&
        tile.usedWaterShades.size === 0 &&
        (!tile.hasTransparency || includeTransparentBlocksForStaircase),
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
  }, [tileBaseAnalyses, imageValid, isFlatShape, hasMultipleTiles, tileDerivedImageStats, transparentBlockMapping]);

  const suppressModeOptions = useMemo((): ModeOption[] => {
    const visibleModes = new Set(getVisibleSuppressBuildModes(twoLayerHasLateVoidNeed));
    return BASE_SUPPRESS_OPTIONS.filter(option => {
      if (hasMultipleTiles && (option.value === BuildMode.SuppressSplitRow || option.value === BuildMode.SuppressSplitChecker)) {
        return false;
      }
      return visibleModes.has(option.value);
    });
  }, [twoLayerHasLateVoidNeed, hasMultipleTiles]);
  const showSuppressStepDirectionControl =
    !!imageData &&
    imageValid &&
    !lockFlatBuildMode &&
    isSuppressStepsBuildMode(buildMode);
  const shadingMethodTooltip = messages.buildMode.tooltip(buildMode);
  const supportModeTooltip = messages.supportMode.tooltip(supportMode);
  const toolbarBuildSettingsProps = displayImageData && imageValid ? {
    lockFlatBuildMode,
    visibleWaterLevelControls,
    setNormalizedWaterDrop,
    minLayerGap,
    layerGap,
    setLayerGap,
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
    showSuppressStepDirectionControl,
    suppressStepDirection,
    setSuppressStepDirection,
    isSuppressStepDirectionSelectable,
    staircaseModeOptions,
    suppressModeOptions,
    shadingMethodTooltip,
  } : null;

  const suppressStepNorthSouthWarning = useMemo(
    () =>
      showSuppressStepDirectionControl &&
      isNorthSouthSuppressStepDirection
        ? messages.preview.suppressStepNorthSouthWarning(
            messages.buildMode.optionLabel(buildMode),
            messages.buildMode.stepDirectionLabel(suppressStepDirection),
          )
        : null,
    [
      buildMode,
      showSuppressStepDirectionControl,
      isNorthSouthSuppressStepDirection,
      suppressStepDirection,
    ],
  );
  const buildMaterialAnalysisOptions = useCallback(
    (fillerAssignments: FillerAssignment[], includeRange: boolean) => ({
      blockMapping: preset.selectedBlocks,
      fillerAssignments,
      applySupportFloorYs,
      customColors,
      ...(includeRange && colRangeEnabled
        ? (isStepRangeMode ? { phaseRange: [colStart, colEnd] as [number, number] } : { xColumnRange: [colStart, colEnd] as [number, number] })
        : {}),
    }),
    [preset.selectedBlocks, applySupportFloorYs, customColors, colRangeEnabled, isStepRangeMode, colStart, colEnd],
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
    () => getSupportModeFillerRoles(SupportMode.All, usesWaterForWater, usesIceForWater),
    [usesWaterForWater, usesIceForWater],
  );
  const waterSupportRoles = useMemo(
    () => getSupportModeFillerRoles(SupportMode.Water, usesWaterForWater, usesIceForWater),
    [usesWaterForWater, usesIceForWater],
  );
  const activeSupportRoles = useMemo(
    () => getSupportModeFillerRoles(supportMode, usesWaterForWater, usesIceForWater),
    [supportMode, usesWaterForWater, usesIceForWater],
  );
  const enableAllSupportOption = !imageData || getSupportModeRoleCount(
    ...allSupportRoles,
  ) > 0;
  const enableWaterSupportOption = !imageData || getSupportModeRoleCount(
    ...waterSupportRoles,
  ) > 0;
  const showSupportModeSelector = !imageData || (
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
  const numUniqueColorShadesForPart =
    selectedTileMaterialNeedStats?.numUniqueColorShadesForPart ??
    (paletteUsageInfo?.uniqueShadeCount ?? 0);
  const usedShadesByBase = fullImageUsedShadesByBase;
  const formatRequiredCount = (count: number) => (showStacks ? formatStacks(count) : count);
  const colorRequiredMap = materialCountsView.baseColorCounts;
  const numColorBlockTypesForPart = Object.values(colorRequiredMap).filter(count => count > 0).length;

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
          const exists = prev.findIndex(p => p.name === decodedPreset.blockPreset.name);
          if (exists >= 0) {
            const n = [...prev];
            n[exists] = decodedPreset.blockPreset;
            setActiveIdx(exists);
            return n;
          }
          setActiveIdx(prev.length);
          return [...prev, decodedPreset.blockPreset];
        });
        if (decodedPreset.supportFiller) setSupportFillerBlock(decodedPreset.supportFiller);
        if (decodedPreset.shadeFiller) setShadeFillerBlock(decodedPreset.shadeFiller);
        if (decodedPreset.supportMode !== undefined) setSupportMode(decodedPreset.supportMode);
        if (decodedPreset.buildMode) setBuildMode(decodedPreset.buildMode);
        if (decodedPreset.customColors) setCustomColors(decodedPreset.customColors);
        if (decodedPreset.suppress2LayerLateFillerBlock) {
          setSuppress2LayerLateFillerBlock(decodedPreset.suppress2LayerLateFillerBlock);
        }
        if (decodedPreset.proPaletteSeed !== undefined) setProPaletteSeed(decodedPreset.proPaletteSeed);
        if (decodedPreset.mixSteps !== undefined) setMixSteps(decodedPreset.mixSteps);
        if (decodedPreset.buildAtWorldMinY !== undefined) setBuildAtWorldMinY(decodedPreset.buildAtWorldMinY);
        if (decodedPreset.suppressStepDirection !== undefined && isSuppressStepDirection(decodedPreset.suppressStepDirection)) {
          setSuppressStepDirection(decodedPreset.suppressStepDirection);
        }
        if (decodedPreset.dominateVoidFillerBlock) setDominateVoidFillerBlock(decodedPreset.dominateVoidFillerBlock);
        if (decodedPreset.recessiveVoidFillerBlock) setRecessiveVoidFillerBlock(decodedPreset.recessiveVoidFillerBlock);
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

  // Auto-select mode when image changes
  useEffect(() => {
    if (!imageData) {
      autoSelectedImageRef.current = null;
      return;
    }
    if (!imageValid || previewBusy || autoSelectedImageRef.current === imageData) return;
    autoSelectedImageRef.current = imageData;
    if (isFlatShape) setBuildMode(BuildMode.Flat);
    else if (DEFAULT_SWITCH_TO_SUPPRESS_CHECKER_IF_CONTAINS_VOID_SHADOWS && hasVoidShadow) {
      setBuildMode(prev => isStaircaseBuildMode(prev) ? BuildMode.SuppressStepChecker : prev);
      if (isStaircaseBuildMode(buildMode)) {
        setSuppressStepDirection(SuppressStepDirection.EastToWest);
      }
    }
    else setBuildMode(prev => prev === BuildMode.Flat ? BuildMode.StaircaseClassic : prev);
  }, [imageData, imageValid, previewBusy, isFlatShape, hasVoidShadow, buildMode]);

  useEffect(() => {
    if (!imageData || previewBusy || lockFlatBuildMode) return;
    const visible = new Set<BuildMode>([
      ...staircaseModeOptions.map(o => o.value),
      ...suppressModeOptions.map(o => o.value),
    ]);
    if (!visible.has(buildMode)) {
      if (buildMode === BuildMode.Suppress2Layer && visible.has(BuildMode.Suppress2LayerLateFillers)) {
        setBuildMode(BuildMode.Suppress2LayerLateFillers);
      } else if (buildMode === BuildMode.Suppress2LayerLatePairs && visible.has(BuildMode.Suppress2Layer)) {
        setBuildMode(BuildMode.Suppress2Layer);
      } else if (buildMode === BuildMode.Suppress2LayerLatePairs && visible.has(BuildMode.Suppress2LayerLateFillers)) {
        setBuildMode(BuildMode.Suppress2LayerLateFillers);
      } else {
        setBuildMode(staircaseModeOptions[0]?.value ?? BuildMode.StaircaseClassic);
      }
    }
  }, [imageData, previewBusy, lockFlatBuildMode, buildMode, staircaseModeOptions, suppressModeOptions]);

  useEffect(() => {
    if (!imageData || previewBusy) return;
    if (supportMode === SupportMode.All && !enableAllSupportOption) { setSupportMode(SupportMode.None); return; }
    if (supportMode === SupportMode.Fragile && (supportFillerIsFragile || !enableFragileSupportOption)) { setSupportMode(SupportMode.None); return; }
    if (supportMode === SupportMode.Steps && !enableStepsSupportOption) setSupportMode(SupportMode.None);
    if (supportMode === SupportMode.Water && !enableWaterSupportOption) setSupportMode(SupportMode.None);
  }, [imageData, previewBusy, enableAllSupportOption, enableStepsSupportOption, enableFragileSupportOption, enableWaterSupportOption, supportMode, supportFillerIsFragile]);

  useEffect(() => {
    if ((supportMode === SupportMode.Fragile || supportMode === SupportMode.All) && layerGap < 3) setLayerGap(3);
  }, [supportMode, layerGap]);

  const customBlocksByBase = useMemo(() => {
    const map: Record<number, string[]> = {};
    for (const cc of customColors) {
      for (let i = 0; i < BASE_COLORS.length; ++i) {
        const bc = BASE_COLORS[i];
        if (bc.r === cc.r && bc.g === cc.g && bc.b === cc.b) {
          for (const block of cc.blocks) {
            (map[i] ??= []).includes(block) || map[i].push(block);
          }
        }
      }
    }
    return map;
  }, [customColors]);

  const updateBlock = (baseIndex: number, block: string) => {
    const nextBlock = sanitizeUserBlockEntry(block);
    const currentBlock = preset.selectedBlocks[baseIndex] ?? "";
    if (nextBlock === currentBlock) return;

    const isBuiltin = activeIdx < BUILTIN_PRESET_NAMES.length;
    const nextBlocks = { ...preset.selectedBlocks, [baseIndex]: nextBlock };
    const matchingBuiltinName = findMatchingBuiltinPresetName(nextBlocks);

    if (isBuiltin) {
      // Spawn a new "Custom" preset instead of mutating the builtin
      setSavedSelectedBlocks({ ...preset.selectedBlocks });
      setPresets(prev => {
        let customName: string = messages.presets.customGroupLabel;
        const existingNames = new Set(prev.map(p => p.name));
        let suffix = 2;
        while (existingNames.has(customName)) {
          customName = `Custom ${suffix++}`;
        }
        return [...prev, { name: customName, selectedBlocks: nextBlocks }];
      });
      setActiveIdx(presets.length);
      return;
    }

    if (matchingBuiltinName) {
      const matchingBuiltinIdx = BUILTIN_PRESET_NAMES.findIndex(name => name === matchingBuiltinName);
      setPresets(prev => prev.filter((_, idx) => idx !== activeIdx));
      setActiveIdx(matchingBuiltinIdx);
      markSavedDeferred();
      return;
    }

    setPresets(prev => {
      const n = [...prev];
      n[activeIdx] = { ...n[activeIdx], selectedBlocks: nextBlocks };
      return n;
    });
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
    setActiveIdx(nextIdx);
    markSavedDeferred();
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
        next[activeIdx] = { name, selectedBlocks: { ...preset.selectedBlocks } };
        return next;
      });
      setActiveIdx(activeIdx);
    } else {
      setPresets(prev => [...prev, { name, selectedBlocks: { ...preset.selectedBlocks } }]);
      setActiveIdx(presets.length);
    }
    markSavedDeferred();
  };

  const deletePreset = () => {
    if (activeIdx < BUILTIN_PRESET_NAMES.length) return;
    setPresets(prev => prev.filter((_, i) => i !== activeIdx));
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
          convertUnsupported,
          suppress2LayerLateFillerBlock,
          proPaletteSeed,
          mixSteps,
          buildAtWorldMinY,
          suppressStepDirection,
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
    convertUnsupported,
    suppress2LayerLateFillerBlock,
    proPaletteSeed,
    mixSteps,
    buildAtWorldMinY,
    suppressStepDirection,
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
    if (decodedColorGrid || !imageData) {
      setIsParsingImage(false);
      setParseProgress(null);
      if (!decodedColorGrid) setParsedImageSetState(null);
      return;
    }

    let cancelled = false;
    const rawTileCount = getTileCountForDimensions(imageData.width, imageData.height);
    if (!cropImage && rawTileCount === 0) {
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
      setIsParsingImage(false);
      setParseProgress(null);
      return;
    }
    const expectedTileCount = cropImage ? getPreprocessedTileCount(imageData) : rawTileCount;
    const singleTileImage = expectedTileCount === 1;
    setIsParsingImage(true);
    setParseProgress(!singleTileImage && expectedTileCount > 0 ? { completed: 0, total: expectedTileCount } : null);
    setImageValid(false);
    setPaletteNotices([]);

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
        setIsParsingImage(false);
        setParseProgress(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [decodedColorGrid, imageData, customColors, convertUnsupported, cropImage, imageLossyFormatLabel]);

  const handleFile = useCallback(
    (file: File) => {
      const requestId = fileLoadRequestIdRef.current + 1;
      fileLoadRequestIdRef.current = requestId;
      replaceUploadedPreviewUrl(URL.createObjectURL(file));
      setDecodedColorGrid(null);
      setParsedImageSetState(null);
      setPaletteNotices([]);
      setSelectedTileIndices([]);
      setTileSelectionAnchorIndex(null);
      setColRangeEnabled(false);
      setImageValid(false);
      setIsParsingImage(true);
      setParseProgress(null);
      loadImageDataFromFile(file)
        .then(nextImageData => {
          if (fileLoadRequestIdRef.current !== requestId) return;
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
    [getLossyImageFormatLabel, isLikelyLossyImageFile, replaceUploadedPreviewUrl, sortKey],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = getClipboardImageFile(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      handleFile(file);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile]);

  const handleConvertAndDownload = async () => {
    if (!imageValid || tileAnalyses.length === 0) return;
    setConverting(true);
    try {
      const baseName = imageName.replace(/\.[^/.]+$/, "");
      const suffix = getBuildModeDownloadSuffix(buildMode, suppressStepDirection);
      const exportTileAnalyses = selectedTileIndices.length > 0 ? selectedTileAnalyses : tileAnalyses;
      const exportEntries: { name: string; data: Uint8Array }[] = [];

      for (const tile of exportTileAnalyses) {
        if (!tile.supportShape) throw new Error(messages.parsing.conversionFailed);
        const tileEntries = await convertToNbtEntries(tile.supportShape, {
          blockMapping: preset.selectedBlocks,
          fillerAssignments: uiFillerAssignments,
          applySupportFloorYs,
          forceZ129,
          customColors,
          baseName,
          buildMode: effectiveBuildMode,
          suppressStepDirection,
          markSuppressLoadSpotsInSchematic,
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
    if (customMode === "custom") {
      const [r, g, b] = [newCustom.r, newCustom.g, newCustom.b].map(v => parseInt(v));
      if ([r, g, b].some(isNaN)) return;
      setCustomColors(prev => [...prev, { r, g, b, blocks: [block] }]);
    } else {
      const { r, g, b } = BASE_COLORS[customMode];
      setCustomColors(prev => [...prev, { r, g, b, blocks: [block] }]);
    }
    setNewCustom({ r: "", g: "", b: "", block: "" });
  };

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

  const aggregateShapeFillerRoleCounts = aggregateFillerRoleCounts;
  const aggregateNorthRowSingleLine = tileGeometryAnalyses.every(tile => tile.northRowSingleLine);

  const canGenerate = imageValid && !previewBusy && missingBlocks.length === 0;
  const hasRequiredCol = imageValid && tileAnalyses.length > 0;
  const northRowFillerCount = aggregateShapeFillerRoleCounts.get(FillerRole.ShadeNorthRow) ?? 0;
  const suppressFillerCount = aggregateShapeFillerRoleCounts.get(FillerRole.ShadeSuppress) ?? 0;
  const lateSuppressFillerCount = aggregateShapeFillerRoleCounts.get(FillerRole.ShadeSuppressLate) ?? 0;
  const getAggregateRequiredFillerRoleCount = useCallback(
    (...roles: FillerRole[]) =>
      roles.reduce((sum, role) => sum + (allTileMaterialCountsSum.fillerRoleCounts.get(role) ?? 0), 0),
    [allTileMaterialCountsSum],
  );
  const getRequiredFillerRoleCount = useCallback(
    (...roles: FillerRole[]) => roles.reduce((sum, role) => sum + (materialCountsView.fillerRoleCounts.get(role) ?? 0), 0),
    [materialCountsView],
  );
  const aggregateShadeFillerRequiredCount = getAggregateRequiredFillerRoleCount(
    FillerRole.ShadeNorthRow,
    FillerRole.ShadeSuppress,
  );
  const aggregateLateFillerRequiredCount = getAggregateRequiredFillerRoleCount(FillerRole.ShadeSuppressLate);
  const aggregateDominateVoidFillerRequiredCount = getAggregateRequiredFillerRoleCount(FillerRole.ShadeVoidDominant);
  const aggregateRecessiveVoidFillerRequiredCount = getAggregateRequiredFillerRoleCount(FillerRole.ShadeVoidRecessive);
  const aggregateSupportFillerRequiredCount = getAggregateRequiredFillerRoleCount(...activeSupportRoles);
  const shadeFillerRequiredCount = getRequiredFillerRoleCount(
    FillerRole.ShadeNorthRow,
    FillerRole.ShadeSuppress,
  );
  const lateFillerRequiredCount = getRequiredFillerRoleCount(FillerRole.ShadeSuppressLate);
  const dominateVoidFillerRequiredCount = getRequiredFillerRoleCount(FillerRole.ShadeVoidDominant);
  const recessiveVoidFillerRequiredCount = getRequiredFillerRoleCount(FillerRole.ShadeVoidRecessive);
  const vsFillerSpotCount = dominateVoidFillerRequiredCount + recessiveVoidFillerRequiredCount;
  const showWaterSideSupportWarning =
    imageValid &&
    (supportMode === SupportMode.All || supportMode === SupportMode.Water) &&
    usesWaterForWater &&
    getSupportModeRoleCount(FillerRole.SupportWaterSides) > 0 &&
    !supportWaterSidesFillerValid;
  const supportFillerRequiredCount = getRequiredFillerRoleCount(...activeSupportRoles);
  const hasInGridFillerNeed = suppressFillerCount + lateSuppressFillerCount > 0;
  const inGridShadingCountsAsWarning = hasInGridFillerNeed && isSuppressBuildMode(effectiveBuildMode);
  const hasComplexNorthNeed = northRowFillerCount > 0 && (showNooblineWarnings || !aggregateNorthRowSingleLine);
  const showNoFillerWarning =
    imageValid &&
    ((inGridShadingCountsAsWarning && shadeFillerShadingDisabled) || (hasComplexNorthNeed && shadeFillerShadingDisabled));
  const showLateFillerInput =
    !!imageData &&
    buildMode === BuildMode.Suppress2LayerLateFillers &&
    aggregateLateFillerRequiredCount > 0;
  const showSupportFillerInput =
    supportMode !== SupportMode.None &&
    (!imageData || aggregateSupportFillerRequiredCount > 0 || showWaterSideSupportWarning);
  const showShadeFillerInput = !!imageData && aggregateShadeFillerRequiredCount > 0;
  const shadeFillerIsNorthRowOnly = northRowFillerCount > 0 && suppressFillerCount === 0;
  const showDominateVoidFillerInput =
    !!imageData &&
    aggregateDominateVoidFillerRequiredCount > 0;
  const showRecessiveVoidFillerInput =
    !!imageData &&
    aggregateRecessiveVoidFillerRequiredCount > 0;
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
  const presetPrimaryActionLabel = presetDirty ? messages.common.save : messages.common.share;
  const presetPrimaryActionTitle = presetDirty ? messages.presets.saveTitle : messages.presets.shareTitle;
  const showNorthRowAlignmentInfo =
    showAlignmentReminder &&
    imageValid &&
    tileGeometryAnalyses.length > 0 &&
    (forceZ129 || (!shadeFillerShadingDisabled && northRowFillerCount > 0));
  const noFillerWarning = useMemo(() => {
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
    effectiveBuildMode,
    effectiveShadeFillerBlock,
    hasInGridFillerNeed,
    lateSuppressFillerCount,
    northRowFillerCount,
    aggregateNorthRowSingleLine,
    showNoFillerWarning,
    showNooblineWarnings,
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
    if (!imageValid || !fragileSupportOverrideNeedStats) return null;
    if (supportMode === SupportMode.None) return null;

    const warningLines: string[] = [];

    for (const [blockId, rule] of FRAGILE_SUPPORT_RULES) {
      if ((fragileSupportOverrideNeedStats.overrideCounts[blockId] ?? 0) <= 0) continue;
      warningLines.push(messages.preview.fragileSupportOverrideWarning(blockId, rule.validSupportBlocks));
    }

    return warningLines.length > 0
      ? { text: warningLines.join("\n\n"), invalid: false }
      : null;
  }, [
    fragileSupportOverrideNeedStats,
    imageValid,
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
      rawValue: string,
      noobPixels: number,
    ): VsEntry | null => {
      if (!show) return null;
      const value = rawValue.trim() || effectiveShadeFillerBlock;
      return { label, value, invalid: isFillerDisabled(value), noobPixels };
    };
    const formatInvalid = (entry: VsEntry) => messages.preview.vsFillerInvalid(entry.label, entry.value, entry.noobPixels);
    const formatRequired = (label: string, pixels: number, isPluralLabel = false) =>
      messages.preview.vsFillerRequired(label, pixels, isPluralLabel);

    const dominant = makeEntry(
      showDominateVoidFillerInput,
      messages.fillers.dominateVoidWarningLabel,
      dominateVoidFillerBlock,
      aggregateDominateVoidFillerRequiredCount,
    );
    const recessive = makeEntry(
      showRecessiveVoidFillerInput,
      messages.fillers.recessiveVoidWarningLabel,
      recessiveVoidFillerBlock,
      aggregateRecessiveVoidFillerRequiredCount,
    );

    if (!dominant && !recessive) return null;
    if (!dominant) {
      if (recessive!.invalid) return { text: formatInvalid(recessive!), invalid: true };
      return showVsFillerWarnings ? { text: formatRequired(recessive!.label, recessive!.noobPixels), invalid: false } : null;
    }
    if (!recessive) {
      if (dominant.invalid) return { text: formatInvalid(dominant), invalid: true };
      return showVsFillerWarnings ? { text: formatRequired(dominant.label, dominant.noobPixels), invalid: false } : null;
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
    return { text: formatRequired(messages.fillers.voidFillersWarningLabel, pixels, true), invalid: false };
  }, [
    dominateVoidFillerBlock,
    effectiveShadeFillerBlock,
    recessiveVoidFillerBlock,
    showDominateVoidFillerInput,
    showRecessiveVoidFillerInput,
    showVsFillerWarnings,
    aggregateDominateVoidFillerRequiredCount,
    aggregateRecessiveVoidFillerRequiredCount,
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
    missingBlocks.length,
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
      <header className="border-b border-border px-4 py-1.5 flex items-center justify-between bg-[hsl(var(--header-bg))]">
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
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-muted transition-colors"
          aria-label={messages.common.toggleThemeAriaLabel}
          title={messages.common.toggleThemeAriaLabel}
        >
          {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
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
            activeIdx={activeIdx}
            selectPreset={selectPreset}
            activePresetBuiltinTooltip={activePresetBuiltinTooltip}
            presetDirty={presetDirty}
            isBuiltinUnedited={isBuiltinUnedited}
            sharePreset={sharePreset}
            presetPrimaryActionTitle={presetPrimaryActionTitle}
            presetPrimaryActionLabel={presetPrimaryActionLabel}
            deletePreset={deletePreset}
            createPreset={createPreset}
            showSupportModeSelector={showSupportModeSelector}
            supportMode={supportMode}
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
            showSupportFillerInput={showSupportFillerInput}
            supportFillerBlock={supportFillerBlock}
            setSupportFillerBlock={setSupportFillerBlock}
            commitSupportFillerBlock={commitSupportFillerBlock}
            supportFillerDisabled={supportFillerDisabled}
            supportFillerRequiredCount={supportFillerRequiredCount}
            showShadeFillerInput={showShadeFillerInput}
            shadeFillerBlock={shadeFillerBlock}
            setShadeFillerBlock={setShadeFillerBlock}
            shadeFillerIsNorthRowOnly={shadeFillerIsNorthRowOnly}
            shadeFillerShadingDisabled={shadeFillerShadingDisabled}
            shadeFillerRequiredCount={shadeFillerRequiredCount}
            showDominateVoidFillerInput={showDominateVoidFillerInput}
            dominateVoidFillerBlock={dominateVoidFillerBlock}
            setDominateVoidFillerBlock={setDominateVoidFillerBlock}
            dominateVoidFillerShadingDisabled={dominateVoidFillerShadingDisabled}
            dominateVoidFillerRequiredCount={dominateVoidFillerRequiredCount}
            showRecessiveVoidFillerInput={showRecessiveVoidFillerInput}
            recessiveVoidFillerBlock={recessiveVoidFillerBlock}
            setRecessiveVoidFillerBlock={setRecessiveVoidFillerBlock}
            recessiveVoidFillerShadingDisabled={recessiveVoidFillerShadingDisabled}
            recessiveVoidFillerRequiredCount={recessiveVoidFillerRequiredCount}
            showLateFillerInput={showLateFillerInput}
            suppress2LayerLateFillerBlock={suppress2LayerLateFillerBlock}
            setSuppress2LayerLateFillerBlock={setSuppress2LayerLateFillerBlock}
            lateFillerShadingDisabled={lateFillerShadingDisabled}
            lateFillerRequiredCount={lateFillerRequiredCount}
            formatRequiredCount={formatRequiredCount}
          />
          </div>

          <div className={`${isStackedLayout ? "order-3" : "mt-2"} space-y-2`}>
          {/* Color → Block */}
          <PanelColorBlockTable
            isStackedLayout={isStackedLayout}
            imageValid={imageValid}
            belowPlatformWater={belowPlatformWater}
            hasRequiredCol={hasRequiredCol}
            showUsageInfo={!!paletteUsageInfo && imageValid}
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
            showTransparentRow={showTransparentRow}
            showExcludedBlocks={showExcludedBlocks}
            columnOrder={columnOrder}
            setColumnOrder={setColumnOrder}
            selectedBlocks={preset.selectedBlocks}
            customBlocksByBase={customBlocksByBase}
            usedBaseColors={usedBaseColors}
            usedShadesByBase={usedShadesByBase}
            colorRequiredMap={colorRequiredMap}
            missingBlocks={missingBlocks}
            onUpdateBlock={updateBlock}
            onCopyColorToClipboard={copyColorToClipboard}
            onMinWidthChange={handleColorTableMinWidthChange}
          />

          <PanelCustomColors
            customColors={customColors}
            setCustomColors={setCustomColors}
            customMode={customMode}
            setCustomMode={setCustomMode}
            newCustom={newCustom}
            setNewCustom={setNewCustom}
            addCustomColor={addCustomColor}
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
              missingBlocks={missingBlocks}
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
              showRangeControls={selectedTileAnalysis !== null && (!hasMultipleTiles || selectedTileCount === 1)}
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
        showTransparentRow={showTransparentRow}
        setShowTransparentRow={setShowTransparentRow}
        showExcludedBlocks={showExcludedBlocks}
        setShowExcludedBlocks={setShowExcludedBlocks}
        forceZ129={forceZ129}
        setForceZ129={setForceZ129}
        applySupportFloorYs={applySupportFloorYs}
        setApplySupportFloorYs={setApplySupportFloorYs}
        belowPlatformWater={belowPlatformWater}
        setBelowPlatformWater={setBelowPlatformWater}
        skipEmptySuppressSteps={skipEmptySuppressSteps}
        setSkipEmptySuppressSteps={setSkipEmptySuppressSteps}
        markSuppressLoadSpotsInSchematic={markSuppressLoadSpotsInSchematic}
        setMarkSuppressLoadSpotsInSchematic={setMarkSuppressLoadSpotsInSchematic}
        showAlignmentReminder={showAlignmentReminder}
        setShowAlignmentReminder={setShowAlignmentReminder}
        showNooblineWarnings={showNooblineWarnings}
        setShowNooblineWarnings={setShowNooblineWarnings}
        showVsFillerWarnings={showVsFillerWarnings}
        setShowVsFillerWarnings={setShowVsFillerWarnings}
      />
    </div>
  );
};

// Callers:
// - src/main.tsx
export default Index;
