import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue, useLayoutEffect } from "react";
import { Moon, Sun, Plus, Minus, Glasses } from "lucide-react";
import { BASE_COLORS, WATER_BASE_INDEX, getShadedRgb } from "@/data/mapColors";
import { DEFAULT_COLOR_ROW_ORDER } from "@/data/colorSortOrder";
import { EXCLUDED_BLOCKS } from "@/data/excludedColors";
import { convertToNbt } from "@/lib/nbtExport";
import { generateShapeMap } from "@/lib/shapeGeneration";
import { convertFileToColorGrid, convertImageToColorGrid } from "@/lib/colorGridFromImage";
import { computeColorGridStats } from "@/lib/colorGridAnalyzer";
import {
  analyzeMaterialNeeds,
  analyzeFillerNeeds,
  computeGeneratedShapeSignature,
  hasColorHeightVariance as generatedShapeHasColorHeightVariance,
  northRowIsSingleLine as generatedShapeNorthRowIsSingleLine,
} from "@/lib/shapeAnalysis";
import { isFillerDisabled, isShadeFillerDisabled } from "@/lib/fillerRules";
import { isShapeFillerCell, parseShapeCoordKey } from "@/lib/shapeTypes";
import { getSupportedColorAbove, isWithinShapeBounds } from "@/lib/shapeCellRules";
import {
  BuildMode,
  type FillerAssignment,
  FillerRole,
  buildModeUsesLayerGap,
  getBuildModeRangeMax,
  isStaircaseBuildMode,
  isSuppressBuildMode,
  type CustomColor,
} from "@/lib/conversionTypes";
import { isFragileBlock } from "@/data/fragileBlocks";
import {
  BUILTIN_PRESET_NAMES,
  getBuiltinPreset,
  isAutoCustomPresetName,
  loadPresets,
  type Preset,
} from "@/data/presets";

function loadCached<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return JSON.parse(v);
  } catch {
    /* ignore */
  }
  return fallback;
}

const getDisplayName = (name: string): string =>
  name === "SNOW" ? "WHITE" : name === "WOOL" ? "STEM" : name.startsWith("COLOR_") ? name.slice(6) : name;

const normalizeBlockIconId = (raw: string): string => raw.trim().replace(/^minecraft:/, "").split("[")[0];
const ICE_WATER_TOOLTIP = "Ice can be built in place of water or waterlogged blocks, but must be converted to water in-game to get the correct map colors.";
const toBlockIconKey = (raw: string): string =>
  raw.trim()
    .replace(/^minecraft:/, "")
    .replace(/__/g, "__us__")
    .replace(/\[/g, "__lb__")
    .replace(/\]/g, "__rb__")
    .replace(/=/g, "__eq__")
    .replace(/,/g, "__cm__")
    .replace(/:/g, "__cl__");

type ShapeWarning = {
  text: string;
  invalid: boolean;
};
const KNOWN_PRIMARY_ICON_BLOCKS = new Set(
  BASE_COLORS.flatMap(c => c.blocks),
);
const KNOWN_EXCLUDED_ICON_BLOCKS = new Set(EXCLUDED_BLOCKS.flat());
const KNOWN_PRECOMPUTED_ICON_BLOCKS = new Set([...KNOWN_PRIMARY_ICON_BLOCKS, ...KNOWN_EXCLUDED_ICON_BLOCKS]);
const isTextureHiddenBlock = (blockName: string): boolean => {
  const id = normalizeBlockIconId(blockName);
  return id.endsWith("_door") || id.endsWith("_fence_gate") || id === "bedrock";
};

function getHue(r: number, g: number, b: number): number {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === rn) h = ((gn - bn) / d + 6) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return h * 60;
}

type SortKey = "default" | "name" | "options" | "color" | "id" | "required";
type SortDir = "asc" | "desc";
type ModeOption = { value: BuildMode; label: string; disabled?: boolean; muted?: boolean };

type ColumnId = "clr" | "id" | "name" | "block" | "options" | "required";
const ALL_COLUMNS: ColumnId[] = ["clr", "id", "name", "block", "options", "required"];

enum SupportMode {
  None = "none",
  Steps = "steps",
  All = "all",
  Fragile = "fragile",
  Water = "water",
}

function normalizeStoredBuildMode(raw: unknown): BuildMode {
  return Object.values(BuildMode).includes(raw as BuildMode) ? (raw as BuildMode) : BuildMode.StaircaseClassic;
}

function createFillerAssignments(
  supportFillerBlock: string,
  shadeFillerBlock: string,
  dominateVoidFillerBlock: string,
  recessiveVoidFillerBlock: string,
  suppress2LayerLateFillerBlock: string,
  supportMode: SupportMode,
  usesDirectWaterBlock: boolean,
  usesIceWaterBlock: boolean,
): FillerAssignment[] {
  const assignments: FillerAssignment[] = [
    { role: FillerRole.ShadeSuppress, block: shadeFillerBlock },
    { role: FillerRole.ShadeNorthRow, block: shadeFillerBlock },
    { role: FillerRole.ShadeVoidDominant, block: dominateVoidFillerBlock || shadeFillerBlock },
    { role: FillerRole.ShadeVoidRecessive, block: recessiveVoidFillerBlock || shadeFillerBlock },
    { role: FillerRole.ShadeSuppressLate, block: suppress2LayerLateFillerBlock || shadeFillerBlock },
  ];
  switch (supportMode) {
    case SupportMode.Steps:
      assignments.push({ role: FillerRole.StairStep, block: supportFillerBlock });
      assignments.push({ role: FillerRole.WaterPath, block: supportFillerBlock });
      break;
    case SupportMode.All:
      assignments.push({ role: FillerRole.SupportAll, block: supportFillerBlock });
      assignments.push({ role: FillerRole.WaterPath, block: supportFillerBlock });
      break;
    case SupportMode.Fragile:
      assignments.push({ role: FillerRole.SupportFragile, block: supportFillerBlock });
      break;
    case SupportMode.Water:
      assignments.push({
        role: usesDirectWaterBlock ? FillerRole.SupportWaterSides : FillerRole.SupportWaterBase,
        block: supportFillerBlock,
      });
      assignments.push({ role: FillerRole.WaterPath, block: supportFillerBlock });
      break;
    case SupportMode.None:
      break;
  }
  if (
    supportMode !== SupportMode.None &&
    usesIceWaterBlock &&
    !assignments.some(({ role }) => role === FillerRole.SupportWaterBase)
  ) {
    assignments.push({ role: FillerRole.SupportWaterBase, block: supportFillerBlock });
  }
  return assignments;
}

function isStaircaseLikeMode(mode: BuildMode): boolean {
  return mode === BuildMode.Flat || isStaircaseBuildMode(mode);
}

const DEFAULT_STAIRCASE_OPTIONS: ModeOption[] = [
  { value: BuildMode.Flat, label: "Flat" },
  { value: BuildMode.InclineUp, label: "Incline (Up)" },
  { value: BuildMode.InclineDown, label: "Incline (Down)" },
  { value: BuildMode.StaircaseValley, label: "Staircase (Valley)" },
  { value: BuildMode.StaircaseClassic, label: "Staircase (Classic)" },
  { value: BuildMode.StaircaseGrouped, label: "Staircase (Grouped)" },
  { value: BuildMode.StaircaseNorthline, label: "Staircase (Northline)" },
  { value: BuildMode.StaircaseSouthline, label: "Staircase (Southline)" },
  { value: BuildMode.StaircaseParty, label: "Staircase (Party)" },
];
const PAGE_CONTENT_PADDING_PX = 8; // from outer wrapper `p-2`
const LAYOUT_GAP_PX = 8;

const BASE_SUPPRESS_OPTIONS: ModeOption[] = [
  { value: BuildMode.SuppressSplitRow, label: "Suppress (Row-split)", muted: true },
  { value: BuildMode.SuppressSplitChecker, label: "Suppress (Checker-split)" },
  { value: BuildMode.SuppressCheckerEW, label: "Suppress (Checker, E→W)" },
  { value: BuildMode.SuppressPairsEW, label: "Suppress (Pairs, E→W)" },
  { value: BuildMode.Suppress2Layer, label: "Suppress (2-Layer)" },
  { value: BuildMode.Suppress2LayerLateFillers, label: "Suppress (2-Layer, Late-Fillers)" },
  { value: BuildMode.Suppress2LayerLatePairs, label: "Suppress (2-Layer, Late-Pairs)" },
];

const CUSTOM_COLOR_TOOLTIP_LINE1 = "Custom RGB is interpreted as the base/light shade for the color ID.";
const CUSTOM_COLOR_TOOLTIP_LINE2 = "Dark and flat shades are derived automatically using standard multipliers.";
const CUSTOM_COLOR_TOOLTIP_LINE3 = "Once added, all three new shades will be available to use for input images.";
const CUSTOM_COLOR_TOOLTIP = `${CUSTOM_COLOR_TOOLTIP_LINE1}\n${CUSTOM_COLOR_TOOLTIP_LINE2}\n${CUSTOM_COLOR_TOOLTIP_LINE3}`;

const SUPPRESS_2LAYER_GUIDE =
  "Steps:\n" +
  "1) Build everything\n" +
  "2) Update the full map\n" +
  "3) Remove the upper layer, 1-2 columns at a time\n" +
  "4) Carefully update *just* the dominate pixels for the target column(s)\n" +
  "5) Repeat, column-by-column, for the entire map\n\n" +
  "Layer gap controls vertical spacing between lower and upper suppress layers."
const SUPPRESS_2LAYER_GUIDE_WITH_VS_FILLER =
  "Steps:\n" +
  "1) Build all 'non-late' blocks\n" + // Diff
  "2) Update the full map\n" +
  "3) Remove the upper layer, 1-2 columns at a time\n" +
  "4) For each removed column, add in any late-blocks\n" + // Added
  "5) Carefully update *just* the dominate pixels for the target column(s)\n" +
  "6) Repeat for the whole map\n\n" +
  "Layer gap controls vertical spacing between lower and upper suppress layers.";

const LAYER_GAP_TOOLTIP = "Layer gap controls the vertical spacing between lower and upper 2-layer suppress sections.";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function hashString32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; ++i) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function getPaletteSeedOffset(blockMapping: Record<number, string>): number {
  const serialized = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => `${i + 1}:${blockMapping[i + 1] ?? ""}`).join("|");
  return hashString32(serialized);
}

function formatStacks(count: number): string {
  if (count < 64) return String(count);
  const sb = Math.floor(count / (64 * 27));
  const rem = count % (64 * 27);
  const st = Math.floor(rem / 64);
  const items = rem % 64;
  return [sb && `${sb}sb`, st && `${st}st`, items && String(items)].filter(Boolean).join(" ") || "0";
}

