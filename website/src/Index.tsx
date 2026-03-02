import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Moon, Sun, Plus, Minus } from "lucide-react";
import { BASE_COLORS, getColorLookup, getShadedRgb } from "@/data/mapColors";
import { isFragileBlock } from "@/data/fragileBlocks";
import {
  validatePng,
  convertToNbt,
  computeMaterialCounts,
  type CustomColor,
  type BuildMode,
  type SupportMode,
} from "@/lib/converter";

// ── Preset types ──
interface Preset {
  name: string;
  blocks: Record<number, string>;
}

const BUILTIN_PRESET_NAMES = ["PistonClear", "Carpets", "Fullblock"] as const;

function buildPistonClearPreset(): Preset {
  const blocks: Record<number, string> = {};
  for (let i = 1; i < BASE_COLORS.length; i++) {
    const c = BASE_COLORS[i];
    // Use fragile blocks only; prefer carpet for COLOR_ names, then pressure_plate, then any fragile
    const carpet = c.blocks.find(b => b.endsWith("_carpet"));
    const plate = c.blocks.find(b => b.endsWith("_pressure_plate"));
    const anyFragile = c.blocks.find(b => isFragileBlock(b));
    if (c.name.startsWith("COLOR_") && carpet) {
      blocks[i] = carpet;
    } else if (plate) {
      blocks[i] = plate;
    } else if (anyFragile) {
      blocks[i] = anyFragile;
    } else {
      blocks[i] = ""; // no fragile option → (none)
    }
  }
  // Apply specific overrides from old Default that used fragile blocks
  const overrides: Record<string, string> = {
    SNOW: "white_carpet",
    WOOL: "white_candle",
    WOOD: "oak_pressure_plate",
    NETHER: "crimson_roots",
    PLANT: "pink_petals",
  };
  for (let i = 1; i < BASE_COLORS.length; i++) {
    const name = BASE_COLORS[i].name;
    if (overrides[name]) blocks[i] = overrides[name];
  }
  return { name: "PistonClear", blocks };
}

function buildCarpetsPreset(): Preset {
  const blocks: Record<number, string> = {};
  for (let i = 1; i < BASE_COLORS.length; i++) {
    const carpet = BASE_COLORS[i].blocks.find(b => b.endsWith("_carpet"));
    blocks[i] = carpet ?? "";
  }
  return { name: "Carpets", blocks };
}

function buildFullblockPreset(): Preset {
  const specific: Record<number, string> = {
    1: "grass_block",
    2: "sandstone",
    3: "mushroom_stem",
    4: "tnt",
    5: "ice",
    6: "iron_block",
    7: "oak_leaves",
    8: "white_concrete",
    10: "granite",
    11: "andesite",
    12: "oak_leaves[waterlogged=true]",
    13: "oak_planks",
    14: "diorite",
    15: "orange_concrete",
    16: "magenta_concrete",
    17: "light_blue_concrete",
    18: "yellow_concrete",
    19: "lime_concrete",
    20: "pink_concrete",
    21: "gray_concrete",
    22: "light_gray_concrete",
    23: "cyan_concrete",
    24: "purple_concrete",
    25: "blue_concrete",
    26: "brown_concrete",
    27: "green_concrete",
    28: "red_concrete",
    29: "black_concrete",
    30: "gold_block",
    31: "prismarine_bricks",
    34: "spruce_planks",
    35: "netherrack",
    36: "white_terracotta",
    37: "orange_terracotta",
    43: "gray_terracotta",
    44: "light_gray_terracotta",
    53: "crimson_planks",
    56: "warped_planks",
    61: "verdant_froglight",
  };
  const blocks: Record<number, string> = {};
  for (let i = 1; i < BASE_COLORS.length; i++) {
    blocks[i] = specific[i] ?? BASE_COLORS[i].blocks[0] ?? "";
  }
  return { name: "Fullblock", blocks };
}

const BUILTIN_BUILDERS: Record<string, () => Preset> = {
  PistonClear: buildPistonClearPreset,
  Carpets: buildCarpetsPreset,
  Fullblock: buildFullblockPreset,
};

const getBuiltinPreset = (name: string): Preset | null => BUILTIN_BUILDERS[name]?.() ?? null;

