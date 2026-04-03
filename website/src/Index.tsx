import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue, useLayoutEffect } from "react";
import { Moon, Sun, Plus, Minus, Glasses } from "lucide-react";
import {
  AUTO_SWITCH_TO_SUPPRESS_STEPS_IF_CONTAINS_VOID_SHADOWS,
  DEFAULT_ACTIVE_PRESET_NAME,
  DEFAULT_APPLY_SUPPORT_FLOOR_YS,
  DEFAULT_BELOW_PLATFORM_WATER,
  DEFAULT_BLOCK_COLUMN_EXPANDED,
  DEFAULT_BLOCK_DISPLAY_MODE,
  DEFAULT_BUILD_MODE,
  DEFAULT_BUILD_AT_WORLD_MIN_Y,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_CONVERT_UNSUPPORTED,
  DEFAULT_DARK_WATER_DROP,
  DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK,
  DEFAULT_FLAT_WATER_DROP,
  DEFAULT_FORCE_Z129,
  DEFAULT_LAYER_GAP,
  DEFAULT_LIGHT_WATER_DROP,
  DEFAULT_MARK_SUPPRESS_LOAD_SPOTS_IN_SCHEMATIC,
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
import { DEFAULT_COLOR_ROW_ORDER } from "@/data/colorSortOrder";
import { EXCLUDED_BLOCKS } from "@/data/mapColorsExcluded";
import { BLOCK_ICON_ATLASES } from "@/data/blockIconAtlases";
import { STORAGE_KEYS as LS_KEYS } from "@/data/storageKeys";
import { convertToNbt } from "@/lib/nbtExport";
import { generateShapeMap } from "@/lib/shapeGeneration";
import { convertFileToColorGrid, convertImageToColorGrid } from "@/lib/colorGridParsing";
import {
  computeColorGridStats,
  FlatModeBehavior,
  hasStepMixOpportunity,
  type ColorGridStats,
} from "@/lib/colorGridAnalysis";
import { decodeColorGrid, encodeColorGrid } from "@/lib/codecColorGrid";
import { createImageDataFromColorGrid, getHue, getShadedRgb } from "@/utils/color";
import type { ColorGrid, ColorRgbCustom } from "@/types/color";
import {
  analyzeFragileSupportOverrideNeeds,
  analyzeMaterialNeeds,
  analyzeFillerNeeds,
  hasBuildAtWorldMinYOpportunity,
  hasNonWaterColorHeightVariance as generatedShapeHasNonWaterColorHeightVariance,
  nooblineIsSingleY as generatedShapeNooblineIsSingleY,
} from "@/lib/shapeAnalysis";
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
import { usePreviewVisiblePixelMask, useVsFillerPreviewReplacements } from "@/lib/previewImageEdits";
import { usePreviewImageUrl } from "@/lib/previewImageStore";
import { toBlockIconKey } from "@/lib/blockIconAtlas";
import { getSupportedColorAbove, isShapeFillerCell, isWithinShapeBounds, NO_SUPPORT_FLOORS, parseShapeCoordKey } from "@/lib/shapeModel";
import { type BlockDisplayMode, type ColumnId, SupportMode } from "@/types/ui";
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
import { PanelCustomColors } from "@/components/PanelCustomColors";
import { PanelImagePreview } from "@/components/PanelImagePreview";
import { PackedBlockIcon } from "@/components/PackedBlockIcon";

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
const COLOR_TABLE_HEADER_GROUP_GAP_PX = 6;
type WaterDropShade = typeof WATER_DROP_INPUT_ORDER[number];
type ColumnDropSide = "before" | "after";
type ColumnDragIndicator = { target: ColumnId; side: ColumnDropSide };
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

function reorderColumnOrder(order: ColumnId[], from: ColumnId, target: ColumnId, side: ColumnDropSide): ColumnId[] {
  if (from === target) return order;
  const next = order.filter(col => col !== from);
  const targetIndex = next.indexOf(target);
  if (targetIndex === -1) return order;
  next.splice(targetIndex + (side === "after" ? 1 : 0), 0, from);
  return next;
}

function normalizeColumnDropTarget(
  order: ColumnId[],
  target: ColumnId,
  side: ColumnDropSide,
): ColumnDragIndicator | null {
  const index = order.indexOf(target);
  if (index === -1) return null;
  if (side === "after" && index < order.length - 1) {
    return { target: order[index + 1], side: "before" };
  }
  return { target, side };
}

function wouldReorderColumnOrder(order: ColumnId[], from: ColumnId, indicator: ColumnDragIndicator): boolean {
  const next = reorderColumnOrder(order, from, indicator.target, indicator.side);
  return next.length === order.length && next.some((col, index) => col !== order[index]);
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

type ShapeWarning = {
  text: string;
  invalid: boolean;
};
const DEFAULT_SWATCH_SHADES: Shade[] = [Shade.Light, Shade.Flat, Shade.Dark];
const KNOWN_PRIMARY_ICON_KEYS = new Set(Object.keys(BLOCK_ICON_ATLASES.primary.entries));
const KNOWN_UNUSED_ICON_KEYS = new Set(Object.keys(BLOCK_ICON_ATLASES.unused.entries));

type SortKey = "default" | "name" | "options" | "color" | "id" | "required";
type SortDir = "asc" | "desc";
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
  const [customColors, setCustomColors] = useState<ColorRgbCustom[]>([]);
  const [customMode, setCustomMode] = useState<"custom" | number>("custom");
  const [newCustom, setNewCustom] = useState({ r: "", g: "", b: "", block: "" });
  const [imageData, setImageData] = useState<ImageData | null>(null);
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
  const [sortKey, setSortKey] = useState<SortKey>(() => loadCached(LS_KEYS.sortKey, DEFAULT_SORT_KEY as SortKey));
  const [sortDir, setSortDir] = useState<SortDir>(() => loadCached(LS_KEYS.sortDir, DEFAULT_SORT_DIR as SortDir));
  const [showUnusedColors, setShowUnusedColors] = useState(false);
  const [showStacks, setShowStacks] = useState(() => loadCached(LS_KEYS.showStacks, DEFAULT_MC_UNITS));
  const [isDark, setIsDark] = useState(resolveDarkTheme);
  const [convertUnsupported, /* setConvertUnsupported */] = useState(DEFAULT_CONVERT_UNSUPPORTED); // always on; checkbox commented out
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => loadCached(LS_KEYS.columnOrder, DEFAULT_COLUMN_ORDER));
  const [showTransparentRow, setShowTransparentRow] = useState(() => loadCached(LS_KEYS.showTransparentRow, DEFAULT_SHOW_TRANSPARENT_ROW));
  const [showExcludedBlocks, setShowExcludedBlocks] = useState(() => loadCached(LS_KEYS.showExcludedBlocks, DEFAULT_SHOW_EXCLUDED_BLOCKS));
  const [forceZ129, setForceZ129] = useState(() => loadCached(LS_KEYS.forceZ129, DEFAULT_FORCE_Z129));
  const [applySupportFloorYs, setApplySupportFloorYs] = useState(() => loadCached(LS_KEYS.assumeFloor, DEFAULT_APPLY_SUPPORT_FLOOR_YS));
  const [belowPlatformWater, setBelowPlatformWater] = useState(() => loadCached(LS_KEYS.belowPlatformWater, DEFAULT_BELOW_PLATFORM_WATER));
  const [skipEmptySuppressSteps, setSkipEmptySuppressSteps] = useState(() => loadCached(LS_KEYS.skipEmptySuppressSteps, DEFAULT_SKIP_EMPTY_SUPPRESS_STEPS));
  const [markSuppressLoadSpotsInSchematic, setMarkSuppressLoadSpotsInSchematic] = useState(() => loadCached(LS_KEYS.markSuppressLoadSpotsInSchematic, DEFAULT_MARK_SUPPRESS_LOAD_SPOTS_IN_SCHEMATIC));
  const [showVsFillerWarnings, setShowVsFillerWarnings] = useState(() => loadCached(LS_KEYS.showVsFillerWarnings, DEFAULT_SHOW_VS_FILLER_WARNINGS));
  const [showAlignmentReminder, setShowAlignmentReminder] = useState(() => loadCached(LS_KEYS.showAlignmentReminder, DEFAULT_SHOW_ALIGNMENT_REMINDER));
  const [showNooblineWarnings, setShowNooblineWarnings] = useState(() => loadCached(LS_KEYS.showNooblineWarnings, DEFAULT_SHOW_NOOBLINE_WARNINGS));
  const [showSecretsDialog, setShowSecretsDialog] = useState(false);
  const [decodedColorGrid, setDecodedColorGrid] = useState<ColorGrid | null>(null);
  const parsedImage = useMemo(
    () => decodedColorGrid
      ? {
          imageData: createImageDataFromColorGrid(decodedColorGrid, customColors),
          colorGrid: decodedColorGrid,
          paletteNotices: [],
          hasBlockingIssue: false as const,
        }
      : imageData ? convertImageToColorGrid(imageData, customColors, convertUnsupported) : null,
    [decodedColorGrid, imageData, customColors, convertUnsupported],
  );
  const imageColorGrid = parsedImage?.colorGrid ?? null;
  const imageUsesCustomColors = useMemo(
    () => !!imageColorGrid && imageColorGrid.some(column => column.some(color => color.isCustom)),
    [imageColorGrid],
  );
  const dragColRef = useRef<ColumnId | null>(null);
  const dragColumnIndicatorRef = useRef<ColumnDragIndicator | null>(null);
  const [dragColumnIndicator, setDragColumnIndicator] = useState<ColumnDragIndicator | null>(null);
  const [swatchTooltip, setSwatchTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const swatchTooltipRafRef = useRef<number | null>(null);
  const swatchTooltipPendingRef = useRef<{ text: string; x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blockMeasureSelectRef = useRef<HTMLSelectElement | null>(null);
  const blockHeaderCollapseBtnRef = useRef<HTMLButtonElement | null>(null);
  const [blockMeasureFont, setBlockMeasureFont] = useState("11px monospace");
  const [blockMeasureInsetsPx, setBlockMeasureInsetsPx] = useState(10);
  const [blockTextureCollapsedWidthPx, setBlockTextureCollapsedWidthPx] = useState(44);
  const presetToolbarSectionRef = useRef<HTMLElement>(null);
  const fillerToolbarSectionRef = useRef<HTMLElement>(null);
  const colorTableHeaderRef = useRef<HTMLDivElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const rightColumnRef = useRef<HTMLDivElement>(null);
  const layoutRootRef = useRef<HTMLDivElement>(null);
  const creditsRef = useRef<HTMLDivElement>(null);
  const [presetToolbarMinWidthPx, setPresetToolbarMinWidthPx] = useState(0);
  const [fillerToolbarMinWidthPx, setFillerToolbarMinWidthPx] = useState(0);
  const [colorTableHeaderMinWidthPx, setColorTableHeaderMinWidthPx] = useState(0);
  const [rightColumnMinWidthPx, setRightColumnMinWidthPx] = useState(320);
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
      if (swatchTooltipRafRef.current !== null) {
        cancelAnimationFrame(swatchTooltipRafRef.current);
        swatchTooltipRafRef.current = null;
      }
    },
    [],
  );

  const preset = presets[activeIdx] || getBuiltinPreset(DEFAULT_ACTIVE_PRESET_NAME)!;
  const activePresetBuiltinTooltip = activeIdx < BUILTIN_PRESET_NAMES.length
    ? messages.presets.builtinTooltip(preset.name)
    : undefined;

  const [savedBlocks, setSavedBlocks] = useState<Record<number, string> | null>(null);

  // Compute dirty by comparing current blocks to saved snapshot
  const presetDirty = useMemo(() => {
    if (!savedBlocks) return false;
    const current = preset.blocks;
    const allKeys = new Set([...Object.keys(savedBlocks), ...Object.keys(current)]);
    for (const k of allKeys) {
      if ((savedBlocks[Number(k)] ?? "") !== (current[Number(k)] ?? "")) return true;
    }
    return false;
  }, [preset.blocks, savedBlocks]);
  const currentPresetIsUnsavedAuto = useMemo(
    () => activeIdx >= BUILTIN_PRESET_NAMES.length && isAutoCustomPresetName(preset.name) && presetDirty,
    [activeIdx, preset.name, presetDirty],
  );

  const markSavedDeferred = useCallback(() => {
    setSavedBlocks(null);
    markSavedNextRef.current = true;
  }, []);

  const markSavedImmediate = useCallback(() => {
    setSavedBlocks({ ...preset.blocks });
  }, [preset.blocks]);

  const markSavedNextRef = useRef(true);

  useEffect(() => {
    if (markSavedNextRef.current) {
      setSavedBlocks({ ...preset.blocks });
      markSavedNextRef.current = false;
    }
  }, [preset.blocks]);

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
      [LS_KEYS.assumeFloor]: applySupportFloorYs,
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
    () => (showPaletteSeedToggle && calcProPaletteSeed ? getPaletteSeedOffset(preset.blocks) : 0),
    [showPaletteSeedToggle, calcProPaletteSeed, preset.blocks],
  );
  const imageStats = useMemo(
    () => (imageColorGrid && imageValid ? computeColorGridStats(imageColorGrid) : null),
    [imageColorGrid, imageValid],
  );
  const derivedImageStats = useMemo(() => (imageStats ? deriveImageStats(imageStats) : null), [imageStats]);
  const fullImageUsedShadesByBase = derivedImageStats?.usedShadesByBase ?? new Map<number, Set<Shade>>();
  const usedWaterShades = derivedImageStats?.usedWaterShades ?? new Set<Shade>();
  const imageHasWater = usedWaterShades.size > 0;
  const imageHasNonLightWater = usedWaterShades.has(Shade.Dark) || usedWaterShades.has(Shade.Flat);
  const paletteUsageInfo = derivedImageStats?.paletteUsageInfo ?? null;
  const selectedWaterBlock = preset.blocks[WATER_BASE_INDEX] || BASE_COLORS[WATER_BASE_INDEX].blocks[0] || "";
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
  const activeWaterSetting = useMemo(
    () => {
      if (flatBuildModeSelected) return undefined;
      if (belowPlatformWater && imageHasWater) return { kind: "below-platform", drops: normalizedDeferredWaterDrops } as const;
      if (!belowPlatformWater && usesWaterForWater && imageHasNonLightWater) return { kind: "top-aligned" } as const;
      return undefined;
    },
    [belowPlatformWater, flatBuildModeSelected, imageHasWater, normalizedDeferredWaterDrops, usesWaterForWater, imageHasNonLightWater],
  );
  const activeWaterDrops = activeWaterSetting?.kind === "below-platform" ? activeWaterSetting.drops : undefined;
  const showMixStepsToggle = useMemo(
    () =>
      isSuppressStepsBuildMode(buildMode) &&
      !!imageColorGrid &&
      imageValid &&
      hasStepMixOpportunity(imageColorGrid, {
        waterDrops: activeWaterDrops,
      }),
    [buildMode, imageColorGrid, imageValid, activeWaterDrops],
  );
  const twoLayerHasLateVoidNeed = (imageStats?.voidShadowStats.dominant ?? 0) > 0;
  const activeIncludeTransparency = useMemo(
    () => shouldIncludeTransparentBlocks(preset.blocks, derivedImageStats?.hasTransparency ?? false, buildMode),
    [preset.blocks, derivedImageStats?.hasTransparency, buildMode],
  );
  const isSuppressStepDirectionSelectable = useCallback(
    (direction: SuppressStepDirection) => {
      if (buildMode !== BuildMode.SuppressStepChecker) return false;
      switch (direction) {
        case SuppressStepDirection.EastToWest:
        case SuppressStepDirection.WestToEast:
          return true;
        case SuppressStepDirection.NorthToSouth:
          return (imageStats?.voidShadowStats.dominant ?? 0) === 0;
        case SuppressStepDirection.SouthToNorth:
          return (imageStats?.voidShadowStats.recessive ?? 0) === 0;
      }
    },
    [buildMode, imageStats],
  );
  useEffect(() => {
    if (buildMode !== BuildMode.SuppressStepChecker || isSuppressStepDirectionSelectable(suppressStepDirection)) return;
    setSuppressStepDirection(current => cycleSuppressStepDirection(current, isSuppressStepDirectionSelectable));
  }, [buildMode, suppressStepDirection, isSuppressStepDirectionSelectable]);
  const baseShapeMap = useMemo(
    () => imageColorGrid && imageValid
      ? generateShapeMap(
          imageColorGrid,
          derivedImageStats?.allSameShade,
          imageHasWater,
          derivedImageStats?.hasTransparency ?? false,
          twoLayerHasLateVoidNeed,
          {
          layerGap: calcLayerGap,
          mixSteps: showMixStepsToggle && calcMixSteps,
          includeTransparentBlocks: activeIncludeTransparency,
          paletteSeed: paletteSeedOffset,
          waterSetting: activeWaterSetting,
          enableWaterConvenience: supportMode !== SupportMode.None,
          buildAtWorldMinY: false,
          skipEmptySuppressSteps,
          selectedMode: buildMode,
          selectedStepDirection: suppressStepDirection,
          },
        )
      : null,
    [
      imageColorGrid,
      imageValid,
      calcLayerGap,
      showMixStepsToggle,
      calcMixSteps,
      paletteSeedOffset,
      activeWaterSetting,
      buildMode,
      suppressStepDirection,
      supportMode,
      skipEmptySuppressSteps,
      activeIncludeTransparency,
      derivedImageStats,
      imageHasWater,
      twoLayerHasLateVoidNeed,
    ],
  );
  const hasVoidShadow = ((imageStats?.voidShadowStats.dominant ?? 0) + (imageStats?.voidShadowStats.recessive ?? 0)) > 0;
  const baseNorthlineShape = baseShapeMap?.[BuildMode.StaircaseNorthline] ?? null;
  const flatModeBehavior =
    activeIncludeTransparency
      ? (derivedImageStats?.flatModeBehavior ?? FlatModeBehavior.None)
      : FlatModeBehavior.None;
  const isFlatShape = useMemo(
    () => !!baseNorthlineShape &&
      (
        !generatedShapeHasNonWaterColorHeightVariance(baseNorthlineShape) ||
        flatModeBehavior !== FlatModeBehavior.None
      ),
    [baseNorthlineShape, flatModeBehavior],
  );
  const currentSelectedShape = useMemo(
    () =>
      buildMode === BuildMode.Flat
        ? baseNorthlineShape
        : (baseShapeMap?.[buildMode] ?? null),
    [buildMode, baseNorthlineShape, baseShapeMap],
  );
  const flatBuildAtWorldMinYEligible = useMemo(
    () =>
      !!imageColorGrid &&
      !!baseNorthlineShape &&
      (supportMode === SupportMode.None || applySupportFloorYs) &&
      hasBuildAtWorldMinYOpportunity(imageColorGrid, baseNorthlineShape, applySupportFloorYs),
    [imageColorGrid, baseNorthlineShape, supportMode, applySupportFloorYs],
  );
  const buildAtWorldMinYEligible = useMemo(
    () => {
      if (isFlatShape) return flatBuildAtWorldMinYEligible;
      return !!imageColorGrid &&
        !!currentSelectedShape &&
        isStaircaseBuildMode(buildMode) &&
        (supportMode === SupportMode.None || applySupportFloorYs) &&
        hasBuildAtWorldMinYOpportunity(imageColorGrid, currentSelectedShape, applySupportFloorYs);
    },
    [
      isFlatShape,
      flatBuildAtWorldMinYEligible,
      imageColorGrid,
      currentSelectedShape,
      buildMode,
      supportMode,
      applySupportFloorYs,
    ],
  );
  const showBuildAtWorldMinYToggle = imageValid && buildAtWorldMinYEligible;
  const activeBuildAtWorldMinY = showBuildAtWorldMinYToggle && buildAtWorldMinY;
  const flatRequiresVsFillers =
    flatModeBehavior === FlatModeBehavior.ToggleableBuildAtWorldMinY &&
    !activeBuildAtWorldMinY;
  const lockFlatBuildMode = isFlatShape && !flatRequiresVsFillers;
  const effectiveBuildMode = lockFlatBuildMode ? BuildMode.Flat : buildMode;
  const shapeMap = useMemo(
    () => {
      if (!activeBuildAtWorldMinY || !imageColorGrid || !imageValid) return baseShapeMap;
      return generateShapeMap(
        imageColorGrid,
        derivedImageStats?.allSameShade,
        imageHasWater,
        derivedImageStats?.hasTransparency ?? false,
        twoLayerHasLateVoidNeed,
        {
          layerGap: calcLayerGap,
          mixSteps: showMixStepsToggle && calcMixSteps,
          includeTransparentBlocks: activeIncludeTransparency,
          paletteSeed: paletteSeedOffset,
          waterSetting: activeWaterSetting,
          enableWaterConvenience: supportMode !== SupportMode.None,
          buildAtWorldMinY: true,
          skipEmptySuppressSteps,
          selectedMode: buildMode,
          selectedStepDirection: suppressStepDirection,
        },
      );
    },
    [
      activeBuildAtWorldMinY,
      activeWaterSetting,
      baseShapeMap,
      buildMode,
      calcLayerGap,
      calcMixSteps,
      derivedImageStats,
      imageColorGrid,
      imageHasWater,
      imageValid,
      paletteSeedOffset,
      showMixStepsToggle,
      suppressStepDirection,
      supportMode,
      skipEmptySuppressSteps,
      activeIncludeTransparency,
      twoLayerHasLateVoidNeed,
    ],
  );
  const northlineShape = shapeMap?.[BuildMode.StaircaseNorthline] ?? null;
  const usedBaseColors = derivedImageStats?.usedBaseColors ?? new Set<number>();
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

  const missingBlocks = useMemo(() => {
    if (!imageValid || usedBaseColors.size === 0) return [];
    return [...usedBaseColors].filter(idx => idx > 0 && !preset.blocks[idx]);
  }, [imageValid, usedBaseColors, preset.blocks]);

  const isStepRangeMode = isSuppressStepsBuildMode(effectiveBuildMode);
  const isNorthSouthSuppressStepDirection =
    suppressStepDirection === SuppressStepDirection.NorthToSouth ||
    suppressStepDirection === SuppressStepDirection.SouthToNorth;
  const supportShape = effectiveBuildMode === BuildMode.Flat
    ? northlineShape
    : (shapeMap?.[effectiveBuildMode] ?? null);
  const maxRangeIndex = useMemo(
    () => isStepRangeMode
      ? Math.max(0, (supportShape?.parts.length ?? (getBuildModeRangeMax(effectiveBuildMode) + (belowPlatformWater && imageHasWater ? 1 : 0))) - 1)
      : getBuildModeRangeMax(effectiveBuildMode),
    [effectiveBuildMode, isStepRangeMode, supportShape, belowPlatformWater, imageHasWater],
  );
  const minLayerGap = supportMode === SupportMode.Fragile || supportMode === SupportMode.All ? 3 : 2;
  const enableStepsSupportOption = !imageData || !!supportShape?.parts.some(part =>
      [...part.cells.entries()].some(([coord, cell]) => {
      if (!isShapeFillerCell(cell) || !cell.includes(FillerRole.StairStep)) return false;
      const [x, y, z] = parseShapeCoordKey(coord);
      const supportFloorYs = applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
      return isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs);
    }),
  );
  const enableFragileSupportOption = useMemo(() => {
    const hasFragileMappedBlock = (block: string) => !!block && isFragileBlock(normalizeBlockId(block));
    if (!imageData) {
      return Object.values(preset.blocks).some(hasFragileMappedBlock) || customColors.some(color => hasFragileMappedBlock(color.blocks[0] ?? ""));
    }
    if (!supportShape) return false;
    return supportShape.parts.some(part =>
      [...part.cells.entries()].some(([coord, cell]) => {
        if (!isShapeFillerCell(cell)) return false;
        const [x, y, z] = parseShapeCoordKey(coord);
        const supportFloorYs = applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
        if (!isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs)) return false;
        if (!cell.includes(FillerRole.SupportFragile)) return false;
        const color = getSupportedColorAbove(part, coord);
        if (!color) return false;
        const mapped = color.isCustom
          ? (customColors[color.id]?.blocks[0] ?? "")
          : (preset.blocks[color.id] || BASE_COLORS[color.id].blocks[0] || "");
        return hasFragileMappedBlock(mapped);
      }),
    );
  }, [imageData, supportShape, preset.blocks, customColors, applySupportFloorYs]);
  const staircaseModeOptions = useMemo((): ModeOption[] => {
    if (!shapeMap || !imageValid) {
      return DEFAULT_STAIRCASE_OPTIONS;
    }
    return DEFAULT_STAIRCASE_OPTIONS.filter(option =>
      option.value === BuildMode.Flat ? isFlatShape : !!shapeMap[option.value],
    );
  }, [shapeMap, imageValid, isFlatShape]);

  const suppressModeOptions = useMemo((): ModeOption[] => {
    const visibleModes = new Set(getVisibleSuppressBuildModes(twoLayerHasLateVoidNeed));
    return BASE_SUPPRESS_OPTIONS.filter(option => visibleModes.has(option.value));
  }, [twoLayerHasLateVoidNeed]);
  const showSuppressStepDirectionControl =
    !!imageData &&
    imageValid &&
    !lockFlatBuildMode &&
    isSuppressStepsBuildMode(buildMode);
  const shadingMethodTooltip = messages.buildMode.tooltip(buildMode);
  const supportModeTooltip = messages.supportMode.tooltip(supportMode);
  const toolbarBuildSettingsProps = imageData ? {
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
    (fillerAssignments: FillerAssignment[]) => ({
      blockMapping: preset.blocks,
      fillerAssignments,
      applySupportFloorYs,
      customColors,
      ...(colRangeEnabled ? (isStepRangeMode ? { phaseRange: [colStart, colEnd] as [number, number] } : { xColumnRange: [colStart, colEnd] as [number, number] }) : {}),
    }),
    [preset.blocks, applySupportFloorYs, customColors, colRangeEnabled, isStepRangeMode, colStart, colEnd],
  );

  const materialNeedStats = useMemo(() => {
    if (!supportShape || !imageValid) return null;
    return analyzeMaterialNeeds(imageColorGrid, supportShape, buildMaterialAnalysisOptions(uiFillerAssignments));
  }, [supportShape, imageValid, imageColorGrid, buildMaterialAnalysisOptions, uiFillerAssignments]);
  const fragileSupportOverrideNeedStats = useMemo(() => {
    if (!supportShape || !imageValid || supportMode === SupportMode.None) return null;
    return analyzeFragileSupportOverrideNeeds(supportShape, buildMaterialAnalysisOptions(uiFillerAssignments));
  }, [supportShape, imageValid, supportMode, buildMaterialAnalysisOptions, uiFillerAssignments]);
  const supportModeRoleCounts = useMemo(() => {
    if (!supportShape || !imageValid) return null;

    const analyzeMode = (mode: SupportMode) => {
      const modeUsesDirectWaterSides =
        usesWaterForWater &&
        (mode === SupportMode.All || mode === SupportMode.Water);
      const waterAvailabilitySupportFiller =
        modeUsesDirectWaterSides && !supportWaterSidesFillerValid
          ? (BASE_COLORS[TRANSPARENCY_BASE_INDEX].blocks[0] || effectiveSupportFillerBlock)
          : effectiveSupportFillerBlock;
      const shouldReuseCurrentStats =
        mode === supportMode &&
        materialNeedStats &&
        !(modeUsesDirectWaterSides && !supportWaterSidesFillerValid);
      if (shouldReuseCurrentStats) return materialNeedStats.fillerRoleCounts;
      return analyzeMaterialNeeds(imageColorGrid, supportShape, buildMaterialAnalysisOptions(
        createFillerAssignments(
          waterAvailabilitySupportFiller,
          effectiveShadeFillerBlock,
          effectiveDominateVoidFillerBlock,
          effectiveRecessiveVoidFillerBlock,
          effectiveSuppress2LayerLateFillerBlock,
          mode,
          usesWaterForWater,
          usesIceForWater,
        ),
      )).fillerRoleCounts;
    };

    return {
      [SupportMode.All]: analyzeMode(SupportMode.All),
      [SupportMode.Water]: analyzeMode(SupportMode.Water),
    };
  }, [
    supportShape,
    imageValid,
    imageColorGrid,
    buildMaterialAnalysisOptions,
    supportMode,
    materialNeedStats,
    effectiveSupportFillerBlock,
    effectiveShadeFillerBlock,
    effectiveDominateVoidFillerBlock,
    effectiveRecessiveVoidFillerBlock,
    effectiveSuppress2LayerLateFillerBlock,
    usesWaterForWater,
    usesIceForWater,
    supportWaterSidesFillerValid,
  ]);
  const getSupportModeRoleCount = useCallback(
    (mode: SupportMode, ...roles: FillerRole[]) =>
      roles.reduce((sum, role) => sum + (supportModeRoleCounts?.[mode]?.get(role) ?? 0), 0),
    [supportModeRoleCounts],
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
    SupportMode.All,
    ...allSupportRoles,
  ) > 0;
  const enableWaterSupportOption = !imageData || getSupportModeRoleCount(
    SupportMode.Water,
    ...waterSupportRoles,
  ) > 0;
  const showSupportModeSelector = !imageData || (
    enableAllSupportOption ||
    enableStepsSupportOption ||
    enableWaterSupportOption ||
    (!supportFillerIsFragile && enableFragileSupportOption)
  );
  const materialCounts = materialNeedStats?.blockCounts ?? null;
  const numUniqueColorShadesForPart = materialNeedStats?.numUniqueColorShadesForPart ?? (paletteUsageInfo?.uniqueShadeCount ?? 0);
  const usedShadesByBase = materialNeedStats?.usedShadesByBase ?? fullImageUsedShadesByBase;
  const formatRequiredCount = (count: number) => (showStacks ? formatStacks(count) : count);
  const colorRequiredMap = materialNeedStats?.baseColorCounts ?? ({} as Record<number, number>);
  const [rebaneRolePrefix, rebaneRoleSuffix] = messages.credits.rebaneRoleParts();
  const numColorBlockTypesForPart = Object.values(colorRequiredMap).filter(count => count > 0).length;

  const builtinPreset = getBuiltinPreset(preset.name);
  const isBuiltinUnedited = builtinPreset ? arePresetBlocksEqual(builtinPreset.blocks, preset.blocks) : false;

  useEffect(() => {
    const clampedStart = Math.max(0, Math.min(colStart, maxRangeIndex));
    const clampedEnd = Math.max(clampedStart, Math.min(colEnd, maxRangeIndex));
    if (clampedStart !== colStart) setColStart(clampedStart);
    if (clampedEnd !== colEnd) setColEnd(clampedEnd);
  }, [colStart, colEnd, maxRangeIndex]);

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
        setImageName(messages.upload.sharedImageName);
        setImageValid(true);
        setPaletteNotices([]);
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
  }, []);

  // Auto-select mode when image changes
  useEffect(() => {
    if (!imageData) {
      autoSelectedImageRef.current = null;
      return;
    }
    if (!imageValid || autoSelectedImageRef.current === imageData) return;
    autoSelectedImageRef.current = imageData;
    if (isFlatShape) setBuildMode(BuildMode.Flat);
    else if (AUTO_SWITCH_TO_SUPPRESS_STEPS_IF_CONTAINS_VOID_SHADOWS && hasVoidShadow) {
      setBuildMode(prev => isStaircaseBuildMode(prev) ? BuildMode.SuppressStepChecker : prev);
      if (isStaircaseBuildMode(buildMode)) {
        setSuppressStepDirection(SuppressStepDirection.EastToWest);
      }
    }
    else setBuildMode(prev => prev === BuildMode.Flat ? BuildMode.StaircaseClassic : prev);
  }, [imageData, imageValid, isFlatShape, hasVoidShadow, buildMode]);

  useEffect(() => {
    if (!imageData || lockFlatBuildMode) return;
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
  }, [imageData, lockFlatBuildMode, buildMode, staircaseModeOptions, suppressModeOptions]);

  useEffect(() => {
    if (!imageData) return;
    if (supportMode === SupportMode.All && !enableAllSupportOption) { setSupportMode(SupportMode.None); return; }
    if (supportMode === SupportMode.Fragile && (supportFillerIsFragile || !enableFragileSupportOption)) { setSupportMode(SupportMode.None); return; }
    if (supportMode === SupportMode.Steps && !enableStepsSupportOption) setSupportMode(SupportMode.None);
    if (supportMode === SupportMode.Water && !enableWaterSupportOption) setSupportMode(SupportMode.None);
  }, [imageData, enableAllSupportOption, enableStepsSupportOption, enableFragileSupportOption, enableWaterSupportOption, supportMode, supportFillerIsFragile]);

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

  const sortedIndices = useMemo(() => {
    const base = showTransparentRow ? [0, ...DEFAULT_COLOR_ROW_ORDER] : [...DEFAULT_COLOR_ROW_ORDER];
    if (sortKey === "default") return base;
    const dir = sortDir === "asc" ? 1 : -1;
    const sorters: Record<string, (a: number, b: number) => number> = {
      name: (a, b) =>
        dir * BASE_COLORS[a].name.localeCompare(BASE_COLORS[b].name),
      options: (a, b) => dir * (BASE_COLORS[a].blocks.length - BASE_COLORS[b].blocks.length),
      color: (a, b) =>
        dir *
        (getHue(BASE_COLORS[a].r, BASE_COLORS[a].g, BASE_COLORS[a].b) -
          getHue(BASE_COLORS[b].r, BASE_COLORS[b].g, BASE_COLORS[b].b)),
      id: (a, b) => dir * (a - b),
      required: (a, b) => dir * ((colorRequiredMap[a] || 0) - (colorRequiredMap[b] || 0)),
    };
    return sorters[sortKey] ? base.sort(sorters[sortKey]) : base;
  }, [sortKey, sortDir, colorRequiredMap, showTransparentRow]);

  const { usedIndices, unusedIndices } = useMemo(() => {
    if (!imageValid || usedBaseColors.size === 0) return { usedIndices: sortedIndices, unusedIndices: [] as number[] };
    return {
      usedIndices: sortedIndices.filter(i => usedBaseColors.has(i)),
      unusedIndices: sortedIndices.filter(i => !usedBaseColors.has(i)),
    };
  }, [sortedIndices, imageValid, usedBaseColors]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      sortDir === "asc" ? setSortDir("desc") : (setSortKey("default"), setSortDir("asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const updateBlock = (baseIndex: number, block: string) => {
    const nextBlock = sanitizeUserBlockEntry(block);
    const currentBlock = preset.blocks[baseIndex] ?? "";
    if (nextBlock === currentBlock) return;

    const isBuiltin = activeIdx < BUILTIN_PRESET_NAMES.length;
    const nextBlocks = { ...preset.blocks, [baseIndex]: nextBlock };
    const matchingBuiltinName = findMatchingBuiltinPresetName(nextBlocks);

    if (isBuiltin) {
      // Spawn a new "Custom" preset instead of mutating the builtin
      setSavedBlocks({ ...preset.blocks });
      setPresets(prev => {
        let customName: string = messages.presets.customGroupLabel;
        const existingNames = new Set(prev.map(p => p.name));
        let suffix = 2;
        while (existingNames.has(customName)) {
          customName = `Custom ${suffix++}`;
        }
        return [...prev, { name: customName, blocks: nextBlocks }];
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
      n[activeIdx] = { ...n[activeIdx], blocks: nextBlocks };
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
        next[activeIdx] = { name, blocks: { ...preset.blocks } };
        return next;
      });
      setActiveIdx(activeIdx);
    } else {
      setPresets(prev => [...prev, { name, blocks: { ...preset.blocks } }]);
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
    setDecodedColorGrid(null);
    setImageData(null);
    setImageName("");
    setImageValid(false);
    setPaletteNotices([]);
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

  const handleFile = useCallback(
    (file: File) => {
      setDecodedColorGrid(null);
      setPaletteNotices([]);
      convertFileToColorGrid(file, customColors, convertUnsupported)
        .then(analysis => {
        const paletteNotices =
          isLikelyLossyImageFile(file) && analysis.paletteNotices.some(notice => notice.kind === PaletteNoticeKind.ConvertedPaletteColors)
            ? [
                ...analysis.paletteNotices,
                messages.parsing.lossyFormatHintNotice(getLossyImageFormatLabel(file)),
              ]
            : analysis.paletteNotices;
        if (analysis.hasBlockingIssue) {
          setDecodedColorGrid(null);
          setImageData(null);
          setImageName("");
          setImageValid(false);
          setPaletteNotices(paletteNotices);
          if (fileRef.current) fileRef.current.value = "";
          return;
        }
        setImageData(analysis.imageData);
        setImageName(file.name);
        setImageValid(true);
        setPaletteNotices(paletteNotices);
        setShowUnusedColors(false);
        if (sortKey === "default") {
          setSortKey("required");
          setSortDir("desc");
        }
        })
        .catch((err: unknown) => {
          setDecodedColorGrid(null);
          setImageData(null);
          setImageName("");
          setImageValid(false);
          setPaletteNotices([messages.parsing.errorNotice((err as Error)?.message || messages.parsing.genericDecodeFailure)]);
          if (fileRef.current) fileRef.current.value = "";
        });
    },
    [customColors, convertUnsupported, getLossyImageFormatLabel, isLikelyLossyImageFile, preset.blocks],
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
    if (!supportShape) return;
    setConverting(true);
    try {
      const baseName = imageName.replace(/\.[^/.]+$/, "");
      const result = await convertToNbt(supportShape, {
        blockMapping: preset.blocks,
        fillerAssignments: uiFillerAssignments,
        applySupportFloorYs,
        forceZ129,
        customColors,
        baseName,
        buildMode: effectiveBuildMode,
        suppressStepDirection,
        markSuppressLoadSpotsInSchematic,
      });
      const suffix = getBuildModeDownloadSuffix(buildMode, suppressStepDirection);
      const ext = result.isZip ? "zip" : "nbt";
      const mime = result.isZip ? "application/zip" : "application/octet-stream";
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(new Blob([result.data.buffer as ArrayBuffer], { type: mime })),
        download: `${baseName}${suffix}.${ext}`,
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

  const toggleTheme = () => {
    const next = isDark ? "light" : "dark";
    const systemTheme = getSystemPrefersDark() ? "dark" : "light";
    if (next === systemTheme) localStorage.removeItem(LS_KEYS.theme);
    else localStorage.setItem(LS_KEYS.theme, next);
    document.documentElement.classList.toggle("dark", next === "dark");
    setIsDark(next === "dark");
  };

  const fillerNeedStats = useMemo(
    () => supportShape ? analyzeFillerNeeds(supportShape) : null,
    [supportShape],
  );
  const northRowSingleLine = useMemo(
    () => supportShape ? generatedShapeNooblineIsSingleY(supportShape) : true,
    [supportShape],
  );

  const canGenerate = imageValid && missingBlocks.length === 0;
  const hasRequiredCol = materialNeedStats !== null;
  const northRowFillerCount = fillerNeedStats?.roleCounts.get(FillerRole.ShadeNorthRow) ?? 0;
  const suppressFillerCount = fillerNeedStats?.roleCounts.get(FillerRole.ShadeSuppress) ?? 0;
  const lateSuppressFillerCount = fillerNeedStats?.roleCounts.get(FillerRole.ShadeSuppressLate) ?? 0;
  const getRequiredFillerRoleCount = useCallback(
    (...roles: FillerRole[]) => roles.reduce((sum, role) => sum + (materialNeedStats?.fillerRoleCounts.get(role) ?? 0), 0),
    [materialNeedStats],
  );
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
    getSupportModeRoleCount(supportMode, FillerRole.SupportWaterSides) > 0 &&
    !supportWaterSidesFillerValid;
  const supportFillerRequiredCount = getRequiredFillerRoleCount(...activeSupportRoles);
  const hasInGridFillerNeed = suppressFillerCount + lateSuppressFillerCount > 0;
  const inGridShadingCountsAsWarning = hasInGridFillerNeed && isSuppressBuildMode(effectiveBuildMode);
  const hasComplexNorthNeed = northRowFillerCount > 0 && (showNooblineWarnings || !northRowSingleLine);
  const showNoFillerWarning =
    imageValid &&
    ((inGridShadingCountsAsWarning && shadeFillerShadingDisabled) || (hasComplexNorthNeed && shadeFillerShadingDisabled));
  const showLateFillerInput =
    !!imageData &&
    buildMode === BuildMode.Suppress2LayerLateFillers &&
    lateFillerRequiredCount > 0;
  const showSupportFillerInput =
    supportMode !== SupportMode.None &&
    (!imageData || supportFillerRequiredCount > 0 || showWaterSideSupportWarning);
  const showShadeFillerInput = !!imageData && shadeFillerRequiredCount > 0;
  const shadeFillerIsNorthRowOnly = northRowFillerCount > 0 && suppressFillerCount === 0;
  const showDominateVoidFillerInput =
    !!imageData &&
    dominateVoidFillerRequiredCount > 0;
  const showRecessiveVoidFillerInput =
    !!imageData &&
    recessiveVoidFillerRequiredCount > 0;
  const previewXColumnRange = useMemo<[number, number] | undefined>(
    () => (colRangeEnabled && !isStepRangeMode ? [colStart, colEnd] : undefined),
    [colRangeEnabled, isStepRangeMode, colStart, colEnd],
  );
  const previewPhaseRange = useMemo<[number, number] | undefined>(
    () => (colRangeEnabled && isStepRangeMode ? [colStart, colEnd] : undefined),
    [colRangeEnabled, isStepRangeMode, colStart, colEnd],
  );
  const previewVsFillerReplacements = useVsFillerPreviewReplacements({
    shape: supportShape,
    shadeFillerBlock,
    dominateVoidFillerBlock,
    recessiveVoidFillerBlock,
    xColumnRange: previewXColumnRange,
  });
  const previewVisiblePixelMask = usePreviewVisiblePixelMask({
    shape: previewPhaseRange ? supportShape : null,
    phaseRange: previewPhaseRange,
  });
  const showVsFillersInPreviewToggle = previewVsFillerReplacements.length > 0;
  const previewImageUrl = usePreviewImageUrl({
    imageData,
    pixelReplacements: showVsFillersInPreview ? previewVsFillerReplacements : undefined,
    xColumnRange: previewXColumnRange,
    visiblePixelMask: previewPhaseRange ? previewVisiblePixelMask : undefined,
  });
  const canCopyImageShareUrl = !!imageColorGrid && imageValid;
  const presetPrimaryActionLabel = presetDirty ? messages.common.save : messages.common.share;
  const presetPrimaryActionTitle = presetDirty ? messages.presets.saveTitle : messages.presets.shareTitle;
  const showNorthRowAlignmentInfo =
    showAlignmentReminder &&
    canGenerate &&
    (forceZ129 || (!shadeFillerShadingDisabled && northRowFillerCount > 0));
  const noFillerWarning = useMemo(() => {
    if (!showNoFillerWarning || !fillerNeedStats) return null;
    const parts: string[] = [];
    if (northRowFillerCount > 0 && (showNooblineWarnings || !northRowSingleLine)) {
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
    fillerNeedStats,
    hasInGridFillerNeed,
    lateSuppressFillerCount,
    northRowFillerCount,
    northRowSingleLine,
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
      dominateVoidFillerRequiredCount,
    );
    const recessive = makeEntry(
      showRecessiveVoidFillerInput,
      messages.fillers.recessiveVoidWarningLabel,
      recessiveVoidFillerBlock,
      recessiveVoidFillerRequiredCount,
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
    dominateVoidFillerRequiredCount,
    recessiveVoidFillerRequiredCount,
  ]);
  const lateFillerWarning = useMemo<ShapeWarning | null>(() => {
    if (!showLateFillerInput || lateFillerRequiredCount <= 0 || !lateFillerShadingDisabled) return null;
    const value = suppress2LayerLateFillerBlock.trim() || effectiveShadeFillerBlock;
    return {
      text: messages.preview.lateFillerInvalid(value, lateFillerRequiredCount),
      invalid: true,
    };
  }, [
    showLateFillerInput,
    lateFillerRequiredCount,
    lateFillerShadingDisabled,
    suppress2LayerLateFillerBlock,
    effectiveShadeFillerBlock,
  ]);

  const requiredColWidth = useMemo(() => {
    if (!materialCounts) return 70;
    const maxLen = Math.max(
      0,
      ...Object.values(colorRequiredMap)
        .filter(c => c > 0)
        .map(c => (showStacks ? formatStacks(c) : String(c)).length),
    );
    // Keep a small right inset so values don't touch the required-column outline.
    return Math.max(70, maxLen * 6 + 16);
  }, [materialCounts, colorRequiredMap, showStacks]);

  const visibleColumns = useMemo(
    () =>
      columnOrder.filter(c => {
        if (c === "id" && !showIds) return false;
        if (c === "name" && !showNames) return false;
        if (c === "options" && !showOptions) return false;
        if (c === "required" && !hasRequiredCol) return false;
        return true;
      }),
    [columnOrder, showIds, showNames, showOptions, hasRequiredCol],
  );

  const longestBlockName = useMemo(() => {
    let longest: string = messages.common.none;
    for (let idx = 0; idx < BASE_COLORS.length; ++idx) {
      const excluded = showExcludedBlocks ? EXCLUDED_BLOCKS[idx] ?? [] : [];
      const extra = customBlocksByBase[idx] || [];
      for (const b of BASE_COLORS[idx].blocks) if (b.length > longest.length) longest = b;
      for (const b of excluded) if (b.length > longest.length) longest = b;
      for (const b of extra) if (b.length > longest.length) longest = b;
      const selected = preset.blocks[idx] || "";
      if (selected.length > longest.length) longest = selected;
    }
    return longest;
  }, [customBlocksByBase, preset.blocks, showExcludedBlocks]);

  useLayoutEffect(() => {
    const el = blockMeasureSelectRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    if (cs.font) setBlockMeasureFont(cs.font);
    const insets =
      parseFloat(cs.paddingLeft || "0") +
      parseFloat(cs.paddingRight || "0") +
      parseFloat(cs.borderLeftWidth || "0") +
      parseFloat(cs.borderRightWidth || "0");
    if (Number.isFinite(insets) && insets >= 0) setBlockMeasureInsetsPx(insets);
  }, [isDark, showIds, showNames, showOptions, buildMode, imageData]);

  const blockColMinWidthPx = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.font = blockMeasureFont;
    const textWidth = ctx ? ctx.measureText(longestBlockName).width : longestBlockName.length * 6.15;
    const trimmedInsetsPx = Math.max(0, blockMeasureInsetsPx);
    return Math.ceil(textWidth + trimmedInsetsPx);
  }, [longestBlockName, blockMeasureFont, blockMeasureInsetsPx]);

  useLayoutEffect(() => {
    const btn = blockHeaderCollapseBtnRef.current;
    if (!btn) return;
    const measure = () => {
      const w = Math.ceil(btn.getBoundingClientRect().width) + 2;
      if (Number.isFinite(w) && w > 0) {
        setBlockTextureCollapsedWidthPx(prev => (Math.abs(prev - w) > 1 ? w : prev));
      }
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(btn);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [isDark, blockColExpanded, blockDisplayMode, showIds, showNames, showOptions, columnOrder]);

  const colorTableMinWidthPx = useMemo(() => {
    const textureCollapsed = blockDisplayMode === "textures" && !blockColExpanded;
    const blockColWidthPx = textureCollapsed ? blockTextureCollapsedWidthPx : blockColMinWidthPx;
    const sectionInsetsPx = 8 * 2 + 1 * 2;
    // 6 columns + 5 grid gaps (`gap-1` = 4px).
    const fixedColsPx = 24 + 24 + 135 + 48 + requiredColWidth;
    const gapsPx = 5 * 4;
    const gridMinWidthPx = fixedColsPx + blockColWidthPx + gapsPx + sectionInsetsPx;
    return Math.max(
      gridMinWidthPx,
      colorTableHeaderMinWidthPx + COLOR_TABLE_HEADER_GROUP_GAP_PX + sectionInsetsPx,
    );
  }, [
    blockColMinWidthPx,
    blockTextureCollapsedWidthPx,
    requiredColWidth,
    blockDisplayMode,
    blockColExpanded,
    colorTableHeaderMinWidthPx,
  ]);

  const effectiveBlockColWidthPx = useMemo(
    () => (blockDisplayMode === "textures" && !blockColExpanded ? blockTextureCollapsedWidthPx : blockColMinWidthPx),
    [blockDisplayMode, blockColExpanded, blockColMinWidthPx, blockTextureCollapsedWidthPx],
  );

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

  const measureToolbarMinWidths = useCallback(() => {
    const presetEl = presetToolbarSectionRef.current;
    const fillerEl = fillerToolbarSectionRef.current;
    const colorTableHeaderEl = colorTableHeaderRef.current;
    const presetMeasured = presetEl ? measureNoWrapSectionWidth(presetEl) : 0;
    const fillerMeasured = fillerEl ? measureNoWrapSectionWidth(fillerEl) : 0;
    const colorTableHeaderMeasured = colorTableHeaderEl ? measureNoWrapSectionWidth(colorTableHeaderEl) : 0;
    setPresetToolbarMinWidthPx(prev => (Math.abs(prev - presetMeasured) > 1 ? presetMeasured : prev));
    setFillerToolbarMinWidthPx(prev => (Math.abs(prev - fillerMeasured) > 1 ? fillerMeasured : prev));
    setColorTableHeaderMinWidthPx(prev => (Math.abs(prev - colorTableHeaderMeasured) > 1 ? colorTableHeaderMeasured : prev));
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
    if (isStackedLayout) return;
    const rightCol = rightColumnRef.current;
    if (!rightCol) return;
    const min = parseFloat(getComputedStyle(rightCol).minWidth || "0");
    if (Number.isFinite(min) && min > 0) {
      setRightColumnMinWidthPx(prev => (Math.abs(prev - min) > 1 ? min : prev));
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
    if (colorTableHeaderRef.current) ro?.observe(colorTableHeaderRef.current);
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
    usedIndices.length,
    unusedIndices.length,
    showUnusedColors,
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
      const threshold = Math.ceil(leftColumnMinWidthPx + rightColumnMinWidthPx + gap);
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
    if (rightColumnRef.current) ro?.observe(rightColumnRef.current);
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [
    leftColumnMinWidthPx,
    rightColumnMinWidthPx,
    isStackedLayout,
    colorTableMinWidthPx,
    presetToolbarMinWidthPx,
    fillerToolbarMinWidthPx,
    imageData,
    buildMode,
  ]);

  const colWidthMap: Record<ColumnId, string> = {
    clr: "24px", id: "24px", name: "135px",
    block: blockColExpanded ? `minmax(${effectiveBlockColWidthPx}px,1fr)` : `${effectiveBlockColWidthPx}px`,
    options: "48px",
    required: `${requiredColWidth}px`
  };
  const gridColsStyle: React.CSSProperties = {
    gridTemplateColumns: visibleColumns.map(c => colWidthMap[c]).join(" "),
  };

  const updateDragColumnIndicator = useCallback((next: ColumnDragIndicator | null) => {
    dragColumnIndicatorRef.current = next;
    setDragColumnIndicator(prev =>
      prev?.target === next?.target && prev?.side === next?.side ? prev : next,
    );
  }, []);

  const commitColumnReorder = useCallback((from: ColumnId, indicator: ColumnDragIndicator) => {
    setColumnOrder(prev =>
      wouldReorderColumnOrder(prev, from, indicator)
        ? reorderColumnOrder(prev, from, indicator.target, indicator.side)
        : prev,
    );
  }, []);

  const colDragProps = (col: ColumnId) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dragColRef.current = col;
      updateDragColumnIndicator(null);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", col);
    },
    onDragOver: (e: React.DragEvent) => {
      const from = dragColRef.current;
      if (!from) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const side: ColumnDropSide = e.clientX >= rect.left + rect.width / 2 ? "after" : "before";
      const normalized = normalizeColumnDropTarget(columnOrder, col, side);
      const nextIndicator = normalized && wouldReorderColumnOrder(columnOrder, from, normalized)
        ? normalized
        : null;
      updateDragColumnIndicator(nextIndicator);
    },
    onDragEnd: () => {
      const from = dragColRef.current;
      const indicator = dragColumnIndicatorRef.current;
      if (from && indicator) {
        commitColumnReorder(from, indicator);
      }
      dragColRef.current = null;
      updateDragColumnIndicator(null);
    },
  });

  const getAllBlocks = (idx: number) => {
    const excluded = showExcludedBlocks ? EXCLUDED_BLOCKS[idx] ?? [] : [];
    const extra = customBlocksByBase[idx] || [];
    const selected = preset.blocks[idx] || "";
    const withExcluded = [
      ...BASE_COLORS[idx].blocks,
      ...excluded.filter(eb => !BASE_COLORS[idx].blocks.includes(eb)),
    ];
    const withCustom = [...withExcluded, ...extra.filter(eb => !withExcluded.includes(eb))];
    return selected && !withCustom.includes(selected) ? [...withCustom, selected] : withCustom;
  };
  const getNameBlocks = (blocks: string[]): string[] => [...blocks].sort();
  const getTextureBlocks = (blocks: string[]): string[] => blocks;

  const pad2 = (n: number) => String(n).padStart(2, "\u2007");

  const getColorSwatchShades = useCallback((idx: number): Shade[] => {
    if (!imageData || !imageValid) return DEFAULT_SWATCH_SHADES;
    const used = usedShadesByBase.get(idx);
    if (!used || used.size === 0) return DEFAULT_SWATCH_SHADES;
    return [...used].sort((a, b) => b - a) as Shade[];
  }, [imageData, imageValid, usedShadesByBase]);

  const getColorSwatchStyle = useCallback((idx: number): React.CSSProperties => {
    const shades = getColorSwatchShades(idx);
    if (shades.length <= 1) {
      const shade = shades[0] ?? Shade.Light;
      const [r, g, b] = getShadedRgb({ id: idx, shade });
      return { backgroundColor: `rgb(${r},${g},${b})` };
    }

    const stops: string[] = [];
    for (let i = 0; i < shades.length; ++i) {
      const shade = shades[i];
      const [r, g, b] = getShadedRgb({ id: idx, shade });
      const color = `rgb(${r},${g},${b})`;
      const start = (i * 100) / shades.length;
      const end = ((i + 1) * 100) / shades.length;
      stops.push(`${color} ${start}%`, `${color} ${end}%`);
    }
    return { backgroundImage: `linear-gradient(to bottom, ${stops.join(", ")})` };
  }, [getColorSwatchShades]);

  const getBlockIconAsset = useCallback(
    (block: string) => {
      const atlasKey = toBlockIconKey(block);
      if (KNOWN_UNUSED_ICON_KEYS.has(atlasKey)) {
        return {
          atlasKey,
          atlasName: "unused" as const,
          fallbackSrc: `${import.meta.env.BASE_URL}block-icons/unused/${atlasKey}.png`,
        };
      }
      return {
        atlasKey,
        atlasName: "primary" as const,
        fallbackSrc: `${import.meta.env.BASE_URL}block-icons/primary/${atlasKey}.png`,
      };
    },
    [],
  );

  const getShadeTooltip = (idx: number, shade: Shade): string => {
    const [r, g, b] = getShadedRgb({ id: idx, shade });
    const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`;
    return messages.swatches.shadeTooltip(hex, shade);
  };

  const queueSwatchTooltip = useCallback((next: { text: string; x: number; y: number } | null) => {
    swatchTooltipPendingRef.current = next;
    if (swatchTooltipRafRef.current !== null) return;
    swatchTooltipRafRef.current = requestAnimationFrame(() => {
      swatchTooltipRafRef.current = null;
      const pending = swatchTooltipPendingRef.current;
      setSwatchTooltip(prev => {
        if (!pending && !prev) return prev;
        if (!pending || !prev) return pending;
        if (
          pending.text === prev.text &&
          Math.abs(pending.x - prev.x) < 0.5 &&
          Math.abs(pending.y - prev.y) < 0.5
        ) {
          return prev;
        }
        return pending;
      });
    });
  }, []);

  const getSwatchShadeAtPointer = useCallback((e: React.MouseEvent<HTMLDivElement>, swatchShades: Shade[]): Shade => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = Math.min(rect.height - 0.001, Math.max(0, e.clientY - rect.top));
    const bandHeight = rect.height / swatchShades.length;
    const bandIndex = Math.min(swatchShades.length - 1, Math.max(0, Math.floor(y / bandHeight)));
    return swatchShades[bandIndex] ?? swatchShades[0] ?? Shade.Light;
  }, []);

  const handleSwatchTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>, idx: number, swatchShades: Shade[]) => {
    const shade = getSwatchShadeAtPointer(e, swatchShades);
    queueSwatchTooltip({
      text: getShadeTooltip(idx, shade),
      x: e.clientX + 12,
      y: e.clientY + 12,
    });
  }, [getShadeTooltip, getSwatchShadeAtPointer, queueSwatchTooltip]);

  const renderColorRow = (idx: number) => {
    const color = BASE_COLORS[idx];
    const swatchShades = getColorSwatchShades(idx);
    const isMissing = missingBlocks.includes(idx);
    const allBlocks = getAllBlocks(idx);
    const nameBlocks = getNameBlocks(allBlocks);
    const textureBlocks = getTextureBlocks(allBlocks);
    const selectedBlock = preset.blocks[idx] || "";
    const selectedIsIceWater = idx === WATER_BASE_INDEX && normalizeBlockId(selectedBlock) === "ice";
    const textureCollapsed = blockDisplayMode === "textures" && !blockColExpanded;
    const reqCount = colorRequiredMap[idx] || 0;
    const cells: Record<ColumnId, React.ReactNode> = {
      clr: (
        idx === 0 ? (
          <div
            key="clr"
            className="w-5 h-5 rounded border border-border transition-shadow"
            onMouseEnter={e =>
              queueSwatchTooltip({
                text: messages.swatches.transparent,
                x: e.clientX + 12,
                y: e.clientY + 12,
              })
            }
            onMouseMove={e =>
              queueSwatchTooltip({
                text: messages.swatches.transparent,
                x: e.clientX + 12,
                y: e.clientY + 12,
              })
            }
            onMouseLeave={() => queueSwatchTooltip(null)}
          >
              <PackedBlockIcon
                atlasKey="world_border"
                atlasName="primary"
                fallbackSrc={`${import.meta.env.BASE_URL}block-icons/primary/world_border.png`}
                alt={messages.swatches.transparent}
                className="w-full h-full"
              />
          </div>
        ) : (
          <div
            key="clr"
            className="w-5 h-5 rounded border border-border cursor-pointer hover:ring-1 hover:ring-primary/50 transition-shadow"
            style={getColorSwatchStyle(idx)}
            onMouseEnter={e => handleSwatchTooltip(e, idx, swatchShades)}
            onMouseMove={e => handleSwatchTooltip(e, idx, swatchShades)}
            onMouseLeave={() => queueSwatchTooltip(null)}
            onClick={e => {
              const shade = getSwatchShadeAtPointer(e, swatchShades);
              const [r, g, b] = getShadedRgb({ id: idx, shade });
              copyColorToClipboard(r, g, b);
            }}
          />
        )
      ),
      id: (
        <span key="id" className="text-[10px] font-mono text-muted-foreground text-center tabular-nums -ml-[0.3em]">
          {pad2(idx)}
        </span>
      ),
      name: (
        <span
          key="name"
          className="text-[10px] font-mono text-muted-foreground truncate"
        >
          {color.name}
        </span>
      ),
      block: (
        blockDisplayMode === "names" ? (
          <select
            key="block"
            ref={idx === usedIndices[0] ? blockMeasureSelectRef : undefined}
            className={`bg-input border rounded px-1 h-6 text-[11px] font-mono text-foreground min-w-0 w-full ${
              selectedIsIceWater ? "border-warning/60 bg-warning/10" : "border-border"
            }`}
            value={preset.blocks[idx] || ""}
            onChange={e => updateBlock(idx, e.target.value)}
            title={
              selectedBlock
                ? selectedIsIceWater
                  ? messages.blocks.iceWaterOptionTitle(selectedBlock)
                  : selectedBlock
                : undefined
            }
          >
            <option value="">{messages.common.none}</option>
            {nameBlocks.map(b => (
              <option
                key={b}
                value={b}
                title={idx === WATER_BASE_INDEX && normalizeBlockId(b) === "ice" ? messages.blocks.iceWaterOptionTitle(b) : b}
              >
                {b}
              </option>
            ))}
          </select>
        ) : (
          <div key="block" className="min-w-0 h-6">
            <div
              className={`flex items-center gap-0.5 h-6 min-w-0 overflow-y-hidden px-0.5 ${
                textureCollapsed ? "justify-center" : ""
              } ${
                textureCollapsed ? "overflow-x-hidden" : "overflow-x-auto"
              }`}
            >
              {(!textureCollapsed || selectedBlock === "") && (
                <button
                  type="button"
                  className={`shrink-0 w-5 h-5 rounded border text-[10px] leading-none ${
                    textureCollapsed
                      ? "border-border text-muted-foreground"
                      : selectedBlock === ""
                      ? "border-transparent text-foreground shadow-[0_0_0_2px_hsl(var(--primary))]"
                      : "border-border text-muted-foreground hover:text-foreground hover:shadow-[0_0_0_1px_hsl(var(--primary))]"
                  }`}
                  title={messages.common.none}
                  onClick={() => updateBlock(idx, "")}
                >
                  {messages.common.clearSelectionSymbol}
                </button>
              )}
              {(textureCollapsed
                ? (selectedBlock !== "" ? [selectedBlock] : [])
                : textureBlocks
              ).map(b => {
                const selected = selectedBlock === b;
                const isIceWaterOption = idx === WATER_BASE_INDEX && normalizeBlockId(b) === "ice";
                const iconAsset = getBlockIconAsset(b);
                const hasIcon = iconAsset.atlasName === "unused"
                  ? KNOWN_UNUSED_ICON_KEYS.has(iconAsset.atlasKey)
                  : KNOWN_PRIMARY_ICON_KEYS.has(iconAsset.atlasKey);
                return (
                  <button
                    key={b}
                    type="button"
                    className={`shrink-0 w-5 h-5 rounded border overflow-hidden ${
                      textureCollapsed
                        ? "border-border"
                        : selected
                        ? isIceWaterOption
                          ? "border-transparent shadow-[0_0_0_2px_hsl(var(--warning))]"
                          : "border-transparent shadow-[0_0_0_2px_hsl(var(--primary))]"
                        : isIceWaterOption
                          ? "border-border hover:shadow-[0_0_0_1px_hsl(var(--warning))]"
                          : "border-border hover:shadow-[0_0_0_1px_hsl(var(--primary))]"
                    }`}
                    title={isIceWaterOption ? messages.blocks.iceWaterOptionTitle(b) : b}
                    onClick={() => updateBlock(idx, b)}
                  >
                    {hasIcon ? (
                      <PackedBlockIcon
                        atlasKey={iconAsset.atlasKey}
                        atlasName={iconAsset.atlasName}
                        fallbackSrc={iconAsset.fallbackSrc}
                        alt={b}
                        className="w-full h-full"
                      />
                    ) : (
                      <span className="text-[9px] text-muted-foreground">{messages.common.missingTextureSymbol}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )
      ),
      options: (
        <span key="options" className="text-[10px] text-muted-foreground whitespace-nowrap text-center tabular-nums">
          {pad2(allBlocks.length)}
        </span>
      ),
      required: (
        <span key="required" className="text-[10px] font-mono text-right pr-2">
          {reqCount > 0 ? (showStacks ? formatStacks(reqCount) : reqCount) : ""}
        </span>
      ),
    };
    return (
      <div
        key={idx}
        className={`grid gap-1 items-center py-px text-xs transition-colors min-w-0 overflow-hidden ${isMissing ? "bg-destructive/30 ring-1 ring-destructive/60 rounded" : ""}`}
        style={gridColsStyle}
      >
        {visibleColumns.map(col => cells[col])}
      </div>
    );
  };

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
            hasImageData={!!imageData}
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
          <section
            className={`bg-card border border-border rounded-md p-2 w-full ${isStackedLayout ? "" : "min-w-[var(--color-table-min-width)]"}`}
          >
            <div ref={colorTableHeaderRef} className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-accent cursor-help whitespace-nowrap" title={messages.table.titleTooltip}>{messages.table.title}</h2>
                <span className="h-3 border-l border-border/70" />
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowIds(v => !v)}
                >
                  {showIds ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
                  {messages.table.toggleIds}
                </button>
                <span className="h-3 border-l border-border/70" />
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowNames(v => !v)}
                >
                  {showNames ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
                  {messages.table.toggleNames}
                </button>
                <span className="h-3 border-l border-border/70" />
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowOptions(v => !v)}
                >
                  {showOptions ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
                  {messages.table.toggleOptions}
                </button>
                <span className="h-3 border-l border-border/70" />
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setBlockDisplayMode(v => (v === "names" ? "textures" : "names"))}
                  title={messages.table.toggleBlockDisplayTitle}
                >
                  <Glasses aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  {messages.table.blockDisplayMode(blockDisplayMode)}
                </button>
              </div>
              {paletteUsageInfo && imageValid && (
                <label
                  className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none whitespace-nowrap"
                  title={messages.table.mcUnitsTooltip}
                >
                  <span className="font-semibold text-accent">{messages.table.mcUnitsLabel}</span>
                  <input
                    type="checkbox"
                    checked={showStacks}
                    onChange={e => setShowStacks(e.target.checked)}
                    className="h-3 w-3"
                  />
                </label>
              )}
            </div>
            <div key={`${showIds}-${showNames}-${showOptions}-${columnOrder.join(",")}`} className="relative">
              <div className="relative">
                {hasRequiredCol && usedIndices.length > 0 && visibleColumns.includes("required") && (
                  <div
                    className="absolute inset-0 pointer-events-none grid gap-1"
                    style={gridColsStyle}
                  >
                    {visibleColumns.map(col => (
                      <div
                        key={`required-outline-${col}`}
                        className={col === "required" ? "mx-px border-2 border-primary/60 bg-primary/10 rounded" : ""}
                      />
                    ))}
                  </div>
                )}
                <div
                  className="grid gap-1 text-[10px] font-semibold text-muted-foreground bg-card py-0.5 border-b border-border"
                  style={gridColsStyle}
                >
                  {visibleColumns.map(col => {
                    const headerMap: Record<ColumnId, React.ReactNode> = {
                      clr: (
                        <span
                          key="clr"
                          className="cursor-pointer select-none whitespace-nowrap"
                          onClick={() => toggleSort("color")}
                          title={messages.table.columnSortTitle("clr")}
                        >
                          {messages.table.columnLabel("clr")}{sortArrow("color")}
                        </span>
                      ),
                      id: (
                        <span
                          key="id"
                          className="cursor-pointer select-none whitespace-nowrap pl-0.5"
                          onClick={() => toggleSort("id")}
                          title={messages.table.columnSortTitle("id")}
                        >
                          {messages.table.columnLabel("id")}{sortArrow("id")}
                        </span>
                      ),
                      name: (
                        <span
                          key="name"
                          className="cursor-pointer select-none"
                          onClick={() => toggleSort("name")}
                          title={messages.table.columnSortTitle("name")}
                        >
                          {messages.table.columnLabel("name")}{sortArrow("name")}
                        </span>
                      ),
                      block: (
                        <span
                          key="block"
                          className="inline-flex items-center gap-1 min-w-0 w-full"
                          title={messages.table.columnSortTitle("block")}
                        >
                          <button
                            ref={blockHeaderCollapseBtnRef}
                            type="button"
                            className="shrink-0 inline-flex items-center gap-0.5 cursor-pointer select-none whitespace-nowrap text-left"
                            title={messages.table.blockColumnResizeTitle(blockColExpanded)}
                            aria-label={messages.table.blockColumnResizeAriaLabel(blockColExpanded)}
                            onClick={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              setBlockColExpanded(v => !v);
                            }}
                          >
                            {blockColExpanded ? <Minus size={10} /> : <Plus size={10} />}
                            <span>{messages.table.columnLabel("block")}</span>
                          </button>
                        </span>
                      ),
                      options: (
                        <span
                          key="options"
                          className="cursor-pointer select-none whitespace-nowrap pl-0.5"
                          onClick={() => toggleSort("options")}
                          title={messages.table.columnSortTitle("options")}
                        >
                          {messages.table.columnLabel("options")}
                          {sortKey === "options" ? sortArrow("options") : <span className="invisible"> ▲</span>}
                        </span>
                      ),
                      required: (
                        <span
                          key="required"
                          className="block w-full cursor-pointer select-none whitespace-nowrap text-right pr-2"
                          onClick={() => toggleSort("required")}
                          title={messages.table.columnSortTitle("required")}
                        >
                          {messages.table.columnLabel("required")}{sortKey === "required" ? sortArrow("required") : <span className="invisible"> ▲</span>}
                        </span>
                      ),
                    };
                    const dropIndicatorSide = dragColumnIndicator?.target === col ? dragColumnIndicator.side : null;
                    return (
                      <div key={col} className="relative min-w-0" {...colDragProps(col)}>
                        {dropIndicatorSide && (
                          <div
                            className={`absolute top-0 bottom-0 z-10 w-0.5 bg-primary pointer-events-none ${dropIndicatorSide === "after" ? "right-0" : "left-0"}`}
                          />
                        )}
                        {headerMap[col]}
                      </div>
                    );
                  })}
                </div>
                <div className="relative overflow-hidden">{usedIndices.map(renderColorRow)}</div>
              </div>

              {imageValid && unusedIndices.length > 0 && (
                <div>
                  <button
                    className="w-full flex items-center gap-1 py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors border-t border-border mt-1"
                    onClick={() => setShowUnusedColors(v => !v)}
                  >
                    <span className={`inline-block transition-transform ${showUnusedColors ? "rotate-180" : ""}`}>
                      ▼
                    </span>
                    <span>{messages.table.unusedColorsLabel(unusedIndices.length)}</span>
                  </button>
                  {showUnusedColors && <div className="opacity-50">{unusedIndices.map(renderColorRow)}</div>}
                </div>
              )}
            </div>
          </section>

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
          ref={rightColumnRef}
          className={
            isStackedLayout
              ? "contents"
              : "flex-[1_1_0%] min-w-[320px] max-w-[542px] flex flex-col"
          }
        >
          <div className={isStackedLayout ? "order-2" : ""}>
            <PanelImagePreview
              fileRef={fileRef}
              imageData={imageData}
              previewImageUrl={previewImageUrl}
              imageName={imageName}
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
              buildMode={buildMode}
              showUsageInfo={!!paletteUsageInfo && imageValid}
              numUniqueColorShadesForPart={numUniqueColorShadesForPart}
              numColorBlockTypesForPart={numColorBlockTypesForPart}
              vsFillerSpotCount={vsFillerSpotCount}
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

          {/* Credits */}
          <div
            ref={creditsRef}
            className={`${isStackedLayout ? "order-4" : ""} text-[11px] text-muted-foreground text-left space-y-0.5 px-1 pt-4`}
            style={creditsFloatGapPx > 0 ? { transform: `translateY(${creditsFloatGapPx}px)` } : undefined}
          >
            <h3 className="text-xs font-semibold text-accent mb-1">{messages.credits.title}</h3>
            <p>
              <a
                href={messages.credits.evModderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {messages.credits.evModderName}
              </a>{" "}
              — {messages.credits.evModderRole}
            </p>
            <p>
              <a
                href={messages.credits.rebaneUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {messages.credits.rebaneName}
              </a>{" "}
              — {rebaneRolePrefix}
              <a
                href={messages.credits.mapArtCraftUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {messages.credits.mapArtCraftName}
              </a>
              {rebaneRoleSuffix}
            </p>
            <p>
              <a
                href={messages.credits.gu2t4vUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {messages.credits.gu2t4vName}
              </a>{" "}
              — {messages.credits.gu2t4vRole}
            </p>
            <p>{messages.credits.gptNote}</p>
          </div>
        </div>
      </div>
      {showSecretsDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowSecretsDialog(false)}
        >
          <div
            className="w-full max-w-md bg-card border border-border rounded-md p-3 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-accent">{messages.dialogs.secretSettingsTitle}</h2>
              <button
                type="button"
                className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                onClick={() => setShowSecretsDialog(false)}
              >
                {messages.common.close}
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTransparentRow}
                  onChange={e => setShowTransparentRow(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.showTransparentRow}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExcludedBlocks}
                  onChange={e => setShowExcludedBlocks(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.showExcludedBlocks}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceZ129}
                  onChange={e => setForceZ129(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.forceZ129}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applySupportFloorYs}
                  onChange={e => setApplySupportFloorYs(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.assumeFloor}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={belowPlatformWater}
                  onChange={e => setBelowPlatformWater(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.belowPlatformWater}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipEmptySuppressSteps}
                  onChange={e => setSkipEmptySuppressSteps(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.skipEmptySuppressSteps}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={markSuppressLoadSpotsInSchematic}
                  onChange={e => setMarkSuppressLoadSpotsInSchematic(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.markSuppressLoadSpotsInSchematic}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAlignmentReminder}
                  onChange={e => setShowAlignmentReminder(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.showAlignmentReminder}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showNooblineWarnings}
                  onChange={e => setShowNooblineWarnings(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.showNooblineWarnings}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showVsFillerWarnings}
                  onChange={e => setShowVsFillerWarnings(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>{messages.dialogs.options.showVsFillerWarnings}</span>
              </label>
            </div>
          </div>
        </div>
      )}
      {swatchTooltip && (
        <div
          className="fixed z-50 pointer-events-none px-1.5 py-1 rounded border border-border bg-popover text-popover-foreground text-[10px] font-mono whitespace-nowrap"
          style={{ left: swatchTooltip.x, top: swatchTooltip.y }}
        >
          {swatchTooltip.text}
        </div>
      )}
    </div>
  );
};

// Callers:
// - src/main.tsx
export default Index;
