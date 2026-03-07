import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue, useLayoutEffect } from "react";
import { Moon, Sun, Plus, Minus } from "lucide-react";
import { BASE_COLORS, WATER_BASE_INDEX, getColorLookup, getShadedRgb } from "@/data/mapColors";
import { EXCLUDED_COLORS } from "@/data/excludedColors";
import {
  validatePng,
  convertToNbt,
  computeMaterialCounts,
  computeBuildModeSignature,
  analyzeFillerNeeds,
  isFillerDisabled,
  isShadeFillerDisabled,
  type CustomColor,
  type BuildMode,
  type SupportMode,
} from "@/lib/converter";
import {
  buildCustomShadeLookup,
  computeImageInfo,
  countVoidShadows,
  detectUniformNonFlatDirection,
  imageHasNonFlatShades,
  scanSuppressedPixels,
} from "@/lib/imageAnalysis";
import { toBlockIconKey } from "@/lib/blockIconKey";
import { isFragileBlock } from "@/data/fragileBlocks";
import {
  BUILTIN_PRESET_NAMES,
  buildPistonClearPreset,
  getBuiltinPreset,
  isAutoCustomPresetName,
  loadPresets,
  type Preset,
} from "@/lib/presets";

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
const KNOWN_PRIMARY_ICON_BLOCKS = new Set(
  BASE_COLORS.flatMap(c => c.blocks),
);
const KNOWN_EXCLUDED_ICON_BLOCKS = new Set(EXCLUDED_COLORS.flat());
const KNOWN_PRECOMPUTED_ICON_BLOCKS = new Set([...KNOWN_PRIMARY_ICON_BLOCKS, ...KNOWN_EXCLUDED_ICON_BLOCKS]);
const isTextureHiddenBlock = (blockName: string): boolean => {
  const id = normalizeBlockIconId(blockName);
  return id.endsWith("_door") || id.endsWith("_fence_gate") || id === "bedrock";
};

// ── Creative menu order for wool/terracotta colors ──
const WOOL_CREATIVE_ORDER = [8, 22, 21, 29, 26, 28, 15, 18, 19, 27, 23, 17, 25, 24, 16, 20];
const TERRACOTTA_CREATIVE_ORDER = [36, 44, 43, 51, 48, 50, 37, 40, 41, 49, 45, 39, 47, 46, 38, 42];

const DEFAULT_SORTED = (() => {
  const fixedSet = new Set([...WOOL_CREATIVE_ORDER, ...TERRACOTTA_CREATIVE_ORDER]);
  const others = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => i + 1)
    .filter(i => !fixedSet.has(i))
    .sort((a, b) => BASE_COLORS[b].blocks.length - BASE_COLORS[a].blocks.length);
  return [...WOOL_CREATIVE_ORDER, ...TERRACOTTA_CREATIVE_ORDER, ...others];
})();

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

const DEFAULT_STAIRCASE_OPTIONS: ModeOption[] = [
  { value: "staircase_valley", label: "Staircase (Valley)" },
  { value: "staircase_classic", label: "Staircase (Classic)" },
  { value: "staircase_grouped", label: "Staircase (Grouped)" },
  { value: "staircase_northline", label: "Staircase (Northline)" },
  { value: "staircase_southline", label: "Staircase (Southline)" },
  { value: "staircase_pro", label: "Staircase (Pro Version)" },
];
const PAGE_CONTENT_PADDING_PX = 8; // from outer wrapper `p-2`
const LAYOUT_GAP_PX = 8;

const BASE_SUPPRESS_OPTIONS: ModeOption[] = [
  { value: "suppress_rowsplit", label: "Suppress (Row-split)", muted: true },
  { value: "suppress_checker", label: "Suppress (Checker-split)" },
  { value: "suppress_checker_ew", label: "Suppress (Checker, E→W)" },
  { value: "suppress_pairs_ew", label: "Suppress (Pairs, E→W)" },
];

const CUSTOM_COLOR_TOOLTIP_LINE1 = "Custom RGB is interpreted as the base/light shade for the color ID.";
const CUSTOM_COLOR_TOOLTIP_LINE2 = "Dark and flat shades are derived automatically using standard multipliers.";
const CUSTOM_COLOR_TOOLTIP_LINE3 = "Once added, all three new shades will be available to use for input images.";
const CUSTOM_COLOR_TOOLTIP = `${CUSTOM_COLOR_TOOLTIP_LINE1}\n${CUSTOM_COLOR_TOOLTIP_LINE2}\n${CUSTOM_COLOR_TOOLTIP_LINE3}`;
const CALC_FILLER_SENTINEL = "__calc_filler__";
const CALC_DELAYED_FILLER_SENTINEL = "__calc_delayed_filler__";
const CALC_BASE_TOKEN_PREFIX = "__calc_base_";
const CALC_CUSTOM_TOKEN_PREFIX = "__calc_custom_";

const SUPPRESS_2LAYER_BASE_FLOW =
  "Steps:\n" +
  "1) Build all 'non-late' blocks\n" +
  "2) Update the full map\n" +
  "3) Begin remove the upper layer, 1-2 columns at a time\n" +
  "4) For each removed column, also add in any late-blocks\n" +
  "5) Carefully update just the dominate pixels for the target column(s)\n" +
  "6) Repeat for the entire map\n\n" +
  "Layer gap controls vertical spacing between lower and upper suppress layers.";
const LAYER_GAP_TOOLTIP = "Layer gap controls the vertical spacing between lower and upper 2-layer suppress sections.";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatStacks(count: number): string {
  if (count < 64) return String(count);
  const sb = Math.floor(count / (64 * 27));
  const rem = count % (64 * 27);
  const st = Math.floor(rem / 64);
  const items = rem % 64;
  return [sb && `${sb}sb`, st && `${st}st`, items && String(items)].filter(Boolean).join(" ") || "0";
}