function encodePreset(
  preset: Preset, supportFillerBlock: string, shadeFillerBlock: string, supportMode: SupportMode,
  buildMode: BuildMode, customColors: CustomColor[], convertUnsupported: boolean,
  suppress2LayerLateFillerBlock: string, proPaletteSeed: boolean,
  dominateVoidFillerBlock: string, recessiveVoidFillerBlock: string,
): string {
  const parts = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => {
    const block = preset.blocks[i + 1] || "";
    const idx = BASE_COLORS[i + 1].blocks.indexOf(block);
    return idx >= 0 ? String(idx) : block ? `=${block}` : "-";
  });
  const ccStr = customColors.length > 0 ? customColors.map(cc => `${cc.r},${cc.g},${cc.b}:${cc.block}`).join(";") : "";
  const s = [
    preset.name,
    parts.join(","),
    supportFillerBlock,
    shadeFillerBlock,
    supportMode,
    buildMode,
    ccStr,
    convertUnsupported ? "1" : "0",
    suppress2LayerLateFillerBlock,
    proPaletteSeed ? "1" : "0",
    dominateVoidFillerBlock,
    recessiveVoidFillerBlock,
  ].join("|");
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodePreset(encoded: string): {
  preset: Preset; supportFiller?: string; shadeFiller?: string; supportMode?: SupportMode;
  buildMode?: BuildMode; customColors?: CustomColor[]; convertUnsupported?: boolean;
  suppress2LayerLateFillerBlock?: string; proPaletteSeed?: boolean;
  dominateVoidFillerBlock?: string; recessiveVoidFillerBlock?: string;
} | null {
  try {
    let s = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const sections = atob(s).split("|");
    if (sections.length < 2) return null;

    const supportRaw = sections[4] || SupportMode.None;
    const supportMode: SupportMode =
      supportRaw === "1" ? SupportMode.Steps : supportRaw === "0" ? SupportMode.None : (supportRaw as SupportMode);

    const blocks: Record<number, string> = {};
    for (const [i, p] of sections[1].split(",").entries()) {
      if (i >= BASE_COLORS.length - 1) break;
      const baseIdx = i + 1;
      blocks[baseIdx] =
        p === "-" || p === "" ? "" : p.startsWith("=") ? p.slice(1) : BASE_COLORS[baseIdx].blocks[parseInt(p)] || "";
    }

    const customColors = sections[6]
      ? sections[6]
          .split(";")
          .map(entry => {
            const [rgb, block] = entry.split(":");
            const [r, g, b] = rgb.split(",").map(Number);
            return { r, g, b, block };
          })
          .filter(cc => !isNaN(cc.r) && cc.block)
      : undefined;

    const convertUnsupported = sections[7] === "1" ? true : sections[7] === "0" ? false : undefined;
    const suppress2LayerLateFillerBlock = sections[8] || undefined;
    const proPaletteSeed = sections[9] === "1" ? true : sections[9] === "0" ? false : undefined;
    const dominateVoidFillerBlock = sections[10] || undefined;
    const recessiveVoidFillerBlock = sections[11] || undefined;

    return {
      preset: { name: sections[0], blocks }, supportFiller: sections[2] || undefined, shadeFiller: sections[3] || undefined,
      supportMode, buildMode: sections[5] ? normalizeStoredBuildMode(sections[5]) : undefined,
      customColors, convertUnsupported, suppress2LayerLateFillerBlock, proPaletteSeed,
      dominateVoidFillerBlock, recessiveVoidFillerBlock,
    };
  } catch {
    return null;
  }
}

// ── Cached localStorage keys ──
const LS_KEYS = {
  supportFiller: "mapart_support_filler",
  shadeFiller: "mapart_shade_filler",
  buildMode: "mapart_buildMode",
  supportMode: "mapart_supportMode",
  showStacks: "mapart_showStacks",
  showIds: "mapart_showIds",
  showNames: "mapart_showNames",
  showOptions: "mapart_showOptions",
  blockDisplayMode: "mapart_blockDisplayMode",
  blockColExpanded: "mapart_blockColExpanded",
  activePreset: "mapart_activePreset",
  sortKey: "mapart_sortKey",
  sortDir: "mapart_sortDir",
  layerGap: "mapart_layerGap",
  suppress2LayerLateFiller: "mapart_suppress2layer_late_filler",
  paletteSeed: "mapart_palette_seed",
  dominateVoidFiller: "mapart_dominate_void_filler",
  recessiveVoidFiller: "mapart_recessive_void_filler",
  columnOrder: "mapart_columnOrder",
  showTransparentRow: "mapart_secret_showTransparentRow",
  showExcludedBlocks: "mapart_secret_showExcludedBlocks",
  forceZ129: "mapart_secret_forceZ129",
  assumeFloor: "mapart_secret_assumeFloor",
  showVsFillerWarnings: "mapart_secret_showVsFillerWarnings",
  showAlignmentReminder: "mapart_secret_showAlignmentReminder",
  showNooblineWarnings: "mapart_secret_showNooblineWarnings",
} as const;

const getStoredTheme = (): "light" | "dark" | null => {
  const raw = localStorage.getItem("mapart_theme");
  if (raw === "light" || raw === "dark") return raw;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed === "light" || parsed === "dark" ? parsed : null;
  } catch {
    return null;
  }
};

const resolveDarkTheme = () => {
  const stored = getStoredTheme();
  return stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
};

