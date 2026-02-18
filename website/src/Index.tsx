import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { BASE_COLORS, getColorLookup, getShadedRgb } from "@/data/mapColors";
import { validatePng, convertToNbt, computeMaterialCounts, type CustomColor, type BuildMode, type SupportMode } from "@/lib/converter";

// ── Preset types ──
interface Preset {
  name: string;
  blocks: Record<number, string>;
}

const BUILTIN_PRESET_NAMES = ["Default", "Carpets", "Fullblock"];

function buildDefaultPreset(): Preset {
  const blocks: Record<number, string> = {};
  for (let i = 1; i < BASE_COLORS.length; i++) {
    const c = BASE_COLORS[i];
    const name = c.name;
    if (name === "SNOW") { blocks[i] = "white_carpet"; continue; }
    if (name === "FIRE") { blocks[i] = "redstone_block"; continue; }
    if (name === "WOOL") { blocks[i] = "white_candle"; continue; }
    if (name === "WOOD") { blocks[i] = "oak_pressure_plate"; continue; }
    if (name === "WATER") { blocks[i] = "oak_leaves[waterlogged=true]"; continue; }
    if (name === "NETHER") { blocks[i] = "crimson_roots"; continue; }
    if (name === "PLANT") { blocks[i] = "pink_petals"; continue; }
    if (name === "DIAMOND") { blocks[i] = "prismarine_bricks"; continue; }
    if (name === "TERRACOTTA_RED") { blocks[i] = "decorated_pot"; continue; }
    if (name === "TERRACOTTA_ORANGE") { blocks[i] = "resin_clump[south=true]"; continue; }
    if (name === "TERRACOTTA_CYAN") { blocks[i] = "mud"; continue; }
    if (name.startsWith("COLOR_")) {
      const carpet = c.blocks.find(b => b.endsWith("_carpet"));
      if (carpet) { blocks[i] = carpet; continue; }
    }
    const plate = c.blocks.find(b => b.endsWith("_pressure_plate"));
    if (plate) { blocks[i] = plate; continue; }
    blocks[i] = c.blocks[0] || "";
  }
  return { name: "Default", blocks };
}

function buildCarpetsPreset(): Preset {
  const def = buildDefaultPreset();
  const blocks: Record<number, string> = {};
  for (let i = 1; i < BASE_COLORS.length; i++) {
    const b = def.blocks[i] || "";
    blocks[i] = b.endsWith("_carpet") ? b : "";
  }
  return { name: "Carpets", blocks };
}

function buildFullblockPreset(): Preset {
  const def = buildDefaultPreset();
  const specific: Record<number, string> = {
    1:"grass_block",2:"sandstone",3:"mushroom_stem",4:"tnt",5:"ice",6:"iron_block",
    7:"oak_leaves",8:"white_concrete",10:"granite",11:"andesite",
    12:"oak_leaves[waterlogged=true]",13:"oak_planks",14:"diorite",
    15:"orange_concrete",16:"magenta_concrete",17:"light_blue_concrete",
    18:"yellow_concrete",19:"lime_concrete",20:"pink_concrete",21:"gray_concrete",
    22:"light_gray_concrete",23:"cyan_concrete",24:"purple_concrete",
    25:"blue_concrete",26:"brown_concrete",27:"green_concrete",28:"red_concrete",
    29:"black_concrete",30:"gold_block",31:"prismarine_bricks",34:"spruce_planks",
    35:"netherrack",36:"white_terracotta",37:"orange_terracotta",43:"gray_terracotta",
    44:"light_gray_terracotta",53:"crimson_planks",56:"warped_planks",61:"verdant_froglight"
  };
  const blocks: Record<number, string> = {};
  for (let i = 1; i < BASE_COLORS.length; i++) {
    blocks[i] = specific[i] !== undefined ? specific[i] : (def.blocks[i] || "");
  }
  return { name: "Fullblock", blocks };
}

function getBuiltinPreset(name: string): Preset | null {
  if (name === "Default") return buildDefaultPreset();
  if (name === "Carpets") return buildCarpetsPreset();
  if (name === "Fullblock") return buildFullblockPreset();
  return null;
}

function loadPresets(): Preset[] {
  const builtins = [buildDefaultPreset(), buildCarpetsPreset(), buildFullblockPreset()];
  try {
    const raw = localStorage.getItem("mapart_presets");
    if (raw) {
      const parsed: Preset[] = JSON.parse(raw);
      const customPresets = parsed.filter(p => !BUILTIN_PRESET_NAMES.includes(p.name));
      return [...builtins, ...customPresets];
    }
  } catch { /* ignore */ }
  return builtins;
}

function savePresets(presets: Preset[]) {
  localStorage.setItem("mapart_presets", JSON.stringify(presets));
}

function loadCached<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return JSON.parse(v);
  } catch { /* ignore */ }
  return fallback;
}

function getDisplayName(name: string): string {
  if (name === "SNOW") return "WHITE";
  if (name === "WOOL") return "STEM";
  if (name.startsWith("COLOR_")) return name.slice(6);
  return name;
}

// ── Creative menu order for wool/terracotta colors ──
const WOOL_CREATIVE_ORDER = [8, 22, 21, 29, 26, 28, 15, 18, 19, 27, 23, 17, 25, 24, 16, 20];
const TERRACOTTA_CREATIVE_ORDER = [36, 44, 43, 51, 48, 50, 37, 40, 41, 49, 45, 39, 47, 46, 38, 42];