function encodePreset(
  preset: Preset, fillerBlock: string, supportMode: SupportMode,
  buildMode: BuildMode, customColors: CustomColor[], convertUnsupported: boolean,
  suppress2LayerDelayedFillerBlock: string, proPaletteSeed: boolean,
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
    fillerBlock,
    supportMode,
    buildMode,
    ccStr,
    convertUnsupported ? "1" : "0",
    suppress2LayerDelayedFillerBlock,
    proPaletteSeed ? "1" : "0",
  ].join("|");
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodePreset(encoded: string): {
  preset: Preset; filler?: string; supportMode?: SupportMode;
  buildMode?: BuildMode; customColors?: CustomColor[]; convertUnsupported?: boolean;
  suppress2LayerDelayedFillerBlock?: string; proPaletteSeed?: boolean;
} | null {
  try {
    let s = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const sections = atob(s).split("|");
    if (sections.length < 2) return null;

    const supportRaw = sections[3] || "none";
    const supportMode: SupportMode =
      supportRaw === "1" ? "steps" : supportRaw === "0" ? "none" : (supportRaw as SupportMode);

    const blocks: Record<number, string> = {};
    for (const [i, p] of sections[1].split(",").entries()) {
      if (i >= BASE_COLORS.length - 1) break;
      const baseIdx = i + 1;
      blocks[baseIdx] =
        p === "-" || p === "" ? "" : p.startsWith("=") ? p.slice(1) : BASE_COLORS[baseIdx].blocks[parseInt(p)] || "";
    }

    const customColors = sections[5]
      ? sections[5]
          .split(";")
          .map(entry => {
            const [rgb, block] = entry.split(":");
            const [r, g, b] = rgb.split(",").map(Number);
            return { r, g, b, block };
          })
          .filter(cc => !isNaN(cc.r) && cc.block)
      : undefined;

    const convertUnsupported = sections[6] === "1" ? true : sections[6] === "0" ? false : undefined;
    const suppress2LayerDelayedFillerBlock = sections[7] || undefined;
    const proPaletteSeed = sections[8] === "1" ? true : sections[8] === "0" ? false : undefined;

    return {
      preset: { name: sections[0], blocks }, filler: sections[2] || undefined,
      supportMode, buildMode: (sections[4] || undefined) as BuildMode | undefined,
      customColors, convertUnsupported, suppress2LayerDelayedFillerBlock, proPaletteSeed,
    };
  } catch {
    return null;
  }
}

