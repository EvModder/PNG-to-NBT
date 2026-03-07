import { BASE_COLORS } from "@/data/mapColors";
import { isFragileBlock } from "@/data/fragileBlocks";

export interface Preset {
  name: string;
  blocks: Record<number, string>;
}

export const BUILTIN_PRESET_NAMES = ["PistonClear", "Carpets", "Fullblock"] as const;

export function buildPistonClearPreset(): Preset {
  const blocks: Record<number, string> = {};
  for (let i = 1; i < BASE_COLORS.length; ++i) {
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
      blocks[i] = ""; // no fragile option -> (none)
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
  for (let i = 1; i < BASE_COLORS.length; ++i) {
    const name = BASE_COLORS[i].name;
    if (overrides[name]) blocks[i] = overrides[name];
  }
  return { name: "PistonClear", blocks };
}

function buildCarpetsPreset(): Preset {
  const blocks: Record<number, string> = {};
  for (let i = 1; i < BASE_COLORS.length; ++i) {
    const carpet = BASE_COLORS[i].blocks.find(b => b.endsWith("_carpet"));
    blocks[i] = carpet ?? "";
  }
  return { name: "Carpets", blocks };
}

function buildFullblockPreset(): Preset {
  return {
    name: "Fullblock",
    blocks: {
      0: "",
      1: "slime_block",
      2: "sandstone",
      3: "mushroom_stem",
      4: "tnt",
      5: "packed_ice",
      6: "lodestone",
      7: "oak_leaves",
      8: "white_glazed_terracotta",
      9: "clay",
      10: "brown_mushroom_block",
      11: "andesite",
      12: "oak_leaves[waterlogged=true]",
      13: "oak_planks",
      14: "diorite",
      15: "honey_block",
      16: "purpur_block",
      17: "light_blue_glazed_terracotta",
      18: "yellow_glazed_terracotta",
      19: "melon",
      20: "pink_glazed_terracotta",
      21: "gray_glazed_terracotta",
      22: "light_gray_glazed_terracotta",
      23: "prismarine",
      24: "amethyst_block",
      25: "blue_glazed_terracotta",
      26: "dark_oak_planks",
      27: "green_glazed_terracotta",
      28: "red_mushroom_block",
      29: "blackstone",
      30: "gold_block",
      31: "prismarine_bricks",
      32: "lapis_block",
      33: "emerald_block",
      34: "spruce_planks",
      35: "netherrack",
      36: "calcite",
      37: "resin_block",
      38: "magenta_terracotta",
      39: "light_blue_terracotta",
      40: "yellow_terracotta",
      41: "lime_terracotta",
      42: "pink_terracotta",
      43: "tuff",
      44: "mud_bricks",
      45: "mud",
      46: "purple_terracotta",
      47: "blue_terracotta",
      48: "dripstone_block",
      49: "green_terracotta",
      50: "red_terracotta",
      51: "black_terracotta",
      52: "crimson_nylium",
      53: "crimson_planks",
      54: "crimson_hyphae",
      55: "warped_nylium",
      56: "warped_planks",
      57: "warped_hyphae",
      58: "warped_wart_block",
      59: "cobbled_deepslate",
      60: "raw_iron_block",
      61: "verdant_froglight",
    },
  };
}

const BUILTIN_BUILDERS: Record<string, () => Preset> = {
  PistonClear: buildPistonClearPreset,
  Carpets: buildCarpetsPreset,
  Fullblock: buildFullblockPreset,
};

export const getBuiltinPreset = (name: string): Preset | null => BUILTIN_BUILDERS[name]?.() ?? null;
export const isAutoCustomPresetName = (name: string): boolean => /^Custom(?: \d+)?$/.test(name);

export function loadPresets(): Preset[] {
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