function loadPresets(): Preset[] {
  const builtins = (BUILTIN_PRESET_NAMES as readonly string[]).map(n => BUILTIN_BUILDERS[n]());
  try {
    const raw = localStorage.getItem("mapart_presets");
    if (raw) {
      const parsed: Preset[] = JSON.parse(raw);
      return [
        ...builtins,
        ...parsed.filter(p => !BUILTIN_PRESET_NAMES.includes(p.name as (typeof BUILTIN_PRESET_NAMES)[number])),
      ];
    }
  } catch {
    /* ignore */
  }
  return builtins;
}

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

type ColumnId = "clr" | "id" | "name" | "block" | "options" | "required";
const ALL_COLUMNS: ColumnId[] = ["clr", "id", "name", "block", "options", "required"];

// ── Shared pixel helpers ──
const makeCustomKeySet = (cc: CustomColor[]) => new Set(cc.map(c => `${c.r},${c.g},${c.b}`));

function imageHasNonFlatShades(imageData: ImageData, customColors: CustomColor[]): boolean {
  const lookup = getColorLookup();
  const customSet = makeCustomKeySet(customColors);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = `${d[i]},${d[i + 1]},${d[i + 2]}`;
    if (customSet.has(key)) continue;
    const match = lookup.get(key);
    if (match?.shade !== undefined && match.shade !== 1) return true;
  }
  return false;
}

/** Scan suppress columns; if countMode=true returns count, else returns 0/1 for detect */
function scanSuppressedPixels(imageData: ImageData, customColors: CustomColor[], countMode: boolean): number {
  const lookup = getColorLookup();
  const customSet = makeCustomKeySet(customColors);
  let count = 0;
  for (let x = 0; x < 128; x++) {
    for (let z = 0; z < 128; z++) {
      const idx = (z * 128 + x) * 4;
      if (imageData.data[idx + 3] !== 0) continue;
      for (let sz = z + 1; sz < 128; sz++) {
        const sIdx = (sz * 128 + x) * 4;
        if (imageData.data[sIdx + 3] === 0) continue;
        const sKey = `${imageData.data[sIdx]},${imageData.data[sIdx + 1]},${imageData.data[sIdx + 2]}`;
        if (customSet.has(sKey)) break;
        const match = lookup.get(sKey);
        if (!match || match.shade === 2) break;
        if (match.shade === 0 || match.shade === 3) {
          if (!countMode) return 1;
          count++;
        }
        break;
      }
    }
  }
  return count;
}