function getDefaultSortedIndices(): number[] {
  const woolSet = new Set(WOOL_CREATIVE_ORDER);
  const terraSet = new Set(TERRACOTTA_CREATIVE_ORDER);
  const otherIndices: number[] = [];
  for (let i = 1; i < BASE_COLORS.length; i++) {
    if (!woolSet.has(i) && !terraSet.has(i)) otherIndices.push(i);
  }
  // Note: index 0 (NONE) is excluded from default sorted; shown only when custom-mapped
  otherIndices.sort((a, b) => BASE_COLORS[b].blocks.length - BASE_COLORS[a].blocks.length);
  return [...WOOL_CREATIVE_ORDER, ...TERRACOTTA_CREATIVE_ORDER, ...otherIndices];
}

const DEFAULT_SORTED = getDefaultSortedIndices();

function getHue(r: number, g: number, b: number): number {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + 6) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return h * 60;
}

type SortKey = "default" | "name" | "options" | "color" | "id" | "required";
type SortDir = "asc" | "desc";

function imageHasNonFlatShades(imageData: ImageData, customColors: CustomColor[]): boolean {
  const lookup = getColorLookup();
  const customLookup = new Set(customColors.map(cc => `${cc.r},${cc.g},${cc.b}`));
  for (let i = 0; i < imageData.data.length; i += 4) {
    const a = imageData.data[i + 3];
    if (a === 0) continue;
    const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
    const key = `${r},${g},${b}`;
    if (customLookup.has(key)) continue;
    const match = lookup.get(key);
    if (match && match.shade !== 1) return true;
  }
  return false;
}

function detectSuppressPattern(imageData: ImageData, customColors: CustomColor[]): boolean {
  const lookup = getColorLookup();
  const customLookup = new Set(customColors.map(cc => `${cc.r},${cc.g},${cc.b}`));
  for (let x = 0; x < 128; x++) {
    for (let z = 0; z < 128; z++) {
      const idx = (z * 128 + x) * 4;
      if (imageData.data[idx + 3] !== 0) continue;
      for (let sz = z + 1; sz < 128; sz++) {
        const sIdx = (sz * 128 + x) * 4;
        if (imageData.data[sIdx + 3] === 0) continue;
        const sr = imageData.data[sIdx], sg = imageData.data[sIdx + 1], sb = imageData.data[sIdx + 2];
        const sKey = `${sr},${sg},${sb}`;
        if (customLookup.has(sKey)) break;
        const match = lookup.get(sKey);
        if (!match) break;
        if (match.shade === 2) break;
        if (match.shade === 0 || match.shade === 3) return true;
        break;
      }
    }
  }
  return false;
}

function countSuppressedPixels(imageData: ImageData, customColors: CustomColor[]): number {
  const lookup = getColorLookup();
  const customLookup = new Set(customColors.map(cc => `${cc.r},${cc.g},${cc.b}`));
  let count = 0;
  for (let x = 0; x < 128; x++) {
    for (let z = 0; z < 128; z++) {
      const idx = (z * 128 + x) * 4;
      if (imageData.data[idx + 3] !== 0) continue;
      for (let sz = z + 1; sz < 128; sz++) {
        const sIdx = (sz * 128 + x) * 4;
        if (imageData.data[sIdx + 3] === 0) continue;
        const sr = imageData.data[sIdx], sg = imageData.data[sIdx + 1], sb = imageData.data[sIdx + 2];
        const sKey = `${sr},${sg},${sb}`;
        if (customLookup.has(sKey)) break;
        const match = lookup.get(sKey);
        if (!match) break;
        if (match.shade === 2) break;
        if (match.shade === 0 || match.shade === 3) { count++; break; }
      }
    }
  }
  return count;
}