// ── Cached localStorage keys ──
const LS_KEYS = {
  filler: "mapart_filler",
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
  suppress2LayerDelayedFiller: "mapart_suppress2layer_delayed_filler",
  proPaletteSeed: "mapart_pro_palette_seed",
  columnOrder: "mapart_columnOrder",
  showTransparentRow: "mapart_secret_showTransparentRow",
  showExcludedBlocks: "mapart_secret_showExcludedBlocks",
  forceZ129: "mapart_secret_forceZ129",
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
  const [fillerBlock, setFillerBlock] = useState(() => loadCached(LS_KEYS.filler, "resin_block"));
  const [suppress2LayerDelayedFillerBlock, setSuppress2LayerDelayedFillerBlock] = useState(() =>
    loadCached(LS_KEYS.suppress2LayerDelayedFiller, "slime_block"),
  );
  const [buildMode, setBuildMode] = useState<BuildMode>(() =>
    loadCached(LS_KEYS.buildMode, "staircase_classic" as BuildMode),
  );
  const [proPaletteSeed, setProPaletteSeed] = useState(() => loadCached(LS_KEYS.proPaletteSeed, false));
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
    loadCached(LS_KEYS.supportMode, "none" as SupportMode),
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
  const [showSecretsDialog, setShowSecretsDialog] = useState(false);
  const dragColRef = useRef<ColumnId | null>(null);
  const [highlightedColorIdx, setHighlightedColorIdx] = useState<number | null>(null);
  const [swatchTooltip, setSwatchTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const swatchTooltipRafRef = useRef<number | null>(null);
  const swatchTooltipPendingRef = useRef<{ text: string; x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const fillerInputRef = useRef<HTMLInputElement>(null);
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

  const preset = presets[activeIdx] || buildPistonClearPreset();

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
      [LS_KEYS.filler]: fillerBlock,
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
      [LS_KEYS.suppress2LayerDelayedFiller]: suppress2LayerDelayedFillerBlock,
      [LS_KEYS.proPaletteSeed]: proPaletteSeed,
      [LS_KEYS.columnOrder]: columnOrder,
      [LS_KEYS.showTransparentRow]: showTransparentRow,
      [LS_KEYS.showExcludedBlocks]: showExcludedBlocks,
      [LS_KEYS.forceZ129]: forceZ129,
    }),
    [
      fillerBlock,
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
      suppress2LayerDelayedFillerBlock,
      proPaletteSeed,
      columnOrder,
      showTransparentRow,
      showExcludedBlocks,
      forceZ129,
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

  const hasNonFlatShades = useMemo(
    () => imageData ? imageHasNonFlatShades(imageData, customColors) : false,
    [imageData, customColors],
  );
  const hasSuppressPattern = useMemo(
    () => imageData && hasNonFlatShades ? scanSuppressedPixels(imageData, customColors, false) > 0 : false,
    [imageData, customColors, hasNonFlatShades],
  );
  const voidShadowCount = useMemo(
    () => imageData ? countVoidShadows(imageData, customColors) : 0,
    [imageData, customColors],
  );

  const usedShadesByBase = useMemo(() => {
    if (!imageData || !imageValid) return new Map<number, Set<number>>();
    const lookup = getColorLookup();
    const used = new Map<number, Set<number>>();
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const match = lookup.get(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      if (!match) continue;
      let shades = used.get(match.baseIndex);
      if (!shades) {
        shades = new Set<number>();
        used.set(match.baseIndex, shades);
      }
      shades.add(match.shade);
    }
    return used;
  }, [imageData, imageValid]);
  const usedBaseColors = useMemo(() => new Set<number>(usedShadesByBase.keys()), [usedShadesByBase]);

  const imageHasWater = useMemo(() => usedBaseColors.has(WATER_BASE_INDEX), [usedBaseColors]);
  const imageHasTransparency = useMemo(() => {
    if (!imageData) return false;
    const d = imageData.data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] === 0) return true;
    }
    return false;
  }, [imageData]);

  const fillerIsNoneColor = useMemo(() => {
    const stripped = fillerBlock.split("[")[0];
    return !BASE_COLORS.slice(1).some(bc => bc.blocks.some(b => b.split("[")[0] === stripped));
  }, [fillerBlock]);
  const fillerBlockId = useMemo(() => fillerBlock.trim().toLowerCase().replace(/^minecraft:/, "").split("[")[0], [fillerBlock]);
  const fillerIsFragile = useMemo(() => fillerBlockId.length > 0 && isFragileBlock(fillerBlockId), [fillerBlockId]);
  const fillerDisabled = useMemo(() => isFillerDisabled(fillerBlock), [fillerBlock]);
  const fillerShadingDisabled = useMemo(() => isShadeFillerDisabled(fillerBlock), [fillerBlock]);
  const disabledFillerPlaceholder = useMemo(() => {
    const used = new Set<string>();
    for (const b of Object.values(preset.blocks)) if (b) used.add(b);
    for (const cc of customColors) if (cc.block?.trim()) used.add(cc.block.trim());
    return BASE_COLORS[0].blocks.find(b => !used.has(b)) ?? BASE_COLORS[0].blocks[0];
  }, [preset.blocks, customColors]);

  const missingBlocks = useMemo(() => {
    if (!imageValid || usedBaseColors.size === 0) return [];
    return [...usedBaseColors].filter(idx => idx > 0 && !preset.blocks[idx]);
  }, [imageValid, usedBaseColors, preset.blocks]);

  const imageInfo = useMemo(
    () => imageData && imageValid ? computeImageInfo(imageData, customColors) : null,
    [imageData, imageValid, customColors],
  );

  const effectiveBuildMode = hasNonFlatShades ? buildMode : "flat";
  const isStepRangeMode = effectiveBuildMode === "suppress_pairs_ew" || effectiveBuildMode === "suppress_checker_ew";
  const maxRangeIndex = useMemo(() => {
    if (effectiveBuildMode === "suppress_checker_ew") return 64; // 65 steps
    if (effectiveBuildMode === "suppress_pairs_ew") return 128; // 129 steps
    return 127; // column range mode
  }, [effectiveBuildMode]);
  const minLayerGap = supportMode === "fragile" || supportMode === "all" ? 3 : 2;
  const calcLayerGapForBuild = effectiveBuildMode.startsWith("suppress_2layer") ? calcLayerGap : minLayerGap;
  const structuralProSeed = effectiveBuildMode === "staircase_pro" ? calcProPaletteSeed : false;
  const supportNeedsRealBlockTypes = supportMode === "fragile" || supportMode === "water";
  const structuralBlockMapping = useMemo(() => {
    const mapping: Record<number, string> = {};
    for (let i = 1; i < BASE_COLORS.length; ++i) mapping[i] = `${CALC_BASE_TOKEN_PREFIX}${i}`;
    return mapping;
  }, []);
  const structuralCustomColors = useMemo(
    () => customColors.map((cc, idx) => ({ ...cc, block: `${CALC_CUSTOM_TOKEN_PREFIX}${idx}` })),
    [customColors],
  );
  const signatureBlockMapping = useMemo(
    () => (supportNeedsRealBlockTypes ? preset.blocks : structuralBlockMapping),
    [supportNeedsRealBlockTypes, preset.blocks, structuralBlockMapping],
  );
  const signatureCustomColors = useMemo(
    () => (supportNeedsRealBlockTypes ? customColors : structuralCustomColors),
    [supportNeedsRealBlockTypes, customColors, structuralCustomColors],
  );

  const uniformNonFlatDirection = useMemo(
    () => imageData && imageValid ? detectUniformNonFlatDirection(imageData, customColors) : "mixed",
    [imageData, imageValid, customColors],
  );

  const staircaseModeOptionsByFillerMode = useMemo((): { enabled: ModeOption[]; disabled: ModeOption[] } => {
    if (!imageData || !imageValid || !hasNonFlatShades) {
      return { enabled: DEFAULT_STAIRCASE_OPTIONS, disabled: DEFAULT_STAIRCASE_OPTIONS };
    }

    if (uniformNonFlatDirection === "all_light") {
      const single = [{ value: "staircase_northline", label: "Incline (Down)" }];
      return { enabled: single, disabled: single };
    }
    if (uniformNonFlatDirection === "all_dark") {
      const single = [{ value: "staircase_northline", label: "Incline (Up)" }];
      return { enabled: single, disabled: single };
    }

    const build = (shadeDisabled: boolean): ModeOption[] => {
      const seen = new Set<string>();
      const unique: ModeOption[] = [];
      const signatureFillerBlock = shadeDisabled ? disabledFillerPlaceholder : CALC_FILLER_SENTINEL;
      for (const opt of DEFAULT_STAIRCASE_OPTIONS) {
        try {
          const signature = computeBuildModeSignature(imageData, {
            blockMapping: signatureBlockMapping,
            fillerBlock: signatureFillerBlock,
            suppress2LayerDelayedFillerBlock: CALC_DELAYED_FILLER_SENTINEL,
            // Palette-seed toggle only affects Pro Version output randomness;
            // mode-list dedupe should stay stable/cheap when toggling it.
            proPaletteSeed: false,
            forceZ129,
            customColors: signatureCustomColors,
            buildMode: opt.value,
            supportMode,
            baseName: "",
            layerGap: minLayerGap,
          });
          if (seen.has(signature)) continue;
          seen.add(signature);
        } catch {
          // If signature generation fails for any mode, keep option visible.
        }
        unique.push(opt);
      }
      return unique.length > 0 ? unique : DEFAULT_STAIRCASE_OPTIONS;
    };

    return {
      enabled: build(false),
      disabled: build(true),
    };
  }, [
    imageData,
    imageValid,
    hasNonFlatShades,
    uniformNonFlatDirection,
    signatureBlockMapping,
    signatureCustomColors,
    supportMode,
    minLayerGap,
    forceZ129,
    disabledFillerPlaceholder,
  ]);
  const staircaseModeOptions = useMemo(
    () => (fillerShadingDisabled ? staircaseModeOptionsByFillerMode.disabled : staircaseModeOptionsByFillerMode.enabled),
    [fillerShadingDisabled, staircaseModeOptionsByFillerMode],
  );

  const lateFillersNeedStats = useMemo(() => {
    if (!imageData || !imageValid || !hasNonFlatShades) return null;
    try {
      return analyzeFillerNeeds(imageData, {
        blockMapping: structuralBlockMapping,
        fillerBlock: CALC_FILLER_SENTINEL,
        suppress2LayerDelayedFillerBlock: CALC_DELAYED_FILLER_SENTINEL,
        proPaletteSeed: false,
        customColors: structuralCustomColors,
        buildMode: "suppress_2layer_late_fillers",
        supportMode: "none",
        baseName: "",
        layerGap: calcLayerGap,
      });
    } catch {
      return null;
    }
  }, [
    imageData,
    imageValid,
    hasNonFlatShades,
    structuralBlockMapping,
    structuralCustomColors,
    calcLayerGap,
  ]);

  const twoLayerHasLateVoidNeed = (lateFillersNeedStats?.delayedTotal ?? 0) > 0;

  const suppressModeOptions = useMemo((): ModeOption[] => {
    const options: ModeOption[] = [...BASE_SUPPRESS_OPTIONS];
    if (twoLayerHasLateVoidNeed) {
      options.push({ value: "suppress_2layer_late_fillers", label: "Suppress (2-Layer, Late-Fillers)" });
      options.push({ value: "suppress_2layer_late_pairs", label: "Suppress (2-Layer, Late-Pairs)" });
    } else {
      options.push({ value: "suppress_2layer_late_fillers", label: "Suppress (2-Layer)" });
    }
    return options;
  }, [twoLayerHasLateVoidNeed]);

  const getBuildModeTooltip = useCallback(
    (mode: BuildMode): string => {
      switch (mode) {
        case "staircase_valley":
          return "Minimizes maxY-minY diff, and splits up N→S columns, lowering each segment as much as possible";
        case "staircase_classic":
          return "Minimizes maxY-minY diff, while keeping N→S columns contiguous";
        case "staircase_grouped":
          return "Valley-style segmentation with safe cross-column grouping to reduce isolated low runs";
        case "staircase_northline":
          return "Aligns each column N→S from a reference (noob)line of blocks";
        case "staircase_southline":
          return "Aligns each column S→N from a reference line of blocks (the bottom row)";
        case "staircase_pro":
          return "Same MapArt, but makes the build process more fun and exciting!";
        case "suppress_rowsplit":
          return "Split-row; available for compatibility, but generally not useful";
        case "suppress_checker":
          return "Split NBT generations for dominant/recessive placements";
        case "suppress_checker_ew":
          return "Stepwise E→W checker handling: 4 columns per step (2 dominant east, 2 recessive west), overlapping by 2 columns";
        case "suppress_pairs_ew":
          return "Split into East-West pairs in a interlacing 'brick' pattern; currently only supports updating from E→W";
        case "suppress_2layer_late_pairs":
          return (
            "Suppress-phase placements are isolated on the highest Y-layer, and should be skipped during initial build-phase.\n\n" +
            SUPPRESS_2LAYER_BASE_FLOW
          );
        case "suppress_2layer_late_fillers":
          if (twoLayerHasLateVoidNeed) return (
            "Suppress-phase placements use a custom 'late filler' block, and should be skipped during initial build-phase.\n\n" +
            SUPPRESS_2LAYER_BASE_FLOW
          );
          return (
            "Steps:\n" +
            "1) Build everything\n" +
            "2) Update the full map\n" +
            "3) Begin removing the upper layer, 1-2 columns at a time\n" +
            "4) Carefully update *just* the dominate pixels for the target column(s)\n" +
            "5) Repeat, column-by-column, for the entire map\n\n" +
            "Layer gap controls vertical spacing between lower and upper suppress layers."
          );
        case "flat":
          return "Flat: no staircase/suppress shading needed (all non-transparent pixels are flat shade).";
        default:
          return "Selected shading method.";
      }
    },
    [twoLayerHasLateVoidNeed],
  );

  const shadingMethodTooltip = useMemo(() => getBuildModeTooltip(buildMode), [getBuildModeTooltip, buildMode]);

  const getSupportModeTooltip = useCallback((mode: SupportMode): string => {
    switch (mode) {
      case "none":
        return "No extra support blocks are added.";
      case "steps":
        return "Adds support blocks under staircase step transitions.";
      case "all":
        return "Adds support blocks below every generated block.";
      case "fragile":
        return "Adds support blocks only below fragile blocks.";
      case "water":
        return "Adds support blocks around water blocks (N/S/E/W and below).";
      default:
        return "Selected support mode.";
    }
  }, []);
  const supportModeTooltip = useMemo(() => getSupportModeTooltip(supportMode), [getSupportModeTooltip, supportMode]);

  const materialStatsProSeed = useMemo(
    () => (
      effectiveBuildMode === "staircase_pro" && supportMode === "none"
        ? false
        : structuralProSeed
    ),
    [effectiveBuildMode, supportMode, structuralProSeed],
  );
  const materialNeedsRealBlocks = useMemo(
    () => supportNeedsRealBlockTypes || (effectiveBuildMode === "staircase_pro" && materialStatsProSeed),
    [supportNeedsRealBlockTypes, effectiveBuildMode, materialStatsProSeed],
  );
  const materialBlockMapping = useMemo(
    () => (materialNeedsRealBlocks ? preset.blocks : structuralBlockMapping),
    [materialNeedsRealBlocks, preset.blocks, structuralBlockMapping],
  );
  const materialCustomColors = useMemo(
    () => (materialNeedsRealBlocks ? customColors : structuralCustomColors),
    [materialNeedsRealBlocks, customColors, structuralCustomColors],
  );

  const rawMaterialCountsByFillerMode = useMemo(() => {
    if (!imageData || !imageValid) return null;
    const baseOptions = {
      blockMapping: materialBlockMapping,
      suppress2LayerDelayedFillerBlock: CALC_DELAYED_FILLER_SENTINEL,
      proPaletteSeed: materialStatsProSeed,
      customColors: materialCustomColors,
      buildMode: effectiveBuildMode,
      supportMode,
      baseName: "",
      layerGap: calcLayerGapForBuild,
      ...(colRangeEnabled ? (isStepRangeMode ? { stepRange: [colStart, colEnd] } : { columnRange: [colStart, colEnd] }) : {}),
    };
    try {
      const enabled = computeMaterialCounts(imageData, {
        ...baseOptions,
        fillerBlock: CALC_FILLER_SENTINEL,
      });
      const disabled = computeMaterialCounts(imageData, {
        ...baseOptions,
        fillerBlock: disabledFillerPlaceholder,
      });
      return { enabled, disabled };
    } catch {
      return null;
    }
  }, [
    imageData,
    imageValid,
    materialBlockMapping,
    materialStatsProSeed,
    materialCustomColors,
    effectiveBuildMode,
    supportMode,
    calcLayerGapForBuild,
    isStepRangeMode,
    colRangeEnabled,
    colStart,
    colEnd,
    disabledFillerPlaceholder,
  ]);
  const rawMaterialCounts = useMemo(
    () =>
      rawMaterialCountsByFillerMode
        ? (fillerShadingDisabled ? rawMaterialCountsByFillerMode.disabled : rawMaterialCountsByFillerMode.enabled)
        : null,
    [rawMaterialCountsByFillerMode, fillerShadingDisabled],
  );

  const materialCounts = useMemo(() => {
    if (!rawMaterialCounts) return null;
    const remapped: Record<string, number> = {};
    for (const [name, count] of Object.entries(rawMaterialCounts)) {
      const targetBase =
        name === CALC_FILLER_SENTINEL
          ? fillerBlock
          : name === CALC_DELAYED_FILLER_SENTINEL
            ? suppress2LayerDelayedFillerBlock
            : fillerShadingDisabled && name === disabledFillerPlaceholder
              ? fillerBlock
              : name;
      let target = targetBase;
      if (target.startsWith(CALC_BASE_TOKEN_PREFIX)) {
        const idx = parseInt(target.slice(CALC_BASE_TOKEN_PREFIX.length), 10);
        if (Number.isFinite(idx) && idx > 0 && idx < BASE_COLORS.length) {
          target = preset.blocks[idx] || BASE_COLORS[idx].blocks[0] || target;
        }
      } else if (target.startsWith(CALC_CUSTOM_TOKEN_PREFIX)) {
        const idx = parseInt(target.slice(CALC_CUSTOM_TOKEN_PREFIX.length), 10);
        if (Number.isFinite(idx) && idx >= 0 && idx < customColors.length) {
          target = customColors[idx].block.trim() || target;
        }
      }
      remapped[target] = (remapped[target] || 0) + count;
    }
    return remapped;
  }, [
    rawMaterialCounts,
    fillerShadingDisabled,
    fillerBlock,
    suppress2LayerDelayedFillerBlock,
    disabledFillerPlaceholder,
    preset.blocks,
    customColors,
  ]);

  const sortedMaterials = useMemo(
    () =>
      materialCounts
        ? Object.entries(materialCounts)
            .filter(([, c]) => c > 0)
            .sort((a, b) => b[1] - a[1])
        : [],
    [materialCounts],
  );

  const fillerOnlyCount = useMemo(() => {
    if (!rawMaterialCounts) return 0;
    if (fillerShadingDisabled) return rawMaterialCounts[disabledFillerPlaceholder] || 0;
    return rawMaterialCounts[CALC_FILLER_SENTINEL] || 0;
  }, [fillerShadingDisabled, rawMaterialCounts, disabledFillerPlaceholder]);

  const colorRequiredMap = useMemo(() => {
    if (!materialCounts) return {} as Record<number, number>;
    const map: Record<number, number> = {};
    for (let i = 1; i < BASE_COLORS.length; ++i) {
      const block = preset.blocks[i];
      if (!block) continue;
      const total = materialCounts[block] || 0;
      const colorOnly = block === fillerBlock ? Math.max(0, total - fillerOnlyCount) : total;
      if (colorOnly > 0) map[i] = colorOnly;
    }
    return map;
  }, [materialCounts, preset.blocks, fillerBlock, fillerOnlyCount]);

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
    if (decoded.filler) setFillerBlock(decoded.filler);
    if (decoded.supportMode !== undefined) setSupportMode(decoded.supportMode);
    if (decoded.buildMode) setBuildMode(decoded.buildMode);
    if (decoded.customColors) setCustomColors(decoded.customColors);
    if (decoded.suppress2LayerDelayedFillerBlock) {
      setSuppress2LayerDelayedFillerBlock(decoded.suppress2LayerDelayedFillerBlock);
    }
    if (decoded.proPaletteSeed !== undefined) setProPaletteSeed(decoded.proPaletteSeed);
    // if (decoded.convertUnsupported !== undefined) setConvertUnsupported(decoded.convertUnsupported);
  }, []);

  // Auto-select mode when image changes
  useEffect(() => {
    if (!imageData) return;
    if (!hasNonFlatShades) setBuildMode("flat");
    else if (hasSuppressPattern)
      setBuildMode(prev => prev.startsWith("staircase") || prev === "flat" ? "suppress_2layer_late_pairs" : prev);
    else setBuildMode(prev => prev === "flat" ? "staircase_classic" : prev);
  }, [imageData, hasNonFlatShades, hasSuppressPattern]);

  useEffect(() => {
    if (!imageData || !hasNonFlatShades) return;
    const visible = new Set<BuildMode>([
      ...staircaseModeOptions.map(o => o.value),
      ...suppressModeOptions.map(o => o.value),
    ]);
    if (!visible.has(buildMode)) {
      if (buildMode === "suppress_2layer_late_pairs" && visible.has("suppress_2layer_late_fillers")) {
        setBuildMode("suppress_2layer_late_fillers");
      } else {
        setBuildMode(staircaseModeOptions[0]?.value ?? "staircase_classic");
      }
    }
  }, [imageData, hasNonFlatShades, buildMode, staircaseModeOptions, suppressModeOptions]);

  useEffect(() => {
    if (!imageData) return;
    if (fillerDisabled) { setSupportMode("none"); return; }
    if (supportMode === "fragile" && fillerIsFragile) { setSupportMode("none"); return; }
    if (supportMode === "steps" && !hasNonFlatShades) setSupportMode("none");
    if (supportMode === "water" && (!imageHasWater || !fillerIsNoneColor)) setSupportMode("none");
  }, [imageData, hasNonFlatShades, imageHasWater, fillerIsNoneColor, supportMode, fillerDisabled, fillerIsFragile]);

  useEffect(() => {
    if ((supportMode === "fragile" || supportMode === "all") && layerGap < 3) setLayerGap(3);
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
    const base = showTransparentRow ? [0, ...DEFAULT_SORTED] : [...DEFAULT_SORTED];
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
      fillerBlock,
      supportMode,
      buildMode,
      customColors,
      convertUnsupported,
      suppress2LayerDelayedFillerBlock,
      proPaletteSeed,
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

  const handleFile = useCallback(
    (file: File) => {
      setPaletteErrors([]);
      const img = new Image();
      img.onload = () => {
        const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);
        const result = validatePng(data, customColors);
        if (!result.valid) {
          // Check if the only errors are palette errors and conversion is enabled
          const sizeError = result.errors.find(e => e.includes("128×128"));
          if (sizeError || !convertUnsupported) {
            setImageData(null);
            setImageName("");
            setImageValid(false);
            setPaletteErrors(result.errors);
            if (fileRef.current) fileRef.current.value = "";
            return;
          }
          // Convert unsupported colors to nearest available palette color
          const lookup = getColorLookup();
          const customLookup = buildCustomShadeLookup(customColors);

          // Build set of available shaded RGB values (only base colors that have a block mapping in preset)
          const availableColors: { r: number; g: number; b: number; key: string }[] = [];
          for (const [key, match] of lookup.entries()) {
            // Include all palette colors (they might assign blocks later)
            const [r, g, b] = key.split(",").map(Number);
            availableColors.push({ r, g, b, key });
          }

          const d = data.data;
          const allInputColors = new Set<string>();
          const convertedColors = new Set<string>();
          const targetColors = new Set<string>();
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue;
            const key = `${d[i]},${d[i + 1]},${d[i + 2]}`;
            allInputColors.add(key);
            if (lookup.has(key) || customLookup.has(key)) continue;
            // Find nearest color
            let bestDist = Infinity, bestR = 0, bestG = 0, bestB = 0;
            for (const ac of availableColors) {
              const dr = d[i] - ac.r,
                dg = d[i + 1] - ac.g,
                db = d[i + 2] - ac.b;
              const dist = dr * dr + dg * dg + db * db;
              if (dist < bestDist) {
                bestDist = dist;
                bestR = ac.r;
                bestG = ac.g;
                bestB = ac.b;
              }
            }
            convertedColors.add(key);
            targetColors.add(`${bestR},${bestG},${bestB}`);
            d[i] = bestR;
            d[i + 1] = bestG;
            d[i + 2] = bestB;
          }
          // Re-validate after conversion (should pass now)
          const recheck = validatePng(data, customColors);
          setImageData(data);
          setImageName(file.name);
          setImageValid(recheck.valid);
          const cc = convertedColors.size;
          const totalUnique = allInputColors.size;
          // Output unique colors = original colors minus converted ones, plus target palette colors
          const outputColors = new Set<string>();
          for (const c of allInputColors) {
            if (!convertedColors.has(c)) outputColors.add(c);
          }
          for (const c of targetColors) outputColors.add(c);
          const fewer = totalUnique - outputColors.size;
          const convLine1 =
            cc === totalUnique
              ? `Converted ${cc} color${cc === 1 ? "" : "s"} to nearest palette match.`
              : `Converted ${cc} (of ${totalUnique}) color${totalUnique === 1 ? "" : "s"} to nearest palette match.`;
          const convLines = [convLine1];
          if (fewer > 0) {
            convLines.push(`${fewer} fewer unique color${fewer === 1 ? "" : "s"} than source image.`);
          }
          setPaletteErrors(recheck.valid ? convLines : recheck.errors);
          setShowUnusedColors(false);
          if (sortKey === "default") {
            setSortKey("required");
            setSortDir("desc");
          }
          return;
        }
        setImageData(data);
        setImageName(file.name);
        setImageValid(true);
        setPaletteErrors([]);
        setShowUnusedColors(false);
        if (sortKey === "default") {
          setSortKey("required");
          setSortDir("desc");
        }
      };
      img.src = URL.createObjectURL(file);
    },
    [customColors, convertUnsupported, preset.blocks],
  );

  const handleConvertAndDownload = async () => {
    if (!imageData) return;
    setConverting(true);
    try {
      const baseName = imageName.replace(/\.[^/.]+$/, "");
      const result = await convertToNbt(imageData, {
        blockMapping: preset.blocks,
        fillerBlock,
        suppress2LayerDelayedFillerBlock,
        proPaletteSeed,
        forceZ129,
        customColors,
        buildMode,
        supportMode,
        baseName,
        layerGap,
      });
      const suffixMap: Record<string, string> = {
        flat: "",
        staircase_northline: "-staircase_northline",
        staircase_southline: "-staircase_southline",
        staircase_classic: "-staircase_classic",
        staircase_grouped: "-staircase_grouped",
        staircase_valley: "-staircase_valley",
        staircase_pro: "-staircase_pro",
        suppress_rowsplit: "-suppress_rowsplit",
        suppress_checker: "-suppress_checker",
        suppress_checker_ew: "-suppress_checker_EW",
        suppress_pairs_ew: "-suppress_pairs_EW",
        suppress_2layer_late_fillers: "-suppress_2layer",
        suppress_2layer_late_pairs: "-suppress_2layer_late_pairs",
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
      fillerInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      fillerInputRef.current?.focus();
    }
  };

  const fillerNeedStats = useMemo(() => {
    if (!imageData || !imageValid) return null;
    if (effectiveBuildMode === "suppress_2layer_late_fillers") return lateFillersNeedStats;
    try {
      return analyzeFillerNeeds(imageData, {
        blockMapping: structuralBlockMapping,
        fillerBlock: CALC_FILLER_SENTINEL,
        suppress2LayerDelayedFillerBlock: CALC_DELAYED_FILLER_SENTINEL,
        // Filler-need analysis is topology/shade driven and does not depend on Pro Version RNG seed.
        proPaletteSeed: false,
        customColors: structuralCustomColors,
        buildMode: effectiveBuildMode,
        supportMode: "none",
        baseName: "",
        layerGap: calcLayerGapForBuild,
      });
    } catch {
      return null;
    }
  }, [
    imageData,
    imageValid,
    structuralBlockMapping,
    structuralCustomColors,
    effectiveBuildMode,
    lateFillersNeedStats,
    calcLayerGapForBuild,
  ]);

  const canGenerate = imageValid && missingBlocks.length === 0;
  const hasRequiredCol = materialCounts !== null;
  const hasInGridFillerNeed = (fillerNeedStats?.inGrid ?? 0) > 0;
  const inGridFillerCountsAsWarning = hasInGridFillerNeed && (effectiveBuildMode.startsWith("suppress") || imageHasTransparency);
  const hasComplexNorthNeed = (fillerNeedStats?.north ?? 0) > 0 && !(fillerNeedStats?.northIsSingleLine ?? true);
  const showNoFillerWarning =
    imageValid && hasNonFlatShades && fillerShadingDisabled && (inGridFillerCountsAsWarning || hasComplexNorthNeed);
  const showLateFillerInput =
    imageData &&
    buildMode === "suppress_2layer_late_fillers" &&
    !fillerShadingDisabled &&
    (fillerNeedStats?.delayedTotal ?? 0) > 0;
  const showNorthRowAlignmentInfo =
    canGenerate &&
    (forceZ129 || (!fillerShadingDisabled && (fillerNeedStats?.north ?? 0) > 0));
  const noFillerWarningDetails = useMemo(() => {
    if (!showNoFillerWarning || !fillerNeedStats) return "";
    const parts: string[] = [];
    if (inGridFillerCountsAsWarning) {
      const suppressLike = effectiveBuildMode.startsWith("suppress") || (fillerNeedStats.delayedInGrid ?? 0) > 0;
      if (suppressLike) {
        parts.push("Some shading-critical suppress fillers are required inside the 128x128 grid.");
      } else {
        parts.push("Some shading-critical fillers are required inside the 128x128 grid.");
      }
    }
    if (hasComplexNorthNeed) {
      parts.push("North-row shading requires filler placements.");
    }
    return parts.join(" ");
  }, [
    showNoFillerWarning,
    fillerNeedStats,
    inGridFillerCountsAsWarning,
    hasComplexNorthNeed,
    effectiveBuildMode,
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
      const excluded = showExcludedBlocks ? EXCLUDED_COLORS[idx] ?? [] : [];
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
    const excluded = showExcludedBlocks ? EXCLUDED_COLORS[idx] ?? [] : [];
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
      const [r, g, b] = getShadedRgb(idx, shade);
      return { backgroundColor: `rgb(${r},${g},${b})` };
    }

    const stops: string[] = [];
    for (let i = 0; i < shades.length; ++i) {
      const shade = shades[i];
      const [r, g, b] = getShadedRgb(idx, shade);
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
    const [r, g, b] = getShadedRgb(idx, shade);
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
              const [r, g, b] = getShadedRgb(idx, shade);
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
            className="bg-input border border-border rounded px-1 h-6 text-[11px] font-mono text-foreground min-w-0 w-full"
            value={preset.blocks[idx] || ""}
            onChange={e => updateBlock(idx, e.target.value)}
          >
            <option value="">(none)</option>
            {nameBlocks.map(b => (
              <option key={b} value={b}>
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
                const hasIcon = KNOWN_PRECOMPUTED_ICON_BLOCKS.has(b);
                return (
                  <button
                    key={b}
                    type="button"
                    className={`shrink-0 w-5 h-5 rounded border overflow-hidden ${
                      textureCollapsed
                        ? "border-border"
                        : selected
                        ? "border-transparent shadow-[0_0_0_2px_hsl(var(--primary))]"
                        : "border-border hover:shadow-[0_0_0_1px_hsl(var(--primary))]"
                    }`}
                    title={b}
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
            MapArt PNG → NBT
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
              {imageData && hasNonFlatShades && (
                <div className="ml-auto flex items-center gap-1">
                  {(buildMode === "suppress_2layer_late_fillers" || buildMode === "suppress_2layer_late_pairs") && (
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
                  {buildMode === "staircase_pro" && (
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
                      buildMode === "suppress_rowsplit" ? "text-muted-foreground" : "text-foreground"
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
                          style={opt.muted ? { color: "var(--muted-foreground)" } : undefined}
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
          <section
            ref={fillerToolbarSectionRef}
            className={`bg-card border border-border rounded-md p-1.5 flex items-center gap-1.5 ${
              isStackedLayout ? "flex-wrap" : "flex-nowrap"
            }`}
          >
            <span className="text-xs font-semibold text-accent whitespace-nowrap">Filler:</span>
            <input
              ref={fillerInputRef}
              type="text"
              value={fillerBlock}
              onChange={e => setFillerBlock(e.target.value)}
              placeholder="resin_block"
              className="max-w-[180px] h-6 text-xs font-mono px-1.5 bg-input border border-border rounded"
            />
            {showLateFillerInput && (
              <>
                <span className="text-xs font-semibold text-accent whitespace-nowrap">Late-Filler:</span>
                <input
                  type="text"
                  value={suppress2LayerDelayedFillerBlock}
                  onChange={e => setSuppress2LayerDelayedFillerBlock(e.target.value)}
                  placeholder="slime_block"
                  className="max-w-[180px] h-6 text-xs font-mono px-1.5 bg-input border border-border rounded"
                />
              </>
            )}
            {imageData && !fillerDisabled && (
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold text-accent whitespace-nowrap">
                  Support:
                </span>
                <select
                  className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs cursor-help"
                  value={supportMode}
                  onChange={e => setSupportMode(e.target.value as SupportMode)}
                  title={supportModeTooltip}
                >
                  <option value="none" title={getSupportModeTooltip("none")}>None</option>
                  <option value="steps" disabled={!hasNonFlatShades} title={getSupportModeTooltip("steps")}>
                    Steps
                  </option>
                  <option value="all" title={getSupportModeTooltip("all")}>All</option>
                  {!fillerIsFragile && (
                    <option value="fragile" title={getSupportModeTooltip("fragile")}>Fragile</option>
                  )}
                  <option value="water" disabled={!imageHasWater || !fillerIsNoneColor} title={getSupportModeTooltip("water")}>
                    Water
                  </option>
                </select>
              </div>
            )}
            {materialCounts && fillerOnlyCount > 0 && !fillerDisabled && (
              <span className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1 border-2 border-primary/60 bg-primary/10 rounded px-1.5 h-6">
                <span className="font-semibold">Required:</span>
                <span className="text-foreground">
                  {materialCounts[fillerBlock] !== undefined && materialCounts[fillerBlock] > fillerOnlyCount
                    ? fillerOnlyCount
                    : showStacks
                      ? formatStacks(fillerOnlyCount)
                      : fillerOnlyCount}
                </span>
                {materialCounts[fillerBlock] !== undefined && materialCounts[fillerBlock] > fillerOnlyCount && (
                  <>
                    <span>(Total:</span>
                    <span className="text-foreground">
                      {showStacks ? formatStacks(materialCounts[fillerBlock]) : materialCounts[fillerBlock]}
                    </span>
                    <span>)</span>
                  </>
                )}
              </span>
            )}
          </section>
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
                  View: {blockDisplayMode}
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
              <div className="relative overflow-hidden">{usedIndices.map(renderColorRow)}</div>

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
            <h2 className="text-sm font-semibold text-accent mb-2">Upload MapArt PNG</h2>
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
              accept=".png"
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
                  <p className="text-xs text-muted-foreground text-center px-2">Click or drop a 128×128 .png</p>
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

            {showNoFillerWarning && (
              <div className="mt-2 bg-warning/20 border-2 border-warning/40 rounded p-2">
                <p className="text-xs text-warning font-medium">
                  Filler is disabled ({fillerBlock.trim() || "none"}). {noFillerWarningDetails} This shading will need to
                  be handled manually in-game.
                </p>
              </div>
            )}

            {showNorthRowAlignmentInfo && (
              <div className="mt-2 bg-muted/30 border border-border rounded p-2">
                <p className="text-xs text-muted-foreground font-medium">
                  Note: Align the `128x128` color area to the map grid, with the extra row one block north.
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
                      : buildMode === "suppress_rowsplit" || buildMode === "suppress_checker"
                        ? "Generate .zip"
                        : "Generate .nbt"}
                  </button>
                )}
              </div>
            )}

            {imageInfo && imageValid && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap items-center">
                  {imageInfo.uniqueShadeCount > sortedMaterials.length && (
                    <span>
                      <strong className="text-foreground">{plural(imageInfo.uniqueShadeCount, "unique color")}</strong>
                    </span>
                  )}
                  <span>
                    <strong className="text-foreground">{plural(sortedMaterials.length, "block type")}</strong>
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
                          // Lock which thumb we're dragging based on initial proximity
                          const grabStart = Math.abs(val - colStartRef.current) <= Math.abs(val - colEndRef.current);
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