function computeImageInfo(imageData: ImageData, customColors: CustomColor[]) {
  const lookup = getColorLookup();
  const customLookup = makeCustomKeySet(customColors);
  const usedBaseColors = new Set<number>();
  const usedShades = new Set<string>();
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = `${d[i]},${d[i + 1]},${d[i + 2]}`;
    if (customLookup.has(key)) {
      usedShades.add(`custom:${key}`);
      continue;
    }
    const match = lookup.get(key);
    if (match) {
      usedBaseColors.add(match.baseIndex);
      usedShades.add(`${match.baseIndex}:${match.shade}`);
    }
  }
  return { uniqueShadeCount: usedShades.size, uniqueBaseColorCount: usedBaseColors.size };
}

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
): string {
  const parts = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => {
    const block = preset.blocks[i + 1] || "";
    const idx = BASE_COLORS[i + 1].blocks.indexOf(block);
    return idx >= 0 ? String(idx) : block ? `=${block}` : "-";
  });
  const ccStr = customColors.length > 0 ? customColors.map(cc => `${cc.r},${cc.g},${cc.b}:${cc.block}`).join(";") : "";
  const s = [preset.name, parts.join(","), fillerBlock, supportMode, buildMode, ccStr, convertUnsupported ? "1" : "0"].join("|");
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodePreset(encoded: string): {
  preset: Preset; filler?: string; supportMode?: SupportMode;
  buildMode?: BuildMode; customColors?: CustomColor[]; convertUnsupported?: boolean;
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

    return {
      preset: { name: sections[0], blocks }, filler: sections[2] || undefined,
      supportMode, buildMode: (sections[4] || undefined) as BuildMode | undefined,
      customColors, convertUnsupported,
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
  activePreset: "mapart_activePreset",
  sortKey: "mapart_sortKey",
  sortDir: "mapart_sortDir",
  layerGap: "mapart_layerGap",
  columnOrder: "mapart_columnOrder",
} as const;

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
  const [buildMode, setBuildMode] = useState<BuildMode>(() =>
    loadCached(LS_KEYS.buildMode, "staircase_classic" as BuildMode),
  );
  const [layerGap, setLayerGap] = useState(() => loadCached(LS_KEYS.layerGap, 5));
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
  const [showNames, setShowNames] = useState(false);
  const [showIds, setShowIds] = useState(false);
  const [showOptions, setShowOptions] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>(() => loadCached(LS_KEYS.sortKey, "default" as SortKey));
  const [sortDir, setSortDir] = useState<SortDir>(() => loadCached(LS_KEYS.sortDir, "asc" as SortDir));
  const [showUnusedColors, setShowUnusedColors] = useState(false);
  const [showStacks, setShowStacks] = useState(() => loadCached(LS_KEYS.showStacks, false));
  const [isDark, setIsDark] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mapart_theme") || '"light"') === "dark"; } catch { return false; }
  });
  const [convertUnsupported, /* setConvertUnsupported */] = useState(true); // always on; checkbox commented out
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => loadCached(LS_KEYS.columnOrder, ALL_COLUMNS));
  const dragColRef = useRef<ColumnId | null>(null);
  const [highlightedColorIdx, setHighlightedColorIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const fillerInputRef = useRef<HTMLInputElement>(null);

  // Dynamic favicon: outlined version when an image is loaded
  useEffect(() => {
    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (link) link.href = imageData ? "/favicon-active.png" : "/favicon.png";
  }, [imageData]);

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
    localStorage.setItem("mapart_presets", JSON.stringify(presets));
  }, [presets]);
  useEffect(() => {
    const entries: [string, unknown][] = [
      [LS_KEYS.filler, fillerBlock],
      [LS_KEYS.buildMode, buildMode],
      [LS_KEYS.supportMode, supportMode],
      [LS_KEYS.showStacks, showStacks],
      [LS_KEYS.activePreset, preset.name],
      [LS_KEYS.sortKey, sortKey],
      [LS_KEYS.sortDir, sortDir],
      [LS_KEYS.layerGap, layerGap],
      [LS_KEYS.columnOrder, columnOrder],
    ];
    entries.forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  }, [fillerBlock, buildMode, supportMode, showStacks, preset.name, sortKey, sortDir, layerGap, columnOrder]);

  const hasNonFlatShades = useMemo(
    () => imageData ? imageHasNonFlatShades(imageData, customColors) : false,
    [imageData, customColors],
  );
  const hasSuppressPattern = useMemo(
    () => imageData && hasNonFlatShades ? scanSuppressedPixels(imageData, customColors, false) > 0 : false,
    [imageData, customColors, hasNonFlatShades],
  );
  const suppressedCount = useMemo(
    () => imageData ? scanSuppressedPixels(imageData, customColors, true) : 0,
    [imageData, customColors],
  );

  const usedBaseColors = useMemo(() => {
    if (!imageData || !imageValid) return new Set<number>();
    const lookup = getColorLookup();
    const used = new Set<number>();
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const match = lookup.get(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      if (match) used.add(match.baseIndex);
    }
    return used;
  }, [imageData, imageValid]);

  const imageHasWater = useMemo(() => usedBaseColors.has(12), [usedBaseColors]);

  const fillerIsNoneColor = useMemo(() => {
    const stripped = fillerBlock.split("[")[0];
    return !BASE_COLORS.slice(1).some(bc => bc.blocks.some(b => b.split("[")[0] === stripped));
  }, [fillerBlock]);

  const missingBlocks = useMemo(() => {
    if (!imageValid || usedBaseColors.size === 0) return [];
    return [...usedBaseColors].filter(idx => idx > 0 && !preset.blocks[idx]);
  }, [imageValid, usedBaseColors, preset.blocks]);

  const imageInfo = useMemo(
    () => imageData && imageValid ? computeImageInfo(imageData, customColors) : null,
    [imageData, imageValid, customColors],
  );

  const effectiveBuildMode = hasNonFlatShades ? buildMode : "flat";

  const materialCounts = useMemo(() => {
    if (!imageData || !imageValid) return null;
    const isPairs = effectiveBuildMode === "suppress_pairs_ew";
    try {
      return computeMaterialCounts(imageData, {
        blockMapping: preset.blocks,
        fillerBlock,
        customColors,
        buildMode: effectiveBuildMode,
        supportMode,
        baseName: "",
        layerGap,
        ...(colRangeEnabled ? (isPairs ? { stepRange: [colStart, colEnd] } : { columnRange: [colStart, colEnd] }) : {}),
      });
    } catch {
      return null;
    }
  }, [
    imageData,
    imageValid,
    preset.blocks,
    fillerBlock,
    customColors,
    effectiveBuildMode,
    supportMode,
    layerGap,
    colRangeEnabled,
    colStart,
    colEnd,
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
    if (!imageData || !imageValid || !materialCounts) return 0;
    try {
      const sentinel = "\x00sentinel";
      const alt = computeMaterialCounts(imageData, {
        blockMapping: preset.blocks,
        fillerBlock: sentinel,
        customColors,
        buildMode: effectiveBuildMode,
        supportMode,
        baseName: "",
        layerGap,
      });
      return alt[sentinel] || 0;
    } catch {
      return 0;
    }
  }, [imageData, imageValid, materialCounts, preset.blocks, customColors, effectiveBuildMode, supportMode, layerGap]);

  const colorRequiredMap = useMemo(() => {
    if (!materialCounts) return {} as Record<number, number>;
    const map: Record<number, number> = {};
    for (let i = 1; i < BASE_COLORS.length; i++) {
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
    for (let i = 1; i < BASE_COLORS.length; i++) {
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
    // if (decoded.convertUnsupported !== undefined) setConvertUnsupported(decoded.convertUnsupported);
  }, []);

  // Auto-select mode when image changes
  useEffect(() => {
    if (!imageData) return;
    if (!hasNonFlatShades) setBuildMode("flat");
    else if (hasSuppressPattern)
      setBuildMode(prev => prev.startsWith("staircase") || prev === "flat" ? "suppress_pairs_ew" : prev);
    else setBuildMode(prev => prev === "flat" ? "staircase_classic" : prev);
  }, [imageData, hasNonFlatShades, hasSuppressPattern]);

  const fillerDisabled = /^(air|none)$/i.test(fillerBlock.trim());

  useEffect(() => {
    if (!imageData) return;
    if (fillerDisabled) { setSupportMode("none"); return; }
    if (supportMode === "steps" && !hasNonFlatShades) setSupportMode("none");
    if (supportMode === "water" && (!imageHasWater || !fillerIsNoneColor)) setSupportMode("none");
  }, [imageData, hasNonFlatShades, imageHasWater, fillerIsNoneColor, supportMode, fillerDisabled]);

  const customBlocksByBase = useMemo(() => {
    const map: Record<number, string[]> = {};
    for (const cc of customColors) {
      for (let i = 0; i < BASE_COLORS.length; i++) {
        const bc = BASE_COLORS[i];
        if (bc.r === cc.r && bc.g === cc.g && bc.b === cc.b) {
          (map[i] ??= []).includes(cc.block) || map[i].push(cc.block);
        }
      }
    }
    return map;
  }, [customColors]);

  const noneHasCustomBlock = useMemo(
    () => !!customBlocksByBase[0]?.length || !!preset.blocks[0],
    [customBlocksByBase, preset.blocks],
  );

  const sortedIndices = useMemo(() => {
    const base = noneHasCustomBlock ? [0, ...DEFAULT_SORTED] : [...DEFAULT_SORTED];
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
  }, [sortKey, sortDir, materialCounts, colorRequiredMap, noneHasCustomBlock]);

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
    const url = `${location.origin}${location.pathname}?preset=${encodePreset(preset, fillerBlock, supportMode, buildMode, customColors, convertUnsupported)}`;
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
          const customLookup = new Map<string, boolean>();
          for (const cc of customColors) customLookup.set(`${cc.r},${cc.g},${cc.b}`, true);

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
        staircase_valley: "-staircase_valley",
        staircase_cancer: "-staircase_cancer",
        suppress_rowsplit: "-suppress_rowsplit",
        suppress_plaid_ns: "-suppress_plaid_NS",
        suppress_plaid_ew: "-suppress_plaid_EW",
        suppress_pairs_ew: "-suppress_pairs_EW",
        suppress_2layer_ew: "-suppress_2layer_EW",
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

  const canGenerate = imageValid && missingBlocks.length === 0;
  const hasRequiredCol = materialCounts !== null;

  const requiredColWidth = useMemo(() => {
    if (!materialCounts) return 0;
    const maxLen = Math.max(
      0,
      ...Object.values(colorRequiredMap)
        .filter(c => c > 0)
        .map(c => (showStacks ? formatStacks(c) : String(c)).length),
    );
    return Math.max(70, maxLen * 6 + 12);
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

  const colWidthMap: Record<ColumnId, string> = {
    clr: "24px", id: "24px", name: "135px",
    block: "minmax(0,1fr)", options: "46px",
    required: `${requiredColWidth}px`,
  };

  const gridColsStyle = useMemo(
    () => ({
      gridTemplateColumns: visibleColumns.map(c => colWidthMap[c]).join(" "),
    }),
    [visibleColumns, requiredColWidth],
  );

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
    const extra = customBlocksByBase[idx] || [];
    return [...BASE_COLORS[idx].blocks, ...extra.filter(eb => !BASE_COLORS[idx].blocks.includes(eb))].sort();
  };

  const pad2 = (n: number) => String(n).padStart(2, "\u2007");

  const renderColorRow = (idx: number) => {
    const color = BASE_COLORS[idx];
    const [r, g, b] = getShadedRgb(idx, 2);
    const isMissing = missingBlocks.includes(idx);
    const isHighlighted = highlightedColorIdx === idx;
    const allBlocks = getAllBlocks(idx);
    const reqCount = colorRequiredMap[idx] || 0;
    const cells: Record<ColumnId, React.ReactNode> = {
      clr: (
        <div
          key="clr"
          className="w-5 h-5 rounded border border-border cursor-pointer hover:ring-1 hover:ring-primary/50 transition-shadow"
          style={{ backgroundColor: `rgb(${r},${g},${b})` }}
          title="Click to copy hex"
          onClick={() => copyColorToClipboard(r, g, b)}
        />
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
        <select
          key="block"
          className="bg-input border border-border rounded px-1 h-6 text-[11px] font-mono text-foreground min-w-0 w-full"
          value={preset.blocks[idx] || ""}
          onChange={e => updateBlock(idx, e.target.value)}
        >
          <option value="">(none)</option>
          {allBlocks.map(b => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      ),
      options: (
        <span key="options" className="text-[10px] text-muted-foreground whitespace-nowrap text-center tabular-nums">
          {pad2(allBlocks.length)}
        </span>
      ),
      required: (
        <span key="required" className="text-[10px] font-mono text-right pr-1">
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
      <header className="border-b border-border px-4 py-2 flex items-center justify-between">
        <h1 className="text-lg font-bold text-primary">MapArt PNG → NBT</h1>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md bg-secondary text-secondary-foreground hover:bg-muted transition-colors"
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      <div className="flex flex-col lg:flex-row lg:items-stretch gap-3 p-3 max-w-[2000px] mx-auto">
        {/* LEFT COLUMN */}
        <div className="lg:flex-[3] min-w-0 space-y-2">
          {/* Preset Manager */}
          <section className="bg-card border border-border rounded-md p-2">
            <div className="flex flex-wrap gap-1.5 items-center">
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
                  <span className="text-xs font-semibold text-accent whitespace-nowrap">Shading Method:</span>
                  <select
                    className="bg-input border border-border rounded px-2 h-6 text-foreground text-xs"
                    value={buildMode}
                    onChange={e => setBuildMode(e.target.value as BuildMode)}
                  >
                    <optgroup label="Staircase">
                      <option value="staircase_valley">Staircase (Valley)</option>
                      <option value="staircase_classic">Staircase (Classic)</option>
                      <option value="staircase_northline">Staircase (Northline)</option>
                      <option value="staircase_southline">Staircase (Southline)</option>
                      <option value="staircase_cancer">Staircase (Cancer)</option>
                    </optgroup>
                    <optgroup label="Suppress">
                      <option value="suppress_rowsplit">Suppress (Row-split, E→W)</option>
                      <option value="suppress_plaid_ns" disabled>
                        Suppress (Plaid, N→S)
                      </option>
                      <option value="suppress_plaid_ew" disabled>
                        Suppress (Plaid, E→W)
                      </option>
                      <option value="suppress_pairs_ew">Suppress (Pairs, E→W)</option>
                      <option value="suppress_2layer_ew">Suppress (2-Layer, E→W)</option>
                    </optgroup>
                  </select>
                </div>
              )}
              {imageData && hasNonFlatShades && buildMode === "suppress_2layer_ew" && (
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-accent whitespace-nowrap">Layer gap:</span>
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={layerGap}
                    onChange={e => setLayerGap(Math.max(2, Math.min(20, parseInt(e.target.value) || 5)))}
                    className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs w-12 text-center"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Filler Block + Support + Shading Method */}
          <section className="bg-card border border-border rounded-md p-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-accent whitespace-nowrap">Filler:</span>
            <input
              ref={fillerInputRef}
              type="text"
              value={fillerBlock}
              onChange={e => setFillerBlock(e.target.value)}
              placeholder="resin_block"
              className="max-w-[180px] h-6 text-xs font-mono px-1.5 bg-input border border-border rounded"
            />
            {imageData && !fillerDisabled && (
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold text-accent whitespace-nowrap">Support:</span>
                <select
                  className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs"
                  value={supportMode}
                  onChange={e => setSupportMode(e.target.value as SupportMode)}
                >
                  <option value="none">None</option>
                  <option value="steps" disabled={!hasNonFlatShades}>
                    Steps
                  </option>
                  <option value="all">All</option>
                  <option value="fragile">Fragile</option>
                  <option value="water" disabled={!imageHasWater || !fillerIsNoneColor}>
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

          {/* Color → Block */}
          <section className="bg-card border border-border rounded-md p-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-accent">Color → Block</h2>
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowIds(v => !v)}
                >
                  {showIds ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
                  IDs
                </button>
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowNames(v => !v)}
                >
                  {showNames ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
                  Names
                </button>
                <button
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowOptions(v => !v)}
                >
                  {showOptions ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
                  #Options
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
                        {...colDragProps("name")}
                      >
                        Name{sortArrow("name")}
                      </span>
                    ),
                    block: (
                      <span key="block" {...colDragProps("block")}>
                        Block
                      </span>
                    ),
                    options: (
                      <span
                        key="options"
                        className="cursor-pointer select-none whitespace-nowrap pr-1"
                        onClick={() => toggleSort("options")}
                        {...colDragProps("options")}
                      >
                        Options{sortArrow("options")}
                      </span>
                    ),
                    required: (
                      <span
                        key="required"
                        className="cursor-pointer select-none whitespace-nowrap text-right pr-1"
                        onClick={() => toggleSort("required")}
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
            <h2 className="text-sm font-semibold text-accent mb-1">Custom Color Mappings</h2>
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

        {/* RIGHT COLUMN */}
        <div className="lg:min-w-[360px] lg:max-w-[720px] lg:flex-1 flex flex-col">
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
            <div
              className="border-2 border-dashed border-border rounded-md w-full aspect-square flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors overflow-hidden"
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

            {canGenerate && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  className="text-xs px-2 py-1.5 rounded border border-destructive text-destructive hover:bg-destructive/20 whitespace-nowrap"
                  onClick={clearImage}
                >
                  Remove
                </button>
                <button
                  onClick={handleConvertAndDownload}
                  disabled={converting}
                  className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {converting ? "Converting..." : buildMode === "suppress_rowsplit" ? "Generate .zip" : "Generate .nbt"}
                </button>
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
                  {suppressedCount > 0 && (
                    <span>
                      <strong className="text-foreground">{plural(suppressedCount, "void shadow")}</strong>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <button
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${colRangeEnabled ? "border-primary bg-primary/15 text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setColRangeEnabled(v => !v)}
                  >
                    {effectiveBuildMode === "suppress_pairs_ew" ? "Step range" : "Column range"}
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
                            return Math.round(pct * 127);
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
                          style={{ left: `${(colStart / 127) * 100}%`, right: `${100 - (colEnd / 127) * 100}%` }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground -ml-1.5"
                          style={{ left: `${(colStart / 127) * 100}%` }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground -ml-1.5"
                          style={{ left: `${(colEnd / 127) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-foreground w-6">{colEnd}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Credits */}
          <div className="mt-auto text-[11px] text-muted-foreground text-left space-y-0.5 px-1 pt-4">
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
              — Primary author
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
              — Color suppression expert; inventor of 2‑layer method
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
            <p>And everyone who gave feedback ♥</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