// Compute shade/color stats from image
function computeImageInfo(
  imageData: ImageData,
  customColors: CustomColor[]
): { uniqueShadeCount: number; uniqueBaseColorCount: number } {
  const lookup = getColorLookup();
  const customLookup = new Map<string, CustomColor>();
  for (const cc of customColors) customLookup.set(`${cc.r},${cc.g},${cc.b}`, cc);

  const usedBaseColors = new Set<number>();
  const usedShades = new Set<string>();

  for (let i = 0; i < imageData.data.length; i += 4) {
    const a = imageData.data[i + 3];
    if (a === 0) continue;
    const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
    const key = `${r},${g},${b}`;

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

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function formatStacks(count: number): string {
  if (count < 64) return String(count);
  const sb = Math.floor(count / (64 * 27));
  const remainder = count % (64 * 27);
  const st = Math.floor(remainder / 64);
  const items = remainder % 64;
  const parts: string[] = [];
  if (sb > 0) parts.push(`${sb}sb`);
  if (st > 0) parts.push(`${st}st`);
  if (items > 0) parts.push(String(items));
  return parts.join(" ") || "0";
}

function encodePreset(preset: Preset, fillerBlock: string, supportMode: SupportMode, buildMode: BuildMode, customColors: CustomColor[], sortKey: SortKey, sortDir: SortDir): string {
  const parts: string[] = [];
  for (let i = 1; i < BASE_COLORS.length; i++) {
    const block = preset.blocks[i] || "";
    const idx = BASE_COLORS[i].blocks.indexOf(block);
    if (idx >= 0) parts.push(String(idx));
    else if (block) parts.push("=" + block);
    else parts.push("-");
  }
  let s = preset.name + "|" + parts.join(",") + "|" + fillerBlock + "|" + supportMode + "|" + buildMode;
  s += "|" + (customColors.length > 0 ? customColors.map(cc => `${cc.r},${cc.g},${cc.b}:${cc.block}`).join(";") : "");
  s += "|" + sortKey + ":" + sortDir;
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodePreset(encoded: string): { preset: Preset; filler?: string; supportMode?: SupportMode; buildMode?: BuildMode; customColors?: CustomColor[]; sortKey?: SortKey; sortDir?: SortDir } | null {
  try {
    let s = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const raw = atob(s);
    const sections = raw.split("|");
    if (sections.length < 2) return null;
    const name = sections[0];
    const blocksPart = sections[1];
    const filler = sections[2] || undefined;
    // Backward compat: "1" → "steps", "0" → "none"
    const supportRaw = sections[3] || "none";
    const supportMode: SupportMode = supportRaw === "1" ? "steps" : supportRaw === "0" ? "none" : (supportRaw as SupportMode);
    const mode = (sections[4] || undefined) as BuildMode | undefined;

    const parts = blocksPart.split(",");
    const blocks: Record<number, string> = {};
    for (let i = 0; i < parts.length && i < BASE_COLORS.length - 1; i++) {
      const baseIdx = i + 1;
      const p = parts[i];
      if (p === "-" || p === "") blocks[baseIdx] = "";
      else if (p.startsWith("=")) blocks[baseIdx] = p.slice(1);
      else {
        const blockIdx = parseInt(p);
        blocks[baseIdx] = BASE_COLORS[baseIdx].blocks[blockIdx] || "";
      }
    }

    let customColors: CustomColor[] | undefined;
    if (sections[5]) {
      customColors = sections[5].split(";").map(entry => {
        const [rgb, block] = entry.split(":");
        const [r, g, b] = rgb.split(",").map(Number);
        return { r, g, b, block };
      }).filter(cc => !isNaN(cc.r) && cc.block);
    }

    let decodedSortKey: SortKey | undefined;
    let decodedSortDir: SortDir | undefined;
    if (sections[6]) {
      const [sk, sd] = sections[6].split(":");
      if (["default","name","options","color","id","required"].includes(sk)) decodedSortKey = sk as SortKey;
      if (sd === "asc" || sd === "desc") decodedSortDir = sd as SortDir;
    }

    return { preset: { name, blocks }, filler, supportMode, buildMode: mode, customColors, sortKey: decodedSortKey, sortDir: decodedSortDir };
  } catch { return null; }
}

// ── Component ──
const Index = () => {
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [activeIdx, setActiveIdx] = useState(() => {
    try {
      const name = JSON.parse(localStorage.getItem("mapart_activePreset") || '""');
      if (name) {
        const ps = loadPresets();
        const idx = ps.findIndex(p => p.name === name);
        if (idx >= 0) return idx;
      }
    } catch { /* ignore */ }
    return 0;
  });
  const [fillerBlock, setFillerBlock] = useState(() => loadCached("mapart_filler", "resin_block"));
  const [buildMode, setBuildMode] = useState<BuildMode>(() => loadCached("mapart_buildMode", "staircase_classic" as BuildMode));
  const [supportMode, setSupportMode] = useState<SupportMode>(() => loadCached("mapart_supportMode", "none" as SupportMode));
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
  const [sortKey, setSortKey] = useState<SortKey>(() => loadCached("mapart_sortKey", "default" as SortKey));
  const [sortDir, setSortDir] = useState<SortDir>(() => loadCached("mapart_sortDir", "asc" as SortDir));
  const [showUnusedColors, setShowUnusedColors] = useState(false);
  const [showStacks, setShowStacks] = useState(() => loadCached("mapart_showStacks", false));
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [highlightedColorIdx, setHighlightedColorIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const fillerInputRef = useRef<HTMLInputElement>(null);

  const preset = presets[activeIdx] || buildDefaultPreset();

  // Cache settings
  useEffect(() => { savePresets(presets); }, [presets]);
  useEffect(() => { localStorage.setItem("mapart_filler", JSON.stringify(fillerBlock)); }, [fillerBlock]);
  useEffect(() => { localStorage.setItem("mapart_buildMode", JSON.stringify(buildMode)); }, [buildMode]);
  useEffect(() => { localStorage.setItem("mapart_supportMode", JSON.stringify(supportMode)); }, [supportMode]);
  useEffect(() => { localStorage.setItem("mapart_showStacks", JSON.stringify(showStacks)); }, [showStacks]);
  useEffect(() => { localStorage.setItem("mapart_activePreset", JSON.stringify(preset.name)); }, [preset.name]);
  useEffect(() => { localStorage.setItem("mapart_sortKey", JSON.stringify(sortKey)); }, [sortKey]);
  useEffect(() => { localStorage.setItem("mapart_sortDir", JSON.stringify(sortDir)); }, [sortDir]);

  const hasNonFlatShades = useMemo(() => {
    if (!imageData) return false;
    return imageHasNonFlatShades(imageData, customColors);
  }, [imageData, customColors]);

  const hasSuppressPattern = useMemo(() => {
    if (!imageData || !hasNonFlatShades) return false;
    return detectSuppressPattern(imageData, customColors);
  }, [imageData, customColors, hasNonFlatShades]);

  const suppressedCount = useMemo(() => {
    if (!imageData) return 0;
    return countSuppressedPixels(imageData, customColors);
  }, [imageData, customColors]);

  // Compute which base colors the image uses
  const usedBaseColors = useMemo(() => {
    if (!imageData || !imageValid) return new Set<number>();
    const lookup = getColorLookup();
    const used = new Set<number>();
    for (let i = 0; i < imageData.data.length; i += 4) {
      const a = imageData.data[i + 3];
      if (a === 0) continue;
      const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
      const match = lookup.get(`${r},${g},${b}`);
      if (match) used.add(match.baseIndex);
    }
    return used;
  }, [imageData, imageValid]);

  // Check if image contains water color (base index 12)
  const imageHasWater = useMemo(() => usedBaseColors.has(12), [usedBaseColors]);

  // Check if filler block has NONE color (not in any BASE_COLORS block list)
  const fillerIsNoneColor = useMemo(() => {
    const stripped = fillerBlock.includes("[") ? fillerBlock.slice(0, fillerBlock.indexOf("[")) : fillerBlock;
    for (let i = 1; i < BASE_COLORS.length; i++) {
      for (const b of BASE_COLORS[i].blocks) {
        const bStripped = b.includes("[") ? b.slice(0, b.indexOf("[")) : b;
        if (bStripped === stripped) return false;
      }
    }
    return true;
  }, [fillerBlock]);

  // Compute missing blocks dynamically based on current preset
  const missingBlocks = useMemo(() => {
    if (!imageValid || usedBaseColors.size === 0) return [];
    const missing: number[] = [];
    usedBaseColors.forEach(idx => {
      if (idx > 0 && !preset.blocks[idx]) missing.push(idx);
    });
    return missing;
  }, [imageValid, usedBaseColors, preset.blocks]);

  // Image shade/color stats
  const imageInfo = useMemo(() => {
    if (!imageData || !imageValid) return null;
    return computeImageInfo(imageData, customColors);
  }, [imageData, imageValid, customColors]);

  // Material counts from actual block generation
  const materialCounts = useMemo(() => {
    if (!imageData || !imageValid) return null;
    try {
      return computeMaterialCounts(imageData, {
        blockMapping: preset.blocks,
        fillerBlock,
        customColors,
        buildMode: hasNonFlatShades ? buildMode : "flat",
        supportMode,
        baseName: "",
      });
    } catch {
      return null;
    }
  }, [imageData, imageValid, preset.blocks, fillerBlock, customColors, buildMode, supportMode, hasNonFlatShades]);

  const sortedMaterials = useMemo(() => {
    if (!materialCounts) return [];
    return Object.entries(materialCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [materialCounts]);

  // Compute filler-only count by running with a sentinel filler
  const fillerOnlyCount = useMemo(() => {
    if (!imageData || !imageValid || !materialCounts) return 0;
    try {
      const sentinel = "\x00sentinel";
      const altCounts = computeMaterialCounts(imageData, {
        blockMapping: preset.blocks, fillerBlock: sentinel, customColors,
        buildMode: hasNonFlatShades ? buildMode : "flat", supportMode, baseName: ""
      });
      return altCounts[sentinel] || 0;
    } catch { return 0; }
  }, [imageData, imageValid, materialCounts, preset.blocks, customColors, buildMode, supportMode, hasNonFlatShades]);

  // Per-color required counts (excluding filler usage)
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

  // Reverse lookup: block name → base color index
  const blockToBaseIndex = useMemo(() => {
    const map: Record<string, number> = {};
    for (let i = 1; i < BASE_COLORS.length; i++) {
      if (preset.blocks[i] && !map[preset.blocks[i]]) {
        map[preset.blocks[i]] = i;
      }
    }
    return map;
  }, [preset.blocks]);

  // Check if current preset matches its builtin defaults (for hiding Share)
  const isBuiltinUnedited = useMemo(() => {
    const builtin = getBuiltinPreset(preset.name);
    if (!builtin) return false;
    return JSON.stringify(builtin.blocks) === JSON.stringify(preset.blocks);
  }, [preset]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("preset");
    if (encoded) {
      const decoded = decodePreset(encoded);
      if (decoded) {
        setPresets(prev => {
          const exists = prev.findIndex(p => p.name === decoded.preset.name);
          if (exists >= 0) { const n = [...prev]; n[exists] = decoded.preset; return n; }
          return [...prev, decoded.preset];
        });
        if (decoded.filler) setFillerBlock(decoded.filler);
        if (decoded.supportMode !== undefined) setSupportMode(decoded.supportMode);
        if (decoded.buildMode) setBuildMode(decoded.buildMode);
        if (decoded.customColors) setCustomColors(decoded.customColors);
        if (decoded.sortKey) setSortKey(decoded.sortKey);
        if (decoded.sortDir) setSortDir(decoded.sortDir);
      }
    }
  }, []);

  // Auto-select mode when image changes
  useEffect(() => {
    if (!imageData) return;
    if (!hasNonFlatShades) {
      setBuildMode("flat");
    } else if (hasSuppressPattern) {
      setBuildMode(prev => {
        if (prev.startsWith("staircase") || prev === "flat") return "suppress_pairs_ew";
        return prev;
      });
    } else {
      setBuildMode(prev => {
        if (prev === "flat") return "staircase_classic";
        return prev;
      });
    }
  }, [imageData, hasNonFlatShades, hasSuppressPattern]);

  // Reset support mode if it becomes invalid for current image
  useEffect(() => {
    if (!imageData) return;
    if (supportMode === "steps" && !hasNonFlatShades) {
      setSupportMode("none");
    }
    if (supportMode === "water" && (!imageHasWater || !fillerIsNoneColor)) {
      setSupportMode("none");
    }
  }, [imageData, hasNonFlatShades, imageHasWater, fillerIsNoneColor, supportMode]);

  const customBlocksByBase = useMemo(() => {
    const map: Record<number, string[]> = {};
    for (const cc of customColors) {
      // Check index 0 (NONE) as well
      for (let i = 0; i < BASE_COLORS.length; i++) {
        const bc = BASE_COLORS[i];
        if (bc.r === cc.r && bc.g === cc.g && bc.b === cc.b) {
          if (!map[i]) map[i] = [];
          if (!map[i].includes(cc.block)) map[i].push(cc.block);
        }
      }
    }
    return map;
  }, [customColors]);

  // Check if NONE (index 0) has a custom block assigned
  const noneHasCustomBlock = useMemo(() => {
    return !!(customBlocksByBase[0] && customBlocksByBase[0].length > 0) || !!preset.blocks[0];
  }, [customBlocksByBase, preset.blocks]);

  const sortedIndices = useMemo(() => {
    const effectiveKey = sortKey;
    const effectiveDir = sortDir;
    // Include NONE (0) only if it has a custom block
    const baseIndices = noneHasCustomBlock ? [0, ...DEFAULT_SORTED] : [...DEFAULT_SORTED];
    if (effectiveKey === "default") return baseIndices;
    const indices = [...baseIndices];
    const dir = effectiveDir === "asc" ? 1 : -1;
    if (effectiveKey === "name") indices.sort((a, b) => dir * getDisplayName(BASE_COLORS[a].name).localeCompare(getDisplayName(BASE_COLORS[b].name)));
    else if (effectiveKey === "options") indices.sort((a, b) => dir * (BASE_COLORS[a].blocks.length - BASE_COLORS[b].blocks.length));
    else if (effectiveKey === "color") indices.sort((a, b) => dir * (getHue(BASE_COLORS[a].r, BASE_COLORS[a].g, BASE_COLORS[a].b) - getHue(BASE_COLORS[b].r, BASE_COLORS[b].g, BASE_COLORS[b].b)));
    else if (effectiveKey === "id") indices.sort((a, b) => dir * (a - b));
    else if (effectiveKey === "required") indices.sort((a, b) => dir * ((colorRequiredMap[a] || 0) - (colorRequiredMap[b] || 0)));
    return indices;
  }, [sortKey, sortDir, materialCounts, colorRequiredMap, noneHasCustomBlock]);

  // Split used vs unused when image is loaded
  const { usedIndices, unusedIndices } = useMemo(() => {
    if (!imageValid || usedBaseColors.size === 0) return { usedIndices: sortedIndices, unusedIndices: [] as number[] };
    const used = sortedIndices.filter(idx => usedBaseColors.has(idx));
    const unused = sortedIndices.filter(idx => !usedBaseColors.has(idx));
    return { usedIndices: used, unusedIndices: unused };
  }, [sortedIndices, imageValid, usedBaseColors]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey("default"); setSortDir("asc"); }
    } else { setSortKey(key); setSortDir("asc"); }
  };

  const sortArrow = (key: SortKey) => {
    return sortKey !== key ? "" : sortDir === "asc" ? " ▲" : " ▼";
  };

  const updateBlock = (baseIndex: number, block: string) => {
    setPresets(prev => {
      const n = [...prev];
      n[activeIdx] = { ...n[activeIdx], blocks: { ...n[activeIdx].blocks, [baseIndex]: block } };
      return n;
    });
  };

  const selectPreset = (idx: number) => {
    const p = presets[idx];
    const builtin = getBuiltinPreset(p.name);
    if (builtin) {
      setPresets(prev => {
        const n = [...prev];
        n[idx] = builtin;
        return n;
      });
    }
    setActiveIdx(idx);
  };

  const createPreset = () => {
    const name = prompt("Enter preset name:");
    if (!name?.trim()) return;
    const np: Preset = { name: name.trim(), blocks: { ...preset.blocks } };
    setPresets(prev => [...prev, np]);
    setActiveIdx(presets.length);
  };

  const deletePreset = () => {
    if (BUILTIN_PRESET_NAMES.includes(preset.name)) return;
    if (presets.length <= 1) return;
    setPresets(prev => prev.filter((_, i) => i !== activeIdx));
    setActiveIdx(0);
  };

  const sharePreset = () => {
    const encoded = encodePreset(preset, fillerBlock, supportMode, buildMode, customColors, sortKey, sortDir);
    const url = `${window.location.origin}${window.location.pathname}?preset=${encoded}`;
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

  const handleFile = useCallback((file: File) => {
    setPaletteErrors([]);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height);
      const result = validatePng(data, customColors);
      if (!result.valid) {
        setImageData(null);
        setImageName("");
        setImageValid(false);
        setPaletteErrors(result.errors);
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
      setImageData(data);
      setImageName(file.name);
      setImageValid(true);
      setPaletteErrors([]);
      setShowUnusedColors(false);
      // Auto-sort by Required desc when image loads and no explicit sort active
      if (sortKey === "default") {
        setSortKey("required");
        setSortDir("desc");
      }
    };
    img.src = URL.createObjectURL(file);
  }, [customColors]);

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
      });

      // Map build mode to download suffix
      const suffixMap: Record<string, string> = {
        flat: "",
        staircase_classic: "-staircase_classic",
        staircase_northline: "-staircase_northline",
        staircase_southline: "-staircase_southline",
        staircase_valley: "-staircase_valley",
        staircase_cancer: "-staircase_cancer",
        suppress_checker: "-suppress_plaid_NS",
        suppress_pairs: "-suppress_rowsplit",
        suppress_pairs_ew: "-suppress_pairs_EW",
      };
      const suffix = suffixMap[buildMode] ?? `-${buildMode}`;

      if (result.isZip) {
        const blob = new Blob([result.data.buffer as ArrayBuffer], { type: "application/zip" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${baseName}${suffix}.zip`;
        a.click();
      } else {
        const blob = new Blob([result.data.buffer as ArrayBuffer], { type: "application/octet-stream" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${baseName}${suffix}.nbt`;
        a.click();
      }
    } catch (e: unknown) {
      setPaletteErrors([(e as Error).message || "Conversion failed"]);
    }
    setConverting(false);
  };

  const addCustomColor = () => {
    if (customMode === "custom") {
      const r = parseInt(newCustom.r), g = parseInt(newCustom.g), b = parseInt(newCustom.b);
      if (isNaN(r) || isNaN(g) || isNaN(b) || !newCustom.block.trim()) return;
      setCustomColors(prev => [...prev, { r, g, b, block: newCustom.block.trim() }]);
    } else {
      if (!newCustom.block.trim()) return;
      const bc = BASE_COLORS[customMode];
      setCustomColors(prev => [...prev, { r: bc.r, g: bc.g, b: bc.b, block: newCustom.block.trim() }]);
    }
    setNewCustom({ r: "", g: "", b: "", block: "" });
  };

  const copyColorToClipboard = (r: number, g: number, b: number) => {
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    navigator.clipboard.writeText(hex);
  };

  const toggleTheme = () => {
    const next = isDark ? "light" : "dark";
    localStorage.setItem("mapart_theme", next);
    if (next === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    setIsDark(next === "dark");
  };

  const handleMaterialClick = (blockName: string) => {
    // Find the base color index that maps to this block
    const baseIdx = blockToBaseIndex[blockName];
    if (baseIdx) {
      setHighlightedColorIdx(baseIdx);
      const el = colorRowRefs.current[baseIdx];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightedColorIdx(null), 2000);
    } else {
      // Might be filler block - scroll to filler input
      if (fillerInputRef.current) {
        fillerInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        fillerInputRef.current.focus();
      }
    }
  };

  const canGenerate = imageValid && missingBlocks.length === 0;

  const hasRequiredCol = materialCounts !== null;

  // Compute dynamic width for required column based on widest value or header
  const requiredColWidth = useMemo(() => {
    if (!materialCounts) return 0;
    let maxLen = 0;
    for (const idx of Object.keys(colorRequiredMap)) {
      const count = colorRequiredMap[Number(idx)];
      if (count > 0) {
        const text = showStacks ? formatStacks(count) : String(count);
        if (text.length > maxLen) maxLen = text.length;
      }
    }
    // Width based on content: ~6px per char + padding
    const contentWidth = maxLen * 6 + 12;
    // Header "Required ▲" always reserved = ~62px
    const headerWidth = 70;
    return Math.max(headerWidth, contentWidth);
  }, [materialCounts, colorRequiredMap, showStacks]);

  const gridCols = useMemo(() => {
    const parts: string[] = ["20px"]; // color swatch
    if (showIds) parts.push("28px"); // ID
    if (showNames) parts.push("135px"); // Name
    parts.push("1fr"); // Block
    parts.push("46px"); // Options
    if (hasRequiredCol) parts.push(`${requiredColWidth}px`);
    return `grid-cols-[${parts.join("_")}]`;
  }, [showIds, showNames, hasRequiredCol, requiredColWidth]);

  const getAllBlocks = (idx: number) => {
    const color = BASE_COLORS[idx];
    const extraBlocks = customBlocksByBase[idx] || [];
    return [...color.blocks, ...extraBlocks.filter(eb => !color.blocks.includes(eb))].sort((a, b) => a.localeCompare(b));
  };

  const renderColorRow = (idx: number) => {
    const color = BASE_COLORS[idx];
    const [r, g, b] = getShadedRgb(idx, 2);
    const isMissing = missingBlocks.includes(idx);
    const isHighlighted = highlightedColorIdx === idx;
    const allBlocks = getAllBlocks(idx);
    const reqCount = colorRequiredMap[idx] || 0;
    return (
      <div
        key={idx}
        ref={el => { colorRowRefs.current[idx] = el; }}
        className={`grid ${gridCols} gap-1 items-center py-px text-xs transition-colors ${isMissing ? "bg-destructive/30 ring-1 ring-destructive/60 rounded" : ""} ${isHighlighted ? "bg-primary/20 ring-1 ring-primary/60 rounded" : ""}`}
      >
        <div
          className="w-5 h-5 rounded border border-border cursor-pointer hover:ring-1 hover:ring-primary/50 transition-shadow"
          style={{ backgroundColor: `rgb(${r},${g},${b})` }}
          title="Click to copy hex"
          onClick={() => copyColorToClipboard(r, g, b)}
        />
        {showIds && <span className="text-[10px] font-mono text-muted-foreground pl-1">{idx}</span>}
        {showNames && (
          <span className="text-[10px] font-mono text-muted-foreground truncate" title={getDisplayName(color.name)}>
            {getDisplayName(color.name)}
          </span>
        )}
        <select
          className="bg-input border border-border rounded px-1 h-6 text-[11px] font-mono text-foreground w-full"
          value={preset.blocks[idx] || ""}
          onChange={e => updateBlock(idx, e.target.value)}
        >
          <option value="">(none)</option>
          {allBlocks.map(b => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap pr-1">{allBlocks.length}</span>
        {hasRequiredCol && (
          <span className="text-[10px] font-mono text-right pr-1">
            {reqCount > 0 ? (showStacks ? formatStacks(reqCount) : reqCount) : ""}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 py-2 flex items-center justify-between">
        <h1 className="text-lg font-bold text-primary">MapArt PNG → NBT</h1>
        <button
          onClick={toggleTheme}
          className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
          title="Toggle light/dark theme"
        >
          {isDark ? "☀️" : "🌙"}
        </button>
      </header>

      <div className="flex flex-col lg:flex-row gap-3 p-3 max-w-[1600px] mx-auto">
        {/* LEFT COLUMN */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Preset Manager */}
          <section className="bg-card border border-border rounded-md p-2">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-semibold text-accent">Preset:</span>
              <select
                className="bg-input border border-border rounded px-2 h-6 text-foreground text-xs"
                value={activeIdx}
                onChange={e => selectPreset(Number(e.target.value))}
              >
                {presets.map((p, i) => (
                  <option key={i} value={i}>{p.name}</option>
                ))}
              </select>
              {!isBuiltinUnedited && (
                <button className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground" onClick={sharePreset}>Share</button>
              )}
              {!BUILTIN_PRESET_NAMES.includes(preset.name) && presets.length > 1 && (
                <button className="text-xs px-2 py-0.5 rounded border border-destructive text-destructive hover:bg-destructive/20" onClick={deletePreset}>Del</button>
              )}
              <button className="text-xs px-1.5 py-0.5 rounded border border-primary text-primary hover:bg-primary/20" onClick={createPreset} title="New preset">+</button>
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
            {imageData && (
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold text-accent whitespace-nowrap">Support:</span>
                <select
                  className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs"
                  value={supportMode}
                  onChange={e => setSupportMode(e.target.value as SupportMode)}
                >
                  <option value="none">None</option>
                  <option value="steps" disabled={!hasNonFlatShades}>Steps</option>
                  <option value="all">All</option>
                  <option value="fragile">Fragile</option>
                  <option value="water" disabled={!imageHasWater || !fillerIsNoneColor}>Water</option>
                </select>
              </div>
            )}
            {materialCounts && fillerOnlyCount > 0 && (
              <span className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1 border border-primary/40 bg-primary/5 rounded px-1.5 h-6">
                <span className="font-semibold">Required:</span>
                <span className="text-foreground">{materialCounts[fillerBlock] !== undefined && materialCounts[fillerBlock] > fillerOnlyCount ? fillerOnlyCount : (showStacks ? formatStacks(fillerOnlyCount) : fillerOnlyCount)}</span>
                {materialCounts[fillerBlock] !== undefined && materialCounts[fillerBlock] > fillerOnlyCount && (
                  <>
                    <span>(Total:</span>
                    <span className="text-foreground">{showStacks ? formatStacks(materialCounts[fillerBlock]) : materialCounts[fillerBlock]}</span>
                    <span>)</span>
                  </>
                )}
              </span>
            )}
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
                    <option value="suppress_checker" disabled>Suppress (Plaid, N→S)</option>
                    <option value="suppress_pairs_ew">Suppress (Pairs, E→W)</option>
                    <option value="suppress_pairs">Suppress (Row-wise split)</option>
                  </optgroup>
                </select>
              </div>
            )}
          </section>

          {/* Color → Block */}
          <section className="bg-card border border-border rounded-md p-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-accent">Color → Block</h2>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowIds(v => !v)}
                >
                  {showIds ? "Hide IDs" : "Show IDs"}
                </button>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowNames(v => !v)}
                >
                  {showNames ? "Hide names" : "Show names"}
                </button>
              </div>
              {imageInfo && imageValid && (
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
                  <span className="font-semibold text-accent">MC units:</span>
                  <input type="checkbox" checked={showStacks} onChange={e => setShowStacks(e.target.checked)} className="h-3 w-3" />
                </label>
              )}
            </div>
            <div key={`${showIds}-${showNames}`} className="relative">
              <div className={`grid ${gridCols} gap-1 text-[10px] font-semibold text-muted-foreground bg-card py-0.5 border-b border-border`}>
                <span className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort("color")} title="Sort by color hue">Clr{sortArrow("color")}</span>
                {showIds && <span className="cursor-pointer select-none whitespace-nowrap pl-1" onClick={() => toggleSort("id")}>&nbsp;ID{sortArrow("id")}</span>}
                {showNames && <span className="cursor-pointer select-none" onClick={() => toggleSort("name")}>Name{sortArrow("name")}</span>}
                <span>Block</span>
                <span className="cursor-pointer select-none whitespace-nowrap pr-1" onClick={() => toggleSort("options")}>Options{sortArrow("options")}</span>
                {hasRequiredCol && (
                  <span className="cursor-pointer select-none whitespace-nowrap text-right pr-1" onClick={() => toggleSort("required")}>Required{sortKey === "required" ? sortArrow("required") : <span className="invisible"> ▲</span>}</span>
                )}
              </div>
              {hasRequiredCol && usedIndices.length > 0 && (
                <div className="absolute top-0 bottom-0 border border-primary/40 bg-primary/5 rounded pointer-events-none" style={{ width: requiredColWidth - 1, right: -2 }} />
              )}
              <div className="relative">
                {usedIndices.map(renderColorRow)}
              </div>

              {imageValid && unusedIndices.length > 0 && (
                <div>
                  <button
                    className="w-full flex items-center gap-1 py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors border-t border-border mt-1"
                    onClick={() => setShowUnusedColors(v => !v)}
                  >
                    <span className={`inline-block transition-transform ${showUnusedColors ? "rotate-180" : ""}`}>▼</span>
                    <span>{plural(unusedIndices.length, "unused color")} (not in image)</span>
                  </button>
                  {showUnusedColors && (
                    <div className="opacity-50">
                      {unusedIndices.map(renderColorRow)}
                    </div>
                  )}
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
                    <div className="w-4 h-4 rounded border border-border flex-shrink-0" style={{ backgroundColor: `rgb(${cc.r},${cc.g},${cc.b})` }} />
                    <span className="font-mono text-[10px]">({cc.r},{cc.g},{cc.b})</span>
                    <span className="font-mono text-[10px] text-primary">→ {cc.block}</span>
                    <button className="text-destructive text-[10px] hover:underline" onClick={() => setCustomColors(prev => prev.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 items-center">
              <select
                className="bg-input border border-border rounded px-1 h-6 text-[11px] font-mono text-foreground w-48"
                value={customMode === "custom" ? "custom" : String(customMode)}
                onChange={e => { const v = e.target.value; setCustomMode(v === "custom" ? "custom" : parseInt(v)); }}
              >
              <option value="custom">Custom RGB</option>
                {Array.from({ length: BASE_COLORS.length }, (_, i) => i).map(idx => (
                  <option key={idx} value={idx}>{idx} – {getDisplayName(BASE_COLORS[idx].name)}</option>
                ))}
              </select>
              {customMode === "custom" && (
                <>
                  <div className="flex items-center gap-0.5">
                    <label className="text-[10px] text-muted-foreground">R</label>
                    <input className="w-10 h-6 text-[11px] font-mono no-spinner px-1 bg-input border border-border rounded" type="number" min={0} max={255}
                      value={newCustom.r} onChange={e => setNewCustom(p => ({ ...p, r: e.target.value }))} />
                  </div>
                  <div className="flex items-center gap-0.5">
                    <label className="text-[10px] text-muted-foreground">G</label>
                    <input className="w-10 h-6 text-[11px] font-mono no-spinner px-1 bg-input border border-border rounded" type="number" min={0} max={255}
                      value={newCustom.g} onChange={e => setNewCustom(p => ({ ...p, g: e.target.value }))} />
                  </div>
                  <div className="flex items-center gap-0.5">
                    <label className="text-[10px] text-muted-foreground">B</label>
                    <input className="w-10 h-6 text-[11px] font-mono no-spinner px-1 bg-input border border-border rounded" type="number" min={0} max={255}
                      value={newCustom.b} onChange={e => setNewCustom(p => ({ ...p, b: e.target.value }))} />
                  </div>
                </>
              )}
              <div className="flex items-center gap-0.5">
                <label className="text-[10px] text-muted-foreground">Block</label>
                <input className="w-40 h-6 text-[11px] font-mono px-1 bg-input border border-border rounded" placeholder="e.g. fart_block"
                  value={newCustom.block} onChange={e => setNewCustom(p => ({ ...p, block: e.target.value }))} />
              </div>
              <button className="h-6 px-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground" onClick={addCustomColor}>Add</button>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:w-[360px] lg:sticky lg:top-3 lg:self-start space-y-2">
          <section className="bg-card border border-border rounded-md p-3">
            <h2 className="text-sm font-semibold text-accent mb-2">Upload MapArt PNG</h2>
            <input ref={fileRef} type="file" accept=".png" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

            {/* Filename above the image */}
            {imageName && (
              <p className="text-xs text-primary font-mono truncate mb-1">{imageName}</p>
            )}

            <div
              className="border-2 border-dashed border-border rounded-md w-full aspect-square flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors overflow-hidden"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
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

            {/* Palette errors (wrong size, invalid colors) */}
            {paletteErrors.length > 0 && (
              <div className="mt-2 bg-destructive/25 border-2 border-destructive/50 rounded p-2">
                {paletteErrors.map((e, i) => (
                  <p key={i} className="text-xs text-destructive font-medium">{e}</p>
                ))}
              </div>
            )}

            {/* Missing block assignments warning */}
            {imageValid && missingBlocks.length > 0 && (
              <div className="mt-2 bg-destructive/25 border-2 border-destructive/50 rounded p-2">
                <p className="text-xs text-destructive font-medium">
                  {plural(missingBlocks.length, "color")} in the image {missingBlocks.length === 1 ? "has" : "have"} no block assigned in the preset.
                </p>
              </div>
            )}

            {/* Remove + Generate buttons */}
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
                  {converting ? "Converting..." : buildMode === "suppress_pairs" ? "Generate .zip" : "Generate .nbt"}
                </button>
              </div>
            )}

            {/* Image metadata + MC units below buttons */}
            {imageInfo && imageValid && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap items-center">
                  {imageInfo.uniqueShadeCount > sortedMaterials.length && (
                    <span><strong className="text-foreground">{plural(imageInfo.uniqueShadeCount, "unique color")}</strong></span>
                  )}
                  <span><strong className="text-foreground">{plural(sortedMaterials.length, "block type")}</strong></span>
                  {suppressedCount > 0 && (
                    <span><strong className="text-foreground">{plural(suppressedCount, "void shadow")}</strong></span>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default Index;