// ── Component ──
const Index = () => {
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [activeIdx, setActiveIdx] = useState(() => {
    try {
      const name = JSON.parse(localStorage.getItem(LS_KEYS.activePreset) || '""');
      if (name) {
        const idx = loadPresets().findIndex(p => p.name === name);
        if (idx >= 0) return idx;
      }
    } catch {
      /* ignore */
    }
    return 0;
  });
  const [supportFillerBlock, setSupportFillerBlock] = useState(() =>
    loadCached(LS_KEYS.supportFiller, loadCached("mapart_filler", "resin_block")),
  );
  const [shadeFillerBlock, setShadeFillerBlock] = useState(() =>
    loadCached(LS_KEYS.shadeFiller, loadCached("mapart_filler", "resin_block")),
  );
  const [suppress2LayerLateFillerBlock, setSuppress2LayerLateFillerBlock] = useState(() =>
    loadCached(LS_KEYS.suppress2LayerLateFiller, "slime_block"),
  );
  const [dominateVoidFillerBlock, setDominateVoidFillerBlock] = useState(() =>
    loadCached(LS_KEYS.dominateVoidFiller, "slime_block"),
  );
  const [recessiveVoidFillerBlock, setRecessiveVoidFillerBlock] = useState(() =>
    loadCached(LS_KEYS.recessiveVoidFiller, "honey_block"),
  );
  const [buildMode, setBuildMode] = useState<BuildMode>(() =>
    normalizeStoredBuildMode(loadCached(LS_KEYS.buildMode, BuildMode.StaircaseClassic)),
  );
  const [proPaletteSeed, setProPaletteSeed] = useState(() => loadCached(LS_KEYS.paletteSeed, false));
  const calcProPaletteSeed = useDeferredValue(proPaletteSeed);
  const [layerGap, setLayerGap] = useState(() => loadCached(LS_KEYS.layerGap, 5));
  const calcLayerGap = useDeferredValue(layerGap);
  const [colRangeEnabled, setColRangeEnabled] = useState(false);
  const [colStart, setColStart] = useState(0);
  const [colEnd, setColEnd] = useState(127);
  const colStartRef = useRef(0);
  const colEndRef = useRef(127);
  useEffect(() => { colStartRef.current = colStart; }, [colStart]);
  useEffect(() => { colEndRef.current = colEnd; }, [colEnd]);
  const [supportMode, setSupportMode] = useState<SupportMode>(() =>
    loadCached(LS_KEYS.supportMode, SupportMode.None),
  );
  const [customColors, setCustomColors] = useState<CustomColor[]>([]);
  const [customMode, setCustomMode] = useState<"custom" | number>("custom");
  const [newCustom, setNewCustom] = useState({ r: "", g: "", b: "", block: "" });
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [imageName, setImageName] = useState("");
  const [imageValid, setImageValid] = useState(false);
  const [paletteErrors, setPaletteErrors] = useState<string[]>([]);
  const [converting, setConverting] = useState(false);
  const [showNames, setShowNames] = useState(() => loadCached(LS_KEYS.showNames, false));
  const [showIds, setShowIds] = useState(() => loadCached(LS_KEYS.showIds, false));
  const [showOptions, setShowOptions] = useState(() => loadCached(LS_KEYS.showOptions, false));
  const [blockDisplayMode, setBlockDisplayMode] = useState<"names" | "textures">(() =>
    loadCached(LS_KEYS.blockDisplayMode, "textures" as "names" | "textures"),
  );
  const [blockColExpanded, setBlockColExpanded] = useState(() => loadCached(LS_KEYS.blockColExpanded, true));
  const [sortKey, setSortKey] = useState<SortKey>(() => loadCached(LS_KEYS.sortKey, "default" as SortKey));
  const [sortDir, setSortDir] = useState<SortDir>(() => loadCached(LS_KEYS.sortDir, "asc" as SortDir));
  const [showUnusedColors, setShowUnusedColors] = useState(false);
  const [showStacks, setShowStacks] = useState(() => loadCached(LS_KEYS.showStacks, true));
  const [isDark, setIsDark] = useState(resolveDarkTheme);
  const [convertUnsupported, /* setConvertUnsupported */] = useState(true); // always on; checkbox commented out
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => loadCached(LS_KEYS.columnOrder, ALL_COLUMNS));
  const [showTransparentRow, setShowTransparentRow] = useState(() => loadCached(LS_KEYS.showTransparentRow, false));
  const [showExcludedBlocks, setShowExcludedBlocks] = useState(() => loadCached(LS_KEYS.showExcludedBlocks, false));
  const [forceZ129, setForceZ129] = useState(() => loadCached(LS_KEYS.forceZ129, false));
  const [assumeFloor, setAssumeFloor] = useState(() => loadCached(LS_KEYS.assumeFloor, true));
  const [showVsFillerWarnings, setShowVsFillerWarnings] = useState(() => loadCached(LS_KEYS.showVsFillerWarnings, true));
  const [showAlignmentReminder, setShowAlignmentReminder] = useState(() => loadCached(LS_KEYS.showAlignmentReminder, true));
  const [showNooblineWarnings, setShowNooblineWarnings] = useState(() => loadCached(LS_KEYS.showNooblineWarnings, false));
  const [showSecretsDialog, setShowSecretsDialog] = useState(false);
  const parsedImage = useMemo(
    () => imageData ? convertImageToColorGrid(imageData, customColors, convertUnsupported) : null,
    [imageData, customColors, convertUnsupported],
  );
  const imageColorGrid = parsedImage?.colorGrid ?? null;
  const dragColRef = useRef<ColumnId | null>(null);
  const [highlightedColorIdx, setHighlightedColorIdx] = useState<number | null>(null);
  const [swatchTooltip, setSwatchTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const swatchTooltipRafRef = useRef<number | null>(null);
  const swatchTooltipPendingRef = useRef<{ text: string; x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const supportFillerInputRef = useRef<HTMLInputElement>(null);
  const blockMeasureSelectRef = useRef<HTMLSelectElement | null>(null);
  const blockHeaderCollapseBtnRef = useRef<HTMLButtonElement | null>(null);
  const [blockMeasureFont, setBlockMeasureFont] = useState("11px monospace");
  const [blockMeasureInsetsPx, setBlockMeasureInsetsPx] = useState(10);
  const [blockTextureCollapsedWidthPx, setBlockTextureCollapsedWidthPx] = useState(44);
  const presetToolbarSectionRef = useRef<HTMLElement>(null);
  const fillerToolbarSectionRef = useRef<HTMLElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const rightColumnRef = useRef<HTMLDivElement>(null);
  const layoutRootRef = useRef<HTMLDivElement>(null);
  const creditsRef = useRef<HTMLDivElement>(null);
  const [presetToolbarMinWidthPx, setPresetToolbarMinWidthPx] = useState(0);
  const [fillerToolbarMinWidthPx, setFillerToolbarMinWidthPx] = useState(0);
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

  const preset = presets[activeIdx] || getBuiltinPreset("PistonClear")!;

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
    localStorage.setItem("mapart_presets", JSON.stringify(persistedPresets));
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
      [LS_KEYS.suppress2LayerLateFiller]: suppress2LayerLateFillerBlock,
      [LS_KEYS.paletteSeed]: proPaletteSeed,
      [LS_KEYS.dominateVoidFiller]: dominateVoidFillerBlock,
      [LS_KEYS.recessiveVoidFiller]: recessiveVoidFillerBlock,
      [LS_KEYS.columnOrder]: columnOrder,
      [LS_KEYS.showTransparentRow]: showTransparentRow,
      [LS_KEYS.showExcludedBlocks]: showExcludedBlocks,
      [LS_KEYS.forceZ129]: forceZ129,
      [LS_KEYS.assumeFloor]: assumeFloor,
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
      suppress2LayerLateFillerBlock,
      proPaletteSeed,
      dominateVoidFillerBlock,
      recessiveVoidFillerBlock,
      columnOrder,
      showTransparentRow,
      showExcludedBlocks,
      forceZ129,
      assumeFloor,
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

  const paletteSeedOffset = useMemo(
    () => (calcProPaletteSeed ? getPaletteSeedOffset(preset.blocks) : 0),
    [calcProPaletteSeed, preset.blocks],
  );
  const imageStats = useMemo(
    () => (imageColorGrid && imageValid ? computeColorGridStats(imageColorGrid) : null),
    [imageColorGrid, imageValid],
  );
  const selectedWaterBlock = preset.blocks[WATER_BASE_INDEX] || BASE_COLORS[WATER_BASE_INDEX].blocks[0] || "";
  const usesWaterForWater = normalizeBlockIconId(selectedWaterBlock) === "water";
  const usesIceForWater = normalizeBlockIconId(selectedWaterBlock) === "ice";
  const imageHasNonLightWater = imageStats?.hasNonLightWater ?? false;
  const usesBelowOnlyWaterSupport = useMemo(
    () => (supportMode === SupportMode.Water && !usesWaterForWater) || (supportMode !== SupportMode.None && usesIceForWater),
    [supportMode, usesWaterForWater, usesIceForWater],
  );
  const waterFillerOffset = useMemo(
    () => imageHasNonLightWater && usesBelowOnlyWaterSupport,
    [imageHasNonLightWater, usesBelowOnlyWaterSupport],
  );
  const shapeMap = useMemo(
    () => imageColorGrid && imageValid
      ? generateShapeMap(imageColorGrid, {
          layerGap: calcLayerGap,
          paletteSeed: paletteSeedOffset,
          waterFillerOffset,
        }, imageStats ? {
          hasWater: imageStats.hasWater,
          hasTransparency: imageStats.hasTransparency,
          uniformNonFlatDirection: imageStats.uniformNonFlatDirection,
          hasTwoLayerLateVoidNeed: imageStats.voidShadowStats.dominant > 0,
        } : undefined)
      : null,
    [imageColorGrid, imageValid, calcLayerGap, paletteSeedOffset, waterFillerOffset, imageStats],
  );
  const hasNonFlatShades = imageStats?.hasNonFlatShades ?? false;
  const hasSuppressPattern = imageStats?.hasSuppressPattern ?? false;
  const northlineShape = shapeMap?.[BuildMode.StaircaseNorthline] ?? null;
  const isFlatShape = useMemo(
    () => !!northlineShape && !generatedShapeHasColorHeightVariance(northlineShape),
    [northlineShape],
  );
  const fullImageUsedShadesByBase = imageStats?.usedShadesByBase ?? new Map<number, Set<number>>();
  const usedBaseColors = imageStats?.usedBaseColors ?? new Set<number>();
  const voidShadowStats = imageStats?.voidShadowStats ?? { dominant: 0, recessive: 0 };
  const voidShadowCount = voidShadowStats.dominant + voidShadowStats.recessive;

  const imageHasWater = imageStats?.hasWater ?? false;
  const imageHasTransparency = imageStats?.hasTransparency ?? false;

  const supportFillerBlockId = useMemo(
    () => supportFillerBlock.trim().toLowerCase().replace(/^minecraft:/, "").split("[")[0],
    [supportFillerBlock],
  );
  const supportFillerIsFragile = useMemo(
    () => supportFillerBlockId.length > 0 && isFragileBlock(supportFillerBlockId),
    [supportFillerBlockId],
  );
  const supportFillerDisabled = useMemo(() => isFillerDisabled(supportFillerBlock), [supportFillerBlock]);
  const commitSupportFillerBlock = useCallback((value: string) => {
    if (isFillerDisabled(value)) setSupportMode(SupportMode.None);
  }, []);
  const shadeFillerShadingDisabled = useMemo(() => isShadeFillerDisabled(shadeFillerBlock), [shadeFillerBlock]);
  const dominateVoidFillerShadingDisabled = useMemo(
    () => isShadeFillerDisabled(dominateVoidFillerBlock || shadeFillerBlock),
    [dominateVoidFillerBlock, shadeFillerBlock],
  );
  const recessiveVoidFillerShadingDisabled = useMemo(
    () => isShadeFillerDisabled(recessiveVoidFillerBlock || shadeFillerBlock),
    [recessiveVoidFillerBlock, shadeFillerBlock],
  );
  const lateFillerShadingDisabled = useMemo(
    () => isShadeFillerDisabled(suppress2LayerLateFillerBlock || shadeFillerBlock),
    [suppress2LayerLateFillerBlock, shadeFillerBlock],
  );
  const uiFillerAssignments = useMemo(
    () => createFillerAssignments(
      supportFillerBlock,
      shadeFillerBlock,
      dominateVoidFillerBlock,
      recessiveVoidFillerBlock,
      suppress2LayerLateFillerBlock,
      supportMode,
      usesWaterForWater,
      usesIceForWater,
    ),
    [
      supportFillerBlock,
      shadeFillerBlock,
      dominateVoidFillerBlock,
      recessiveVoidFillerBlock,
      suppress2LayerLateFillerBlock,
      supportMode,
      usesWaterForWater,
      usesIceForWater,
    ],
  );

  const missingBlocks = useMemo(() => {
    if (!imageValid || usedBaseColors.size === 0) return [];
    return [...usedBaseColors].filter(idx => idx > 0 && !preset.blocks[idx]);
  }, [imageValid, usedBaseColors, preset.blocks]);

  const imageInfo = imageStats?.imageInfo ?? null;

  const effectiveBuildMode = isFlatShape ? BuildMode.Flat : buildMode;
  const isStepRangeMode = effectiveBuildMode === BuildMode.SuppressPairsEW || effectiveBuildMode === BuildMode.SuppressCheckerEW;
  const maxRangeIndex = useMemo(() => getBuildModeRangeMax(effectiveBuildMode), [effectiveBuildMode]);
  const minLayerGap = supportMode === SupportMode.Fragile || supportMode === SupportMode.All ? 3 : 2;
  const calcLayerGapForBuild =
    (effectiveBuildMode === BuildMode.Suppress2Layer ||
      effectiveBuildMode === BuildMode.Suppress2LayerLateFillers ||
      effectiveBuildMode === BuildMode.Suppress2LayerLatePairs)
      ? calcLayerGap
      : minLayerGap;
  const supportShape = useMemo(
    () => effectiveBuildMode === BuildMode.Flat
      ? northlineShape
      : (shapeMap?.[effectiveBuildMode] ?? null),
    [shapeMap, effectiveBuildMode, northlineShape],
  );
  const candidateVisibleInPart = useCallback(
    (part: NonNullable<typeof supportShape>["parts"][number], candidate: { x: number; y: number; z: number }) =>
      isWithinShapeBounds(candidate, part.bounds, assumeFloor),
    [assumeFloor],
  );
  const enableStepsSupportOption = !imageData || !!supportShape?.parts.some(part =>
      [...part.cells.entries()].some(([coord, cell]) => {
      if (!isShapeFillerCell(cell) || !cell.includes(FillerRole.StairStep)) return false;
      const [x, y, z] = parseShapeCoordKey(coord);
      return candidateVisibleInPart(part, { x, y, z });
    }),
  );
  const enableFragileSupportOption = useMemo(() => {
    const hasFragileMappedBlock = (block: string) => !!block && isFragileBlock(normalizeBlockIconId(block));
    if (!imageData) {
      return Object.values(preset.blocks).some(hasFragileMappedBlock) || customColors.some(color => hasFragileMappedBlock(color.block));
    }
    if (!supportShape) return false;
    return supportShape.parts.some(part =>
      [...part.cells.entries()].some(([coord, cell]) => {
        if (!isShapeFillerCell(cell)) return false;
        const [x, y, z] = parseShapeCoordKey(coord);
        if (!candidateVisibleInPart(part, { x, y, z })) return false;
        if (!cell.includes(FillerRole.SupportFragile)) return false;
        const color = getSupportedColorAbove(part, coord);
        if (!color) return false;
        const mapped = color.isCustom
          ? (customColors[color.id]?.block ?? "")
          : (preset.blocks[color.id] || BASE_COLORS[color.id].blocks[0] || "");
        return hasFragileMappedBlock(mapped);
      }),
    );
  }, [imageData, supportShape, preset.blocks, customColors, candidateVisibleInPart]);
  const enableWaterSupportOption = !imageData || imageHasWater;
  const staircaseModeOptions = useMemo((): ModeOption[] => {
    if (!shapeMap || !imageValid || isFlatShape) {
      return DEFAULT_STAIRCASE_OPTIONS;
    }
    const sourceModes = DEFAULT_STAIRCASE_OPTIONS
      .map(option => option.value)
      .filter(mode => mode !== BuildMode.Flat && !!shapeMap[mode]);
    const seen = new Set<string>();
    const unique: BuildMode[] = [];
    for (const mode of sourceModes) {
      const shape = shapeMap[mode];
      if (!shape) continue;
      const signature = computeGeneratedShapeSignature(shape);
      if (seen.has(signature)) continue;
      seen.add(signature);
      unique.push(mode);
    }
    const buildModes = unique.length > 0 ? unique : [...sourceModes];
    return buildModes.map(mode => DEFAULT_STAIRCASE_OPTIONS.find(option => option.value === mode) || { value: mode, label: mode });
  }, [
    shapeMap,
    imageValid,
    isFlatShape,
  ]);

  const twoLayerHasLateVoidNeed = !!shapeMap?.[BuildMode.Suppress2LayerLatePairs];

  const suppressModeOptions = useMemo((): ModeOption[] => {
    const suppressModes = BASE_SUPPRESS_OPTIONS
      .map(option => option.value)
      .filter(mode => !!shapeMap?.[mode]);
    return suppressModes.map(mode => {
      return BASE_SUPPRESS_OPTIONS.find(option => option.value === mode) || { value: mode, label: mode };
    });
  }, [shapeMap]);

  const getBuildModeTooltip = useCallback(
    (mode: BuildMode): string => {
      switch (mode) {
        case BuildMode.InclineDown:
          return "All non-transparent non-water pixels slope downward uniformly, so all staircase methods collapse to the northline output.";
        case BuildMode.InclineUp:
          return "All non-transparent non-water pixels slope upward uniformly, so all staircase methods collapse to the northline output.";
        case BuildMode.StaircaseValley:
          return "Minimizes maxY-minY diff, and splits up N→S columns, lowering each segment as much as possible";
        case BuildMode.StaircaseClassic:
          return "Minimizes maxY-minY diff, while keeping N→S columns contiguous";
        case BuildMode.StaircaseGrouped:
          return "Valley-style segmentation with safe cross-column grouping to reduce isolated low runs";
        case BuildMode.StaircaseNorthline:
          return "Aligns each column N→S from a reference (noob)line of blocks";
        case BuildMode.StaircaseSouthline:
          return "Aligns each column S→N from a reference line of blocks (the bottom row)";
        case BuildMode.StaircaseParty:
          return "Same MapArt, but makes the build process more fun and exciting!";
        case BuildMode.SuppressSplitRow:
          return "Split-row; available for compatibility, but generally not useful";
        case BuildMode.SuppressSplitChecker:
          return "Split NBT generations for dominant/recessive placements";
        case BuildMode.SuppressCheckerEW:
          return "Stepwise E→W checker handling: 4 columns per step (2 dominant east, 2 recessive west), overlapping by 2 columns";
        case BuildMode.SuppressPairsEW:
          return "Split into East-West pairs in a interlacing 'brick' pattern; currently only supports updating from E→W";
        case BuildMode.Suppress2LayerLatePairs:
          return (
            "Suppress-phase placements use a custom 'late filler' block (at the highest Y-layer), and should be skipped during initial build-phase.\n\n" +
            SUPPRESS_2LAYER_GUIDE_WITH_VS_FILLER
          );
        case BuildMode.Suppress2LayerLateFillers:
          // if (twoLayerHasLateVoidNeed)
          return (
            "Suppress-phase placements use a custom 'late filler' block (on the lower layer), and should be skipped during initial build-phase.\n\n" +
            SUPPRESS_2LAYER_GUIDE_WITH_VS_FILLER
          );
          // FALLTHROUGH_INTENDED
        case BuildMode.Suppress2Layer:
          return SUPPRESS_2LAYER_GUIDE
        case BuildMode.Flat:
          return "Flat: all color blocks in the generated shape are at the same Y-level.";
        default:
          return "Selected shading method.";
      }
    },
    [twoLayerHasLateVoidNeed],
  );

  const shadingMethodTooltip = useMemo(() => getBuildModeTooltip(buildMode), [getBuildModeTooltip, buildMode]);

  const getSupportModeTooltip = useCallback((mode: SupportMode): string => {
    switch (mode) {
      case SupportMode.None:
        return "No support blocks (shading only)";
      case SupportMode.Steps:
        return "Adds support blocks below staircase steps.";
      case SupportMode.All:
        return "Adds support blocks below every block.";
      case SupportMode.Fragile:
        return "Adds support blocks below fragile blocks.";
      case SupportMode.Water:
        return "Adds support blocks around water, or below ice pillars (if used instead of water).";
      default:
        return "Selected support mode.";
    }
  }, []);
  const supportModeTooltip = useMemo(() => getSupportModeTooltip(supportMode), [getSupportModeTooltip, supportMode]);

  const effectiveShape = supportShape;

  const materialNeedStats = useMemo(() => {
    if (!effectiveShape || !imageValid) return null;
    return analyzeMaterialNeeds(imageColorGrid, effectiveShape, {
      blockMapping: preset.blocks,
      fillerAssignments: uiFillerAssignments,
      assumeFloor,
      customColors,
      ...(colRangeEnabled ? (isStepRangeMode ? { stepRange: [colStart, colEnd] } : { columnRange: [colStart, colEnd] }) : {}),
    });
  }, [
    effectiveShape,
    imageValid,
    imageColorGrid,
    preset.blocks,
    uiFillerAssignments,
    assumeFloor,
    customColors,
    colRangeEnabled,
    isStepRangeMode,
    colStart,
    colEnd,
  ]);
  const materialCounts = useMemo(() => materialNeedStats?.blockCounts ?? null, [materialNeedStats]);

  const sortedMaterials = useMemo(
    () =>
      materialCounts
        ? Object.entries(materialCounts)
            .filter(([, c]) => c > 0)
            .sort((a, b) => b[1] - a[1])
        : [],
    [materialCounts],
  );
  const numUniqueColorShadesForPart = useMemo(
    () => materialNeedStats?.numUniqueColorShadesForPart ?? (imageInfo?.uniqueShadeCount ?? 0),
    [materialNeedStats, imageInfo],
  );
  const usedShadesByBase = useMemo(
    () => materialNeedStats?.usedShadesByBase ?? fullImageUsedShadesByBase,
    [materialNeedStats, fullImageUsedShadesByBase],
  );
  const formatRequiredCount = useCallback(
    (count: number) => (showStacks ? formatStacks(count) : count),
    [showStacks],
  );

  const colorRequiredMap = useMemo(() => {
    return materialNeedStats?.baseColorCounts ?? ({} as Record<number, number>);
  }, [materialNeedStats]);
  const numColorBlockTypesForPart = useMemo(
    () => Object.values(colorRequiredMap).filter(count => count > 0).length,
    [colorRequiredMap],
  );

  const blockToBaseIndex = useMemo(() => {
    const map: Record<string, number> = {};
    for (let i = 1; i < BASE_COLORS.length; ++i) {
      const b = preset.blocks[i];
      if (b && !map[b]) map[b] = i;
    }
    return map;
  }, [preset.blocks]);

  const isBuiltinUnedited = useMemo(() => {
    const builtin = getBuiltinPreset(preset.name);
    return builtin ? JSON.stringify(builtin.blocks) === JSON.stringify(preset.blocks) : false;
  }, [preset]);

  useEffect(() => {
    const clampedStart = Math.max(0, Math.min(colStart, maxRangeIndex));
    const clampedEnd = Math.max(clampedStart, Math.min(colEnd, maxRangeIndex));
    if (clampedStart !== colStart) setColStart(clampedStart);
    if (clampedEnd !== colEnd) setColEnd(clampedEnd);
  }, [colStart, colEnd, maxRangeIndex]);

  useEffect(() => {
    const encoded = new URLSearchParams(window.location.search).get("preset");
    if (!encoded) return;
    const decoded = decodePreset(encoded);
    if (!decoded) return;
    setPresets(prev => {
      const exists = prev.findIndex(p => p.name === decoded.preset.name);
      if (exists >= 0) {
        const n = [...prev];
        n[exists] = decoded.preset;
        setActiveIdx(exists);
        return n;
      }
      setActiveIdx(prev.length);
      return [...prev, decoded.preset];
    });
    if (decoded.supportFiller) setSupportFillerBlock(decoded.supportFiller);
    if (decoded.shadeFiller) setShadeFillerBlock(decoded.shadeFiller);
    if (decoded.supportMode !== undefined) setSupportMode(decoded.supportMode);
    if (decoded.buildMode) setBuildMode(decoded.buildMode);
    if (decoded.customColors) setCustomColors(decoded.customColors);
    if (decoded.suppress2LayerLateFillerBlock) {
      setSuppress2LayerLateFillerBlock(decoded.suppress2LayerLateFillerBlock);
    }
    if (decoded.proPaletteSeed !== undefined) setProPaletteSeed(decoded.proPaletteSeed);
    if (decoded.dominateVoidFillerBlock) setDominateVoidFillerBlock(decoded.dominateVoidFillerBlock);
    if (decoded.recessiveVoidFillerBlock) setRecessiveVoidFillerBlock(decoded.recessiveVoidFillerBlock);
    // if (decoded.convertUnsupported !== undefined) setConvertUnsupported(decoded.convertUnsupported);
  }, []);

  // Auto-select mode when image changes
  useEffect(() => {
    if (!imageData) return;
    if (isFlatShape) setBuildMode(BuildMode.Flat);
    else if (hasSuppressPattern)
      setBuildMode(prev => isStaircaseLikeMode(prev) ? (twoLayerHasLateVoidNeed ? BuildMode.Suppress2LayerLatePairs : BuildMode.Suppress2Layer) : prev);
    else setBuildMode(prev => prev === BuildMode.Flat ? BuildMode.StaircaseClassic : prev);
  }, [imageData, isFlatShape, hasSuppressPattern, twoLayerHasLateVoidNeed]);

  useEffect(() => {
    if (!imageData || isFlatShape) return;
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
  }, [imageData, isFlatShape, buildMode, staircaseModeOptions, suppressModeOptions]);

  useEffect(() => {
    if (!imageData) return;
    if (supportMode === SupportMode.Fragile && (supportFillerIsFragile || !enableFragileSupportOption)) { setSupportMode(SupportMode.None); return; }
    if (supportMode === SupportMode.Steps && !enableStepsSupportOption) setSupportMode(SupportMode.None);
    if (supportMode === SupportMode.Water && !enableWaterSupportOption) setSupportMode(SupportMode.None);
  }, [imageData, enableStepsSupportOption, enableFragileSupportOption, enableWaterSupportOption, supportMode, supportFillerIsFragile]);

  useEffect(() => {
    if ((supportMode === SupportMode.Fragile || supportMode === SupportMode.All) && layerGap < 3) setLayerGap(3);
  }, [supportMode, layerGap]);

  const customBlocksByBase = useMemo(() => {
    const map: Record<number, string[]> = {};
    for (const cc of customColors) {
      for (let i = 0; i < BASE_COLORS.length; ++i) {
        const bc = BASE_COLORS[i];
        if (bc.r === cc.r && bc.g === cc.g && bc.b === cc.b) {
          (map[i] ??= []).includes(cc.block) || map[i].push(cc.block);
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
      name: (a, b) => dir * getDisplayName(BASE_COLORS[a].name).localeCompare(getDisplayName(BASE_COLORS[b].name)),
      options: (a, b) => dir * (BASE_COLORS[a].blocks.length - BASE_COLORS[b].blocks.length),
      color: (a, b) =>
        dir *
        (getHue(BASE_COLORS[a].r, BASE_COLORS[a].g, BASE_COLORS[a].b) -
          getHue(BASE_COLORS[b].r, BASE_COLORS[b].g, BASE_COLORS[b].b)),
      id: (a, b) => dir * (a - b),
      required: (a, b) => dir * ((colorRequiredMap[a] || 0) - (colorRequiredMap[b] || 0)),
    };
    return sorters[sortKey] ? base.sort(sorters[sortKey]) : base;
  }, [sortKey, sortDir, materialCounts, colorRequiredMap, showTransparentRow]);

  const { usedIndices, unusedIndices } = useMemo(() => {
    if (!imageValid || usedBaseColors.size === 0) return { usedIndices: sortedIndices, unusedIndices: [] as number[] };
    const effectiveUsed = new Set<number>(usedBaseColors);
    if (showTransparentRow) effectiveUsed.add(0);
    return {
      usedIndices: sortedIndices.filter(i => effectiveUsed.has(i)),
      unusedIndices: sortedIndices.filter(i => !effectiveUsed.has(i)),
    };
  }, [sortedIndices, imageValid, usedBaseColors, showTransparentRow]);

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
    const isBuiltin = activeIdx < BUILTIN_PRESET_NAMES.length;
    if (isBuiltin) {
      // Spawn a new "Custom" preset instead of mutating the builtin
      const originalBlocks = preset.blocks;
      setSavedBlocks({ ...originalBlocks });
      const newBlocks = { ...originalBlocks, [baseIndex]: block };
      setPresets(prev => {
        let customName = "Custom";
        const existingNames = new Set(prev.map(p => p.name));
        let suffix = 2;
        while (existingNames.has(customName)) {
          customName = `Custom ${suffix++}`;
        }
        return [...prev, { name: customName, blocks: newBlocks }];
      });
      setActiveIdx(presets.length);
    } else {
      setPresets(prev => {
        const n = [...prev];
        n[activeIdx] = { ...n[activeIdx], blocks: { ...n[activeIdx].blocks, [baseIndex]: block } };
        return n;
      });
    }
  };

  const selectPreset = (idx: number) => {
    const builtin = getBuiltinPreset(presets[idx].name);
    if (builtin)
      setPresets(prev => {
        const n = [...prev];
        n[idx] = builtin;
        return n;
      });
    setActiveIdx(idx);
    markSavedDeferred();
  };

  const createPreset = () => {
    const name = prompt("Enter preset name:")?.trim();
    if (!name) return;
    // If a preset with this name already exists, switch to it
    const existingIdx = presets.findIndex(p => p.name === name);
    if (existingIdx !== -1) {
      selectPreset(existingIdx);
      return;
    }
    setPresets(prev => [...prev, { name, blocks: { ...preset.blocks } }]);
    setActiveIdx(presets.length);
    markSavedDeferred();
  };

  const deletePreset = () => {
    if (activeIdx < BUILTIN_PRESET_NAMES.length) return;
    setPresets(prev => prev.filter((_, i) => i !== activeIdx));
    setActiveIdx(0);
    markSavedDeferred();
  };

  const sharePreset = () => {
    markSavedImmediate();
    const url = `${location.origin}${location.pathname}?preset=${encodePreset(
      preset,
      supportFillerBlock,
      shadeFillerBlock,
      supportMode,
      buildMode,
      customColors,
      convertUnsupported,
      suppress2LayerLateFillerBlock,
      proPaletteSeed,
      dominateVoidFillerBlock,
      recessiveVoidFillerBlock,
    )}`;
    navigator.clipboard.writeText(url);
    alert("Preset URL copied to clipboard!");
  };

  const clearImage = () => {
    setImageData(null);
    setImageName("");
    setImageValid(false);
    setPaletteErrors([]);
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
      setPaletteErrors([]);
      convertFileToColorGrid(file, customColors, convertUnsupported)
        .then(analysis => {
        const paletteErrors =
          isLikelyLossyImageFile(file) && analysis.paletteErrors[0]?.startsWith("Converted")
            ? [
                ...analysis.paletteErrors,
                `This is likely due to ${getLossyImageFormatLabel(file)} being a lossy format.`,
              ]
            : analysis.paletteErrors;
        if (analysis.sizeErrors.length > 0 || analysis.unsupportedColors.length > 0) {
          setImageData(null);
          setImageName("");
          setImageValid(false);
          setPaletteErrors(paletteErrors);
          if (fileRef.current) fileRef.current.value = "";
          return;
        }
        setImageData(analysis.imageData);
        setImageName(file.name);
        setImageValid(true);
        setPaletteErrors(paletteErrors);
        setShowUnusedColors(false);
        if (sortKey === "default") {
          setSortKey("required");
          setSortDir("desc");
        }
        })
        .catch((err: unknown) => {
          setImageData(null);
          setImageName("");
          setImageValid(false);
          setPaletteErrors([(err as Error)?.message || "Unable to decode this image format."]);
          if (fileRef.current) fileRef.current.value = "";
        });
    },
    [customColors, convertUnsupported, getLossyImageFormatLabel, isLikelyLossyImageFile, preset.blocks],
  );

  const handleConvertAndDownload = async () => {
    if (!effectiveShape) return;
    setConverting(true);
    try {
      const baseName = imageName.replace(/\.[^/.]+$/, "");
      const result = await convertToNbt(effectiveShape, {
        blockMapping: preset.blocks,
        fillerAssignments: uiFillerAssignments,
        assumeFloor,
        forceZ129,
        customColors,
        baseName,
      });
      const suffixMap: Record<BuildMode, string> = {
        [BuildMode.Flat]: "",
        [BuildMode.InclineDown]: "-incline_down",
        [BuildMode.InclineUp]: "-incline_up",
        [BuildMode.StaircaseNorthline]: "-northline",
        [BuildMode.StaircaseSouthline]: "-southline",
        [BuildMode.StaircaseClassic]: "-classic",
        [BuildMode.StaircaseGrouped]: "-grouped",
        [BuildMode.StaircaseValley]: "-valley",
        [BuildMode.StaircaseParty]: "-party",
        [BuildMode.SuppressSplitRow]: "-split_row",
        [BuildMode.SuppressSplitChecker]: "-split_checker",
        [BuildMode.SuppressCheckerEW]: "-suppress_checker_EW",
        [BuildMode.SuppressPairsEW]: "-suppress_pairs_EW",
        [BuildMode.Suppress2Layer]: "-suppress_2layer",
        [BuildMode.Suppress2LayerLateFillers]: "-suppress_2layer",
        [BuildMode.Suppress2LayerLatePairs]: "-suppress_2layer",
      };
      const suffix = suffixMap[buildMode] ?? `-${buildMode}`;
      const ext = result.isZip ? "zip" : "nbt";
      const mime = result.isZip ? "application/zip" : "application/octet-stream";
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(new Blob([result.data.buffer as ArrayBuffer], { type: mime })),
        download: `${baseName}${suffix}.${ext}`,
      });
      a.click();
    } catch (e: unknown) {
      setPaletteErrors([(e as Error).message || "Conversion failed"]);
    }
    setConverting(false);
  };

  const addCustomColor = () => {
    const block = newCustom.block.trim();
    if (!block) return;
    if (customMode === "custom") {
      const [r, g, b] = [newCustom.r, newCustom.g, newCustom.b].map(v => parseInt(v));
      if ([r, g, b].some(isNaN)) return;
      setCustomColors(prev => [...prev, { r, g, b, block }]);
    } else {
      const { r, g, b } = BASE_COLORS[customMode];
      setCustomColors(prev => [...prev, { r, g, b, block }]);
    }
    setNewCustom({ r: "", g: "", b: "", block: "" });
  };

  const copyColorToClipboard = (r: number, g: number, b: number) =>
    navigator.clipboard.writeText(`#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`);

  const toggleTheme = () => {
    const next = isDark ? "light" : "dark";
    localStorage.setItem("mapart_theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    setIsDark(next === "dark");
  };

  const handleMaterialClick = (blockName: string) => {
    const baseIdx = blockToBaseIndex[blockName];
    if (baseIdx) {
      setHighlightedColorIdx(baseIdx);
      colorRowRefs.current[baseIdx]?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightedColorIdx(null), 2000);
    } else {
      supportFillerInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      supportFillerInputRef.current?.focus();
    }
  };

  const fillerNeedStats = useMemo(
    () => effectiveShape ? analyzeFillerNeeds(effectiveShape) : null,
    [effectiveShape],
  );
  const northRowSingleLine = useMemo(
    () => effectiveShape ? generatedShapeNorthRowIsSingleLine(effectiveShape) : true,
    [effectiveShape],
  );

  const canGenerate = imageValid && missingBlocks.length === 0;
  const hasRequiredCol = materialCounts !== null;
  const northRowFillerCount = fillerNeedStats?.roleCounts.get(FillerRole.ShadeNorthRow) ?? 0;
  const suppressFillerCount = fillerNeedStats?.roleCounts.get(FillerRole.ShadeSuppress) ?? 0;
  const lateSuppressFillerCount = fillerNeedStats?.roleCounts.get(FillerRole.ShadeSuppressLate) ?? 0;
  const getStructuralFillerRoleCount = useCallback(
    (...roles: FillerRole[]) => roles.reduce((sum, role) => sum + (fillerNeedStats?.roleCounts.get(role) ?? 0), 0),
    [fillerNeedStats],
  );
  const shadeFillerRequiredCount = getStructuralFillerRoleCount(
    FillerRole.ShadeNorthRow,
    FillerRole.ShadeSuppress,
  );
  const lateFillerRequiredCount = getStructuralFillerRoleCount(FillerRole.ShadeSuppressLate);
  const dominateVoidFillerRequiredCount = getStructuralFillerRoleCount(FillerRole.ShadeVoidDominant);
  const recessiveVoidFillerRequiredCount = getStructuralFillerRoleCount(FillerRole.ShadeVoidRecessive);
  const supportFillerRequiredCount = useMemo(() => {
    switch (supportMode) {
      case SupportMode.Steps:
        return getStructuralFillerRoleCount(
          FillerRole.StairStep,
          FillerRole.WaterPath,
          FillerRole.SupportWaterBase,
        );
      case SupportMode.All:
        return getStructuralFillerRoleCount(
          FillerRole.SupportAll,
          FillerRole.WaterPath,
          FillerRole.SupportWaterBase,
        );
      case SupportMode.Fragile:
        return getStructuralFillerRoleCount(
          FillerRole.SupportFragile,
          FillerRole.SupportWaterBase,
        );
      case SupportMode.Water:
        return getStructuralFillerRoleCount(
          FillerRole.SupportWaterSides,
          FillerRole.SupportWaterBase,
          FillerRole.WaterPath,
        );
      case SupportMode.None:
      default:
        return 0;
    }
  }, [getStructuralFillerRoleCount, supportMode]);
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
    (!imageData || supportFillerRequiredCount > 0);
  const showShadeFillerInput = !!imageData && shadeFillerRequiredCount > 0;
  const showDominateVoidFillerInput =
    !!imageData &&
    isStaircaseBuildMode(effectiveBuildMode) &&
    effectiveBuildMode !== BuildMode.Flat &&
    dominateVoidFillerRequiredCount > 0;
  const showRecessiveVoidFillerInput =
    !!imageData &&
    isStaircaseBuildMode(effectiveBuildMode) &&
    effectiveBuildMode !== BuildMode.Flat &&
    recessiveVoidFillerRequiredCount > 0;
  const hasAnyFillerInput =
    showSupportFillerInput ||
    showShadeFillerInput ||
    showDominateVoidFillerInput ||
    showRecessiveVoidFillerInput ||
    showLateFillerInput;
  const showNorthRowAlignmentInfo =
    showAlignmentReminder &&
    canGenerate &&
    (forceZ129 || (!shadeFillerShadingDisabled && northRowFillerCount > 0));
  const noFillerWarning = useMemo(() => {
    if (!showNoFillerWarning || !fillerNeedStats) return null;
    const parts: string[] = [];
    if (northRowFillerCount > 0 && (showNooblineWarnings || !northRowSingleLine)) {
      parts.push("North-row shading requires filler placements.");
    }
    if (hasInGridFillerNeed) {
      const suppressLike = isSuppressBuildMode(effectiveBuildMode) || lateSuppressFillerCount > 0;
      parts.push(
        suppressLike
          ? "Suppress-shading requires filler placements."
          : "Some shading-critical fillers are required inside the 128x128 grid.",
      );
    }
    if (parts.length === 0) return null;
    return `Shade-Filler is disabled (${shadeFillerBlock.trim() || "none"}).\n${parts.join("\n")}`;
  }, [
    effectiveBuildMode,
    shadeFillerBlock,
    fillerNeedStats,
    hasInGridFillerNeed,
    lateSuppressFillerCount,
    northRowFillerCount,
    northRowSingleLine,
    showNoFillerWarning,
    showNooblineWarnings,
  ]);
  const vsFillerWarning = useMemo<ShapeWarning | null>(() => {
    type VsEntry = {
      label: "VS-Filler-1" | "VS-Filler-2";
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
      const value = rawValue.trim() || shadeFillerBlock.trim() || "none";
      return { label, value, invalid: isFillerDisabled(value), noobPixels };
    };
    const formatInvalid = (entry: VsEntry) =>
      `${entry.label} is invalid (${entry.value}).\nThere will be ${entry.noobPixels} noob pixel${entry.noobPixels === 1 ? "" : "s"}.`;
    const formatRequired = (label: string, pixels: number) =>
      `${label} ${label.endsWith("s") ? "are" : "is"} required for this image.\n${pixels} spot${pixels === 1 ? "" : "s"} will need manual color-suppression.`;

    const dominant = makeEntry(showDominateVoidFillerInput, "VS-Filler-1", dominateVoidFillerBlock, voidShadowStats.dominant);
    const recessive = makeEntry(showRecessiveVoidFillerInput, "VS-Filler-2", recessiveVoidFillerBlock, voidShadowStats.recessive);

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
        text: `VS-Fillers are invalid (${dominant.value}, ${recessive.value}). There will be ${pixels} noob pixel${pixels === 1 ? "" : "s"} (south-of-transparent with incorrect shading).`,
        invalid: true,
      };
    }
    if (dominant.invalid || recessive.invalid) {
      return { text: formatInvalid(dominant.invalid ? dominant : recessive), invalid: true };
    }
    if (!showVsFillerWarnings) return null;
    const pixels = dominant.noobPixels + recessive.noobPixels;
    return { text: formatRequired("VS-Fillers", pixels), invalid: false };
  }, [
    dominateVoidFillerBlock,
    shadeFillerBlock,
    recessiveVoidFillerBlock,
    showDominateVoidFillerInput,
    showRecessiveVoidFillerInput,
    showVsFillerWarnings,
    voidShadowStats.dominant,
    voidShadowStats.recessive,
  ]);
  const lateFillerWarning = useMemo<ShapeWarning | null>(() => {
    if (!showLateFillerInput || lateFillerRequiredCount <= 0 || !lateFillerShadingDisabled) return null;
    const value = suppress2LayerLateFillerBlock.trim() || shadeFillerBlock.trim() || "none";
    return {
      text: `Late-Filler is invalid (${value}).\n${lateFillerRequiredCount} late suppress spot${lateFillerRequiredCount === 1 ? "" : "s"} require shading.`,
      invalid: true,
    };
  }, [
    showLateFillerInput,
    lateFillerRequiredCount,
    lateFillerShadingDisabled,
    suppress2LayerLateFillerBlock,
    shadeFillerBlock,
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
    let longest = "(none)";
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
    // 6 columns + 5 grid gaps (`gap-1` = 4px).
    const fixedColsPx = 24 + 24 + 135 + 46 + requiredColWidth;
    const gapsPx = 5 * 4;
    // Section wrapper uses `p-2` (8px each side) and `border` (1px each side).
    const sectionInsetsPx = 8 * 2 + 1 * 2;
    return fixedColsPx + blockColWidthPx + gapsPx + sectionInsetsPx;
  }, [blockColMinWidthPx, blockTextureCollapsedWidthPx, requiredColWidth, blockDisplayMode, blockColExpanded]);

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
    paletteErrors.length,
    missingBlocks.length,
    showNoFillerWarning,
    showNorthRowAlignmentInfo,
    colRangeEnabled,
    colStart,
    colEnd,
    usedIndices.length,
    unusedIndices.length,
    showUnusedColors,
    hasNonFlatShades,
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
      const rootRect = root.getBoundingClientRect();
      const rootStyle = getComputedStyle(root);
      const gap = parseFloat(rootStyle.columnGap || rootStyle.gap || "0") || LAYOUT_GAP_PX;
      const threshold = Math.round(leftColumnMinWidthPx + rightColumnMinWidthPx + gap);
      const stackCalc = rootRect.width < threshold;
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
    hasNonFlatShades,
  ]);

  const colWidthMap: Record<ColumnId, string> = {
    clr: "24px", id: "24px", name: "135px",
    block: blockColExpanded ? `minmax(${effectiveBlockColWidthPx}px,1fr)` : `${effectiveBlockColWidthPx}px`,
    options: "46px",
    required: `${requiredColWidth}px`
  };
  const gridColsStyle: React.CSSProperties = {
    gridTemplateColumns: visibleColumns.map(c => colWidthMap[c]).join(" "),
  };

  const colDragProps = (col: ColumnId) => ({
    draggable: true,
    onDragStart: () => { dragColRef.current = col; },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      const from = dragColRef.current;
      if (!from || from === col) return;
      setColumnOrder(prev => {
        const next = prev.filter(c => c !== from);
        const idx = next.indexOf(col);
        next.splice(idx, 0, from);
        return next;
      });
    },
    onDragEnd: () => { dragColRef.current = null; },
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
  const getTextureBlocks = (blocks: string[]): string[] =>
    showExcludedBlocks ? blocks : blocks.filter(b => !isTextureHiddenBlock(b));

  const pad2 = (n: number) => String(n).padStart(2, "\u2007");

  const getColorSwatchShades = useCallback((idx: number): number[] => {
    if (!imageData || !imageValid) return [2, 1, 0];
    const used = usedShadesByBase.get(idx);
    if (!used || used.size === 0) return [2, 1, 0];
    return [...used].sort((a, b) => b - a);
  }, [imageData, imageValid, usedShadesByBase]);

  const getColorSwatchStyle = useCallback((idx: number): React.CSSProperties => {
    const shades = getColorSwatchShades(idx);
    if (shades.length <= 1) {
      const shade = shades[0] ?? 2;
      const [r, g, b] = getShadedRgb({ baseIndex: idx, shade });
      return { backgroundColor: `rgb(${r},${g},${b})` };
    }

    const stops: string[] = [];
    for (let i = 0; i < shades.length; ++i) {
      const shade = shades[i];
      const [r, g, b] = getShadedRgb({ baseIndex: idx, shade });
      const color = `rgb(${r},${g},${b})`;
      const start = (i * 100) / shades.length;
      const end = ((i + 1) * 100) / shades.length;
      stops.push(`${color} ${start}%`, `${color} ${end}%`);
    }
    return { backgroundImage: `linear-gradient(to bottom, ${stops.join(", ")})` };
  }, [getColorSwatchShades]);

  const getShadeLabel = (shade: number): string =>
    shade === 2 ? "light" : shade === 1 ? "flat" : "dark";

  const getBlockIconSrc = useCallback(
    (block: string): string => {
      const key = toBlockIconKey(block);
      if (KNOWN_PRIMARY_ICON_BLOCKS.has(block)) {
        return `${import.meta.env.BASE_URL}block-icons/precomputed/${key}.png`;
      }
      if (KNOWN_EXCLUDED_ICON_BLOCKS.has(block)) {
        return `${import.meta.env.BASE_URL}block-icons/precomputed/unused/${key}.png`;
      }
      return `${import.meta.env.BASE_URL}block-icons/precomputed/${key}.png`;
    },
    [],
  );

  const getShadeTooltip = (idx: number, shade: number): string => {
    const [r, g, b] = getShadedRgb({ baseIndex: idx, shade });
    const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`;
    return `${hex} - Click to copy (${getShadeLabel(shade)})`;
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

  const getSwatchShadeAtPointer = useCallback((e: React.MouseEvent<HTMLDivElement>, swatchShades: number[]): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = Math.min(rect.height - 0.001, Math.max(0, e.clientY - rect.top));
    const bandHeight = rect.height / swatchShades.length;
    const bandIndex = Math.min(swatchShades.length - 1, Math.max(0, Math.floor(y / bandHeight)));
    return swatchShades[bandIndex] ?? swatchShades[0] ?? 2;
  }, []);

  const handleSwatchTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>, idx: number, swatchShades: number[]) => {
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
    const isHighlighted = highlightedColorIdx === idx;
    const allBlocks = getAllBlocks(idx);
    const nameBlocks = getNameBlocks(allBlocks);
    const textureBlocks = getTextureBlocks(allBlocks);
    const selectedBlock = preset.blocks[idx] || "";
    const selectedIsIceWater = idx === WATER_BASE_INDEX && normalizeBlockIconId(selectedBlock) === "ice";
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
                text: "Transparent",
                x: e.clientX + 12,
                y: e.clientY + 12,
              })
            }
            onMouseMove={e =>
              queueSwatchTooltip({
                text: "Transparent",
                x: e.clientX + 12,
                y: e.clientY + 12,
              })
            }
            onMouseLeave={() => queueSwatchTooltip(null)}
          >
            <img
              src={`${import.meta.env.BASE_URL}block-icons/precomputed/world_border.png`}
              alt="Transparent"
              className="w-full h-full object-cover"
              style={{ imageRendering: "pixelated" }}
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
              const [r, g, b] = getShadedRgb({ baseIndex: idx, shade });
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
          title={getDisplayName(color.name)}
        >
          {getDisplayName(color.name)}
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
            title={selectedIsIceWater ? ICE_WATER_TOOLTIP : undefined}
          >
            <option value="">(none)</option>
            {nameBlocks.map(b => (
              <option key={b} value={b} title={idx === WATER_BASE_INDEX && normalizeBlockIconId(b) === "ice" ? ICE_WATER_TOOLTIP : undefined}>
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
                  title="(none)"
                  onClick={() => updateBlock(idx, "")}
                >
                  ∅
                </button>
              )}
              {(textureCollapsed
                ? (selectedBlock !== "" ? [selectedBlock] : [])
                : textureBlocks
              ).map(b => {
                const selected = selectedBlock === b;
                const isIceWaterOption = idx === WATER_BASE_INDEX && normalizeBlockIconId(b) === "ice";
                const hasIcon = KNOWN_PRECOMPUTED_ICON_BLOCKS.has(b);
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
                    title={isIceWaterOption ? `${b} - ${ICE_WATER_TOOLTIP}` : b}
                    onClick={() => updateBlock(idx, b)}
                  >
                    {hasIcon ? (
                      <img
                        src={getBlockIconSrc(b)}
                        alt={b}
                        loading="eager"
                        decoding="sync"
                        className="block w-full h-full object-cover"
                        style={{ imageRendering: "pixelated" }}
                      />
                    ) : (
                      <span className="text-[9px] text-muted-foreground">?</span>
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
        ref={el => { colorRowRefs.current[idx] = el; }}
        className={`grid gap-1 items-center py-px text-xs transition-colors min-w-0 overflow-hidden ${isMissing ? "bg-destructive/30 ring-1 ring-destructive/60 rounded" : ""} ${isHighlighted ? "bg-primary/20 ring-1 ring-primary/60 rounded" : ""}`}
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
            title="Open secrets settings"
          >
            Image → NBT
          </button>
        </h1>
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-muted transition-colors"
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
      </header>

      <div
        ref={layoutRootRef}
        className={`flex gap-2 p-2 max-w-[2000px] mx-auto ${
          isStackedLayout ? "flex-col" : "flex-row flex-wrap items-start"
        }`}
      >
        {/* LEFT COLUMN */}
        <div
          ref={leftColumnRef}
          className={`${isStackedLayout ? "contents" : "block flex-[3_1_0%] min-w-[var(--left-column-min-width)]"} min-w-0`}
          style={{
            ["--color-table-min-width" as any]: `${colorTableMinWidthPx}px`,
            ["--left-column-min-width" as any]: `${leftColumnMinWidthPx}px`,
          }}
        >
          <div className={`${isStackedLayout ? "order-1" : ""} space-y-2`}>
          {/* Preset Manager */}
          <section ref={presetToolbarSectionRef} className="bg-card border border-border rounded-md p-1.5">
            <div
              className={`flex gap-1.5 items-center ${isStackedLayout ? "flex-wrap" : "flex-nowrap"}`}
            >
              <span className="text-xs font-semibold text-accent">Preset:</span>
              <div className="inline-flex items-center gap-1">
                <select
                  className="bg-input border border-border rounded px-2 h-6 text-foreground text-xs"
                  value={activeIdx}
                  onChange={e => selectPreset(Number(e.target.value))}
                >
                  <optgroup label="Built-in">
                    {presets.slice(0, BUILTIN_PRESET_NAMES.length).map((p, i) => (
                      <option key={i} value={i}>{p.name}</option>
                    ))}
                  </optgroup>
                  {presets.length > BUILTIN_PRESET_NAMES.length && (
                    <optgroup label="Custom">
                      {presets.slice(BUILTIN_PRESET_NAMES.length).map((p, i) => (
                        <option key={i + BUILTIN_PRESET_NAMES.length} value={i + BUILTIN_PRESET_NAMES.length}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {presetDirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
                )}
              </div>
              <div className="inline-flex items-center gap-1">
                <span className="text-xs font-semibold text-accent whitespace-nowrap">Support:</span>
                <select
                  className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs cursor-help"
                  value={supportMode}
                  onChange={e => setSupportMode(e.target.value as SupportMode)}
                  title={supportModeTooltip}
                >
                  <option value={SupportMode.All} title={getSupportModeTooltip(SupportMode.All)}>All</option>
                  <option value={SupportMode.None} title={getSupportModeTooltip(SupportMode.None)}>None</option>
                  <option value={SupportMode.Steps} disabled={!enableStepsSupportOption} title={getSupportModeTooltip(SupportMode.Steps)}>
                    Steps
                  </option>
                  <option value={SupportMode.Water} disabled={!enableWaterSupportOption} title={getSupportModeTooltip(SupportMode.Water)}>
                    Water
                  </option>
                  <option value={SupportMode.Fragile} disabled={supportFillerIsFragile || !enableFragileSupportOption} title={getSupportModeTooltip(SupportMode.Fragile)}>Fragile</option>
                </select>
              </div>
              {!isBuiltinUnedited && (
                <button
                  className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                  onClick={sharePreset}
                >
                  Share
                </button>
              )}
              {activeIdx >= BUILTIN_PRESET_NAMES.length && presets.length > BUILTIN_PRESET_NAMES.length && (
                <button
                  className="text-xs px-2 py-0.5 rounded border border-destructive text-destructive hover:bg-destructive/20"
                  onClick={deletePreset}
                >
                  Del
                </button>
              )}
              <button
                className="text-xs px-1.5 py-0.5 rounded border border-primary text-primary hover:bg-primary/20"
                onClick={createPreset}
                title="New preset"
              >
                +
              </button>
              {imageData && !isFlatShape && (
                <div className="ml-auto flex items-center gap-1">
                  {buildModeUsesLayerGap(buildMode) && (
                    <>
                      <span
                        className="text-xs font-semibold text-accent whitespace-nowrap cursor-help"
                        title={LAYER_GAP_TOOLTIP}
                      >
                        Layer gap:
                      </span>
                      <input
                        type="number"
                        min={minLayerGap}
                        max={20}
                        value={layerGap}
                        onChange={e => setLayerGap(Math.max(minLayerGap, Math.min(20, parseInt(e.target.value) || 5)))}
                        title={LAYER_GAP_TOOLTIP}
                        className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs w-12 text-center"
                      />
                    </>
                  )}
                  {buildMode === BuildMode.StaircaseParty && (
                    <label className="text-xs font-semibold text-accent whitespace-nowrap flex items-center gap-1 cursor-pointer">
                      <span>Palette Seed:</span>
                      <input
                        type="checkbox"
                        checked={proPaletteSeed}
                        onChange={e => setProPaletteSeed(e.target.checked)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                    </label>
                  )}
                  <span className="text-xs font-semibold text-accent whitespace-nowrap">
                    Shading Method:
                  </span>
                  <select
                    className={`bg-input border border-border rounded px-2 h-6 text-xs cursor-help ${
                      buildMode === BuildMode.SuppressSplitRow ? "text-muted-foreground" : "text-foreground"
                    }`}
                    value={buildMode}
                    onChange={e => setBuildMode(e.target.value as BuildMode)}
                    title={shadingMethodTooltip}
                  >
                    <optgroup label="Staircase">
                      {staircaseModeOptions.map(opt => (
                        <option key={opt.value} value={opt.value} title={getBuildModeTooltip(opt.value)}>
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Suppress">
                      {suppressModeOptions.map(opt => (
                        <option
                          key={opt.value}
                          value={opt.value}
                          disabled={opt.disabled}
                          data-muted={opt.muted ? "true" : undefined}
                          style={opt.muted ? { color: "var(--muted-foreground)", fontStyle: "italic" } : undefined}
                          title={getBuildModeTooltip(opt.value)}
                        >
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              )}
            </div>
          </section>

          {/* Filler Block + Support + Shading Method */}
          {hasAnyFillerInput && (
          <section
            ref={fillerToolbarSectionRef}
            className={`bg-card border border-border rounded-md p-1.5 flex items-center gap-1.5 ${
              isStackedLayout ? "flex-wrap" : "flex-nowrap"
            }`}
          >
            <span
              className="text-[10px] font-bold uppercase tracking-wide text-primary whitespace-nowrap cursor-help inline-flex items-center px-1.5 h-6 rounded bg-muted border border-border"
              title="Filler block assignments for support, shading, and special-case placements."
            >
              Fillers
            </span>
            <span className="h-4 border-l border-border/70" />
            {showSupportFillerInput && (
              <div className="inline-flex items-center gap-1 shrink-0">
                <span
                  className="text-xs font-semibold text-accent whitespace-nowrap cursor-help"
                  title="Used for support and convenience filler placements, including Steps, All, Fragile, Water support, and water-path connectors."
                >
                  Support:
                </span>
                <div className="inline-flex items-center gap-0 shrink-0">
                  <input
                    ref={supportFillerInputRef}
                    type="text"
                    value={supportFillerBlock}
                    onChange={e => setSupportFillerBlock(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitSupportFillerBlock(e.currentTarget.value);
                    }}
                    placeholder="resin_block"
                    title="Used for support and convenience filler placements, including Steps, All, Fragile, Water support, and water-path connectors."
                    className="max-w-[101px] h-6 text-xs font-mono px-1.5 bg-input border border-border rounded"
                  />
                  {!!imageData && !supportFillerDisabled && supportFillerRequiredCount > 0 && (
                    <>
                      <span className="-mx-px w-2 h-px bg-primary/60 self-center shrink-0" />
                      <span
                        className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1 border-2 border-primary/60 bg-primary/10 rounded px-1.5 h-6"
                        title="Required support/convenience filler placements for the current output range."
                      >
                        <span className="font-semibold">R:</span>
                        <span className="text-foreground">{formatRequiredCount(supportFillerRequiredCount)}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
            {showShadeFillerInput && (
              <>
                {showSupportFillerInput && <span className="h-4 border-l border-border/70" />}
                <div className="inline-flex items-center gap-1 shrink-0">
                  <span
                    className="text-xs font-semibold text-accent whitespace-nowrap cursor-help"
                    title="Used for north-row and suppress shading filler placements."
                  >
                    Shade:
                  </span>
                  <div className="inline-flex items-center gap-0 shrink-0">
                    <input
                      type="text"
                      value={shadeFillerBlock}
                      onChange={e => setShadeFillerBlock(e.target.value)}
                      placeholder="resin_block"
                      title="Used for north-row and suppress shading filler placements."
                      className="max-w-[101px] h-6 text-xs font-mono px-1.5 bg-input border border-border rounded"
                    />
                    {!!imageData && !shadeFillerShadingDisabled && shadeFillerRequiredCount > 0 && (
                      <>
                        <span className="-mx-px w-2 h-px bg-primary/60 self-center shrink-0" />
                        <span
                          className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1 border-2 border-primary/60 bg-primary/10 rounded px-1.5 h-6"
                          title="Required north-row and suppress-shading filler placements for the current output range."
                        >
                          <span className="font-semibold">R:</span>
                          <span className="text-foreground">{formatRequiredCount(shadeFillerRequiredCount)}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
            {showDominateVoidFillerInput && (
              <>
                {(showSupportFillerInput || showShadeFillerInput) && <span className="h-4 border-l border-border/70" />}
                <div className="inline-flex items-center gap-1 shrink-0">
                  <span
                    className="text-xs font-semibold text-accent whitespace-nowrap cursor-help"
                    title="Used when a dominate transparent pixel is overwritten by a filler block to shade the block directly south. This filler will need to be manually suppressed after building the NBT."
                  >
                    VS-1:
                  </span>
                  <div className="inline-flex items-center gap-0 shrink-0">
                    <input
                      type="text"
                      value={dominateVoidFillerBlock}
                      onChange={e => setDominateVoidFillerBlock(e.target.value)}
                      placeholder="slime_block"
                      title="Used when a dominate transparent pixel is overwritten by a filler block to shade the block directly south. This filler will need to be manually suppressed after building the NBT."
                      className="max-w-[101px] h-6 text-xs font-mono px-1.5 bg-input border border-border rounded"
                    />
                    {!!imageData && !dominateVoidFillerShadingDisabled && dominateVoidFillerRequiredCount > 0 && (
                      <>
                        <span className="-mx-px w-2 h-px bg-primary/60 self-center shrink-0" />
                        <span
                          className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1 border-2 border-primary/60 bg-primary/10 rounded px-1.5 h-6"
                          title="Required VS-Filler-1 placements for the current output range."
                        >
                          <span className="font-semibold">R:</span>
                          <span className="text-foreground">{formatRequiredCount(dominateVoidFillerRequiredCount)}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
            {showRecessiveVoidFillerInput && (
              <>
                {(showSupportFillerInput || showShadeFillerInput || showDominateVoidFillerInput) && <span className="h-4 border-l border-border/70" />}
                <div className="inline-flex items-center gap-1 shrink-0">
                  <span
                    className="text-xs font-semibold text-accent whitespace-nowrap cursor-help"
                    title="Used when a recessive transparent pixel is overwritten by a filler block to shade the block directly south. This filler will need to be manually suppressed after building the NBT."
                  >
                    VS-2:
                  </span>
                  <div className="inline-flex items-center gap-0 shrink-0">
                    <input
                      type="text"
                      value={recessiveVoidFillerBlock}
                      onChange={e => setRecessiveVoidFillerBlock(e.target.value)}
                      placeholder="honey_block"
                      title="Used when a recessive transparent pixel is overwritten by a filler block to shade the block directly south. This filler will need to be manually suppressed after building the NBT."
                      className="max-w-[101px] h-6 text-xs font-mono px-1.5 bg-input border border-border rounded"
                    />
                    {!!imageData && !recessiveVoidFillerShadingDisabled && recessiveVoidFillerRequiredCount > 0 && (
                      <>
                        <span className="-mx-px w-2 h-px bg-primary/60 self-center shrink-0" />
                        <span
                          className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1 border-2 border-primary/60 bg-primary/10 rounded px-1.5 h-6"
                          title="Required VS-Filler-2 placements for the current output range."
                        >
                          <span className="font-semibold">R:</span>
                          <span className="text-foreground">{formatRequiredCount(recessiveVoidFillerRequiredCount)}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
            {showLateFillerInput && (
              <>
                {(showSupportFillerInput || showShadeFillerInput || showDominateVoidFillerInput || showRecessiveVoidFillerInput) && <span className="h-4 border-l border-border/70" />}
                <div className="inline-flex items-center gap-1 shrink-0">
                  <span
                    className="text-xs font-semibold text-accent whitespace-nowrap cursor-help"
                    title="Used by Suppress (2-Layer, Late-Fillers) for late lower-layer suppress placements."
                  >
                    Late:
                  </span>
                  <div className="inline-flex items-center gap-0 shrink-0">
                    <input
                      type="text"
                      value={suppress2LayerLateFillerBlock}
                      onChange={e => setSuppress2LayerLateFillerBlock(e.target.value)}
                      placeholder="slime_block"
                      title="Used by Suppress (2-Layer, Late-Fillers) for late lower-layer suppress placements."
                      className="max-w-[101px] h-6 text-xs font-mono px-1.5 bg-input border border-border rounded"
                    />
                    {!!imageData && !lateFillerShadingDisabled && lateFillerRequiredCount > 0 && (
                      <>
                        <span className="-mx-px w-2 h-px bg-primary/60 self-center shrink-0" />
                        <span
                          className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1 border-2 border-primary/60 bg-primary/10 rounded px-1.5 h-6"
                          title="Required late suppress filler placements for the current output range."
                        >
                          <span className="font-semibold">R:</span>
                          <span className="text-foreground">{formatRequiredCount(lateFillerRequiredCount)}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
          )}
          </div>

          <div className={`${isStackedLayout ? "order-3" : "mt-2"} space-y-2`}>
          {/* Color → Block */}
          <section
            className={`bg-card border border-border rounded-md p-2 w-full ${isStackedLayout ? "" : "min-w-[var(--color-table-min-width)]"}`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-accent">Color → Block</h2>
                <span className="h-3 border-l border-border/70" />
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowIds(v => !v)}
                >
                  {showIds ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
                  IDs
                </button>
                <span className="h-3 border-l border-border/70" />
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowNames(v => !v)}
                >
                  {showNames ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
                  Names
                </button>
                <span className="h-3 border-l border-border/70" />
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowOptions(v => !v)}
                >
                  {showOptions ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
                  #Options
                </button>
                <span className="h-3 border-l border-border/70" />
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setBlockDisplayMode(v => (v === "names" ? "textures" : "names"))}
                  title="Toggle block display mode"
                >
                  <Glasses aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                  {blockDisplayMode}
                </button>
              </div>
              {imageInfo && imageValid && (
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
                  <span className="font-semibold text-accent">MC units:</span>
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
              <div className="relative overflow-hidden">
                {hasRequiredCol && usedIndices.length > 0 && visibleColumns.includes("required") && (
                  <div
                    className="absolute inset-0 pointer-events-none grid gap-1"
                    style={gridColsStyle}
                  >
                    {visibleColumns.map(col => (
                      <div
                        key={`required-outline-${col}`}
                        className={col === "required" ? "border-2 border-primary/60 bg-primary/10 rounded" : ""}
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
                        title="Sort by color hue"
                        {...colDragProps("clr")}
                      >
                        Clr{sortArrow("color")}
                      </span>
                    ),
                    id: (
                      <span
                        key="id"
                        className="cursor-pointer select-none whitespace-nowrap pl-0.5"
                        onClick={() => toggleSort("id")}
                        title="Sort by color ID"
                        {...colDragProps("id")}
                      >
                        ID{sortArrow("id")}
                      </span>
                    ),
                    name: (
                      <span
                        key="name"
                        className="cursor-pointer select-none"
                        onClick={() => toggleSort("name")}
                        title="Sort by color name"
                        {...colDragProps("name")}
                      >
                        Name{sortArrow("name")}
                      </span>
                    ),
                    block: (
                      <span
                        key="block"
                        className="inline-flex items-center gap-1 min-w-0 w-full"
                        title="Assigned block used for this color"
                        {...colDragProps("block")}
                      >
                        <button
                          ref={blockHeaderCollapseBtnRef}
                          type="button"
                          className="shrink-0 inline-flex items-center gap-0.5 cursor-pointer select-none whitespace-nowrap text-left"
                          title={blockColExpanded ? "Collapse block column to minimum width" : "Expand block column to fill available width"}
                          aria-label={blockColExpanded ? "Collapse block column" : "Expand block column"}
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setBlockColExpanded(v => !v);
                          }}
                        >
                          {blockColExpanded ? <Minus size={10} /> : <Plus size={10} />}
                          <span>Block</span>
                        </button>
                      </span>
                    ),
                    options: (
                      <span
                        key="options"
                        className="cursor-pointer select-none whitespace-nowrap pr-1"
                        onClick={() => toggleSort("options")}
                        title="Sort by number of available block options"
                        {...colDragProps("options")}
                      >
                        Options{sortArrow("options")}
                      </span>
                    ),
                    required: (
                      <span
                        key="required"
                        className="cursor-pointer select-none whitespace-nowrap text-right pr-2"
                        onClick={() => toggleSort("required")}
                        title="Sort by required block count in the current output"
                        {...colDragProps("required")}
                      >
                        Required{sortKey === "required" ? sortArrow("required") : <span className="invisible"> ▲</span>}
                      </span>
                    ),
                  };
                    return headerMap[col];
                  })}
                </div>
                <div>{usedIndices.map(renderColorRow)}</div>
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
                    <span>{plural(unusedIndices.length, "unused color")} (not in image)</span>
                  </button>
                  {showUnusedColors && <div className="opacity-50">{unusedIndices.map(renderColorRow)}</div>}
                </div>
              )}
            </div>
          </section>

          {/* Custom Colors */}
          <section className="bg-card border border-border rounded-md p-2">
            <div className="flex items-center gap-1 mb-1">
              <h2
                className="text-sm font-semibold text-accent cursor-help"
                title={CUSTOM_COLOR_TOOLTIP}
                aria-label="Custom color shading info"
              >
                Custom Color Mappings
              </h2>
            </div>
            {customColors.length > 0 && (
              <div className="space-y-0.5 mb-2">
                {customColors.map((cc, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <div
                      className="w-4 h-4 rounded border border-border flex-shrink-0"
                      style={{ backgroundColor: `rgb(${cc.r},${cc.g},${cc.b})` }}
                    />
                    <span className="font-mono text-[10px]">
                      ({cc.r},{cc.g},{cc.b})
                    </span>
                    <span className="font-mono text-[10px] text-primary">→ {cc.block}</span>
                    <button
                      className="text-destructive text-[10px] hover:underline"
                      onClick={() => setCustomColors(prev => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 items-center">
              <select
                className="bg-input border border-border rounded px-1 h-6 text-[11px] font-mono text-foreground w-48"
                value={customMode === "custom" ? "custom" : String(customMode)}
                onChange={e => setCustomMode(e.target.value === "custom" ? "custom" : parseInt(e.target.value))}
              >
                <option value="custom">Custom RGB</option>
                {BASE_COLORS.map((_, idx) => (
                  <option key={idx} value={idx}>
                    {idx} – {getDisplayName(BASE_COLORS[idx].name)}
                  </option>
                ))}
              </select>
              {customMode === "custom" && (
                <>
                  {(["r", "g", "b"] as const).map(ch => (
                    <div key={ch} className="flex items-center gap-0.5">
                      <label className="text-[10px] text-muted-foreground">{ch.toUpperCase()}</label>
                      <input
                        className="w-10 h-6 text-[11px] font-mono no-spinner px-1 bg-input border border-border rounded"
                        type="number"
                        min={0}
                        max={255}
                        value={newCustom[ch]}
                        onChange={e => setNewCustom(p => ({ ...p, [ch]: e.target.value }))}
                      />
                    </div>
                  ))}
                </>
              )}
              <div className="flex items-center gap-0.5">
                <label className="text-[10px] text-muted-foreground">Block</label>
                <input
                  className="w-40 h-6 text-[11px] font-mono px-1 bg-input border border-border rounded"
                  placeholder="e.g. fart_block"
                  value={newCustom.block}
                  onChange={e => setNewCustom(p => ({ ...p, block: e.target.value }))}
                />
              </div>
              <button
                className="h-6 px-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
                onClick={addCustomColor}
              >
                Add
              </button>
            </div>
          </section>
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
            <section className="bg-card border border-border rounded-md p-3">
            <h2 className="text-sm font-semibold text-accent mb-2">Upload MapArt Image</h2>
            {/* Convert unsupported colors checkbox – hidden; conversion is now always on
            <label className="flex items-center gap-1.5 mb-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={convertUnsupported}
                onChange={e => setConvertUnsupported(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs text-muted-foreground">Convert unsupported colors</span>
            </label>
            */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {imageName && <p className="text-xs text-primary font-mono truncate mb-1">{imageName}</p>}
            <div className="w-full max-w-[516px] mx-auto">
              <div
                className="rounded-md w-full aspect-square cursor-pointer border-2 border-dashed border-border hover:border-primary/50 transition-colors overflow-hidden flex items-center justify-center"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFile(f);
                }}
              >
                {imageData ? (
                  <canvas
                    className="w-full h-full"
                    style={{ imageRendering: "pixelated" }}
                    ref={el => {
                      if (el && imageData) {
                        el.width = imageData.width;
                        el.height = imageData.height;
                        el.getContext("2d")?.putImageData(imageData, 0, 0);
                      }
                    }}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground text-center px-2">Click or drop a 128×128 image</p>
                )}
              </div>
            </div>

            {paletteErrors.length > 0 && (
              <div
                className={`mt-2 rounded p-2 ${
                  !imageValid
                    ? "bg-destructive/25 border-2 border-destructive/50"
                    : paletteErrors[0]?.startsWith("Converted")
                      ? "bg-warning/20 border-2 border-warning/40"
                      : "bg-primary/10 border-2 border-primary/30"
                }`}
              >
                {paletteErrors.map((e, i) => (
                  <p
                    key={i}
                    className={`text-xs whitespace-pre-wrap ${
                      !imageValid
                        ? "text-destructive font-medium"
                        : e.endsWith("than source image.")
                        ? "text-destructive font-bold"
                          : e.startsWith("This is likely due to ")
                            ? "text-warning font-medium"
                          : e.startsWith("Converted")
                            ? "text-warning font-medium"
                            : "text-primary font-medium"
                    }`}
                  >
                    {e}
                  </p>
                ))}
              </div>
            )}

            {imageValid && missingBlocks.length > 0 && (
              <div className="mt-2 bg-destructive/25 border-2 border-destructive/50 rounded p-2">
                <p className="text-xs text-destructive font-medium">
                  {plural(missingBlocks.length, "color")} in the image {missingBlocks.length === 1 ? "has" : "have"} no
                  block assigned in the preset.
                </p>
              </div>
            )}

            {noFillerWarning && (
              <div className="mt-2 bg-warning/20 border-2 border-warning/40 rounded p-2">
                <p className="text-xs text-warning font-medium whitespace-pre-line">
                  {noFillerWarning}
                </p>
              </div>
            )}

            {vsFillerWarning && (
              <div className="mt-2 bg-warning/20 border-2 border-warning/40 rounded p-2">
                <p className={`text-xs whitespace-pre-line ${vsFillerWarning.invalid ? "text-destructive font-bold" : "text-warning font-medium"}`}>
                  {vsFillerWarning.text}
                </p>
              </div>
            )}

            {lateFillerWarning && (
              <div className="mt-2 bg-warning/20 border-2 border-warning/40 rounded p-2">
                <p className={`text-xs whitespace-pre-line ${lateFillerWarning.invalid ? "text-destructive font-bold" : "text-warning font-medium"}`}>
                  {lateFillerWarning.text}
                </p>
              </div>
            )}

            {showNorthRowAlignmentInfo && (
              <div className="mt-2 bg-muted/30 border border-border rounded p-2">
                <p className="text-xs text-muted-foreground font-medium whitespace-pre-line">
                  {"Note: Align 128x128 color area to the map grid.\nExpect 1 extra top north row (NBT is 128x129)."}
                </p>
              </div>
            )}

            {canGenerate && imageHasWater && usesIceForWater && (
              <div className="mt-2 bg-muted/30 border border-border rounded p-2">
                <p className="text-xs text-muted-foreground font-medium whitespace-pre-line">
                  {"Note: Ice has been selected for water-color.\nConvert it to water in-game for colors to be accurate."}
                </p>
              </div>
            )}

            {imageData && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  className="text-xs px-2 py-1.5 rounded border border-destructive text-destructive hover:bg-destructive/20 whitespace-nowrap"
                  onClick={clearImage}
                >
                  Remove
                </button>
                {canGenerate && (
                  <button
                    onClick={handleConvertAndDownload}
                    disabled={converting}
                    className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {converting
                      ? "Converting..."
                      : buildMode === BuildMode.SuppressSplitRow || buildMode === BuildMode.SuppressSplitChecker
                        ? "Generate .zip"
                        : "Generate .nbt"}
                  </button>
                )}
              </div>
            )}

            {imageInfo && imageValid && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap items-center">
                  {numUniqueColorShadesForPart > numColorBlockTypesForPart && (
                    <span>
                      <strong className="text-foreground">{plural(numUniqueColorShadesForPart, "unique color")}</strong>
                    </span>
                  )}
                  <span>
                    <strong className="text-foreground">{plural(numColorBlockTypesForPart, "block type")}</strong>
                  </span>
                  {voidShadowCount > 0 && (
                    <span>
                      <strong className="text-foreground">{plural(voidShadowCount, "void shadow")}</strong>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <button
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${colRangeEnabled ? "border-primary bg-primary/15 text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setColRangeEnabled(v => !v)}
                  >
                    {isStepRangeMode ? "Step range" : "Column range"}
                  </button>
                </div>
                {colRangeEnabled && (
                  <div className="mt-1 border border-border rounded p-1.5 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-foreground w-6 text-right">{colStart}</span>
                      <div
                        className="relative flex-1 h-4 select-none touch-none"
                        onPointerDown={e => {
                          const el = e.currentTarget;
                          el.setPointerCapture(e.pointerId);
                          const rect = el.getBoundingClientRect();
                          const valFromEvent = (ev: PointerEvent) => {
                            const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                            return Math.round(pct * maxRangeIndex);
                          };
                          const val = valFromEvent(e.nativeEvent);
                          // When both thumbs overlap, choose the side that allows the range to expand again.
                          const grabStart =
                            colStartRef.current === colEndRef.current
                              ? colStartRef.current >= maxRangeIndex
                              : Math.abs(val - colStartRef.current) <= Math.abs(val - colEndRef.current);
                          const update = (v: number) => {
                            if (grabStart) setColStart(Math.min(v, colEndRef.current));
                            else setColEnd(Math.max(v, colStartRef.current));
                          };
                          update(val);
                          const onMove = (ev: PointerEvent) => update(valFromEvent(ev));
                          const onUp = () => {
                            el.removeEventListener("pointermove", onMove);
                            el.removeEventListener("pointerup", onUp);
                          };
                          el.addEventListener("pointermove", onMove);
                          el.addEventListener("pointerup", onUp);
                        }}
                      >
                        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 rounded bg-border" />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-1 rounded bg-primary"
                          style={{
                            left: `${maxRangeIndex > 0 ? (colStart / maxRangeIndex) * 100 : 0}%`,
                            right: `${100 - (maxRangeIndex > 0 ? (colEnd / maxRangeIndex) * 100 : 0)}%`,
                          }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground -ml-1.5"
                          style={{ left: `${maxRangeIndex > 0 ? (colStart / maxRangeIndex) * 100 : 0}%` }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground -ml-1.5"
                          style={{ left: `${maxRangeIndex > 0 ? (colEnd / maxRangeIndex) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-foreground w-6">{colEnd}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            </section>
          </div>

          {/* Credits */}
          <div
            ref={creditsRef}
            className={`${isStackedLayout ? "order-4" : ""} text-[11px] text-muted-foreground text-left space-y-0.5 px-1 pt-4`}
            style={creditsFloatGapPx > 0 ? { transform: `translateY(${creditsFloatGapPx}px)` } : undefined}
          >
            <h3 className="text-xs font-semibold text-accent mb-1">Credits</h3>
            <p>
              <a
                href="https://www.youtube.com/@evmodder"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                EvModder
              </a>{" "}
              — Developer
            </p>
            <p>
              <a
                href="https://rebane2001.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Rebane2001
              </a>{" "}
              — Original creator of{" "}
              <a
                href="https://mike2b2t.github.io/mapartcraft/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                MapArtCraft
              </a>
            </p>
            <p>
              <a
                href="https://youtube.com/@gust4v_"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Gu2t4v
              </a>{" "}
              — Suppression expert, inventor of 2‑Layer method
            </p>
            <p>Note: GPT was used for parts of this site</p>
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
              <h2 className="text-sm font-semibold text-accent">Secret Settings</h2>
              <button
                type="button"
                className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
                onClick={() => setShowSecretsDialog(false)}
              >
                Close
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
                <span>Show color_id=0 row</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showExcludedBlocks}
                  onChange={e => setShowExcludedBlocks(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>Show excluded blocks</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceZ129}
                  onChange={e => setForceZ129(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>Z-width always 129</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assumeFloor}
                  onChange={e => setAssumeFloor(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>Assume floor</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAlignmentReminder}
                  onChange={e => setShowAlignmentReminder(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>Show alignment reminder</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showNooblineWarnings}
                  onChange={e => setShowNooblineWarnings(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>Show warnings for nooblines</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showVsFillerWarnings}
                  onChange={e => setShowVsFillerWarnings(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>Show warnings when VS-Fillers are required in Staircase maps</span>
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

export default Index;
