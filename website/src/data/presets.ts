/**
 * Public API:
 * - BlockPreset
 * - BUILTIN_PRESET_NAMES
 * - arePresetBlocksEqual
 * - findMatchingBuiltinPresetName
 * - getBuiltinPreset
 * - isAutoCustomPresetName
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/ToolbarPresetSettings.tsx
 * - src/lib/codecPreset.ts
 * - tests/run.mts
 */
import { BASE_COLORS } from "@/data/mapColors";
import type { ColorRgb } from "@/types/color";

// Callers:
// - src/Index.tsx
// - src/components/ToolbarPresetSettings.tsx
// - src/lib/codecPreset.ts
// - tests/run.mts
export interface BlockPreset {
  name: string;
  customColors?: ColorRgb[];
  selectedBlocks: Record<number, string>;
  selectedBlocksCustom?: Record<number, string>;
}

// Callers:
// - src/Index.tsx
export const BUILTIN_PRESET_NAMES = ["Fullblock", "Carpets", "PistonClear"] as const;

function buildPistonClearPreset(): BlockPreset {
  return {
    name: "PistonClear",
    selectedBlocks: {
      0: "",
      1: "",
      2: "birch_pressure_plate",
      3: "white_candle",
      4: "fire",
      5: "",
      6: "heavy_weighted_pressure_plate",
      7: "pink_petals",
      8: "white_carpet",
      9: "",
      10: "jungle_pressure_plate",
      11: "stone_pressure_plate",
      12: "oak_leaves[waterlogged=true]",
      13: "oak_pressure_plate",
      14: "pale_oak_pressure_plate",
      15: "orange_carpet",
      16: "magenta_carpet",
      17: "light_blue_carpet",
      18: "yellow_carpet",
      19: "lime_carpet",
      20: "pink_carpet",
      21: "gray_carpet",
      22: "light_gray_carpet",
      23: "cyan_carpet",
      24: "purple_carpet",
      25: "blue_carpet",
      26: "brown_carpet",
      27: "green_carpet",
      28: "red_carpet",
      29: "black_carpet",
      30: "light_weighted_pressure_plate",
      31: "",
      32: "",
      33: "",
      34: "spruce_pressure_plate",
      35: "crimson_roots",
      36: "cherry_pressure_plate",
      37: "resin_clump[down=true]",
      38: "",
      39: "",
      40: "",
      41: "",
      42: "",
      43: "",
      44: "",
      45: "",
      46: "",
      47: "",
      48: "pointed_dripstone",
      49: "",
      50: "",
      51: "",
      52: "",
      53: "crimson_pressure_plate",
      54: "",
      55: "",
      56: "warped_pressure_plate",
      57: "",
      58: "",
      59: "",
      60: "",
      61: "glow_lichen[down=true]",
    },
  };
}

function buildCarpetsPreset(): BlockPreset {
  return {
    name: "Carpets",
    selectedBlocks: Object.fromEntries(
      BASE_COLORS.map((color, index) => [
        index,
        color.blocks.find(block => block.endsWith("_carpet")) ?? "",
      ]),
    ),
  };
}

function buildFullblockPreset(): BlockPreset {
  return {
    name: "Fullblock",
    selectedBlocks: {
      0: "",
      1: "slime_block",
      2: "sandstone",
      3: "mushroom_stem",
      4: "tnt",
      5: "packed_ice",
      6: "lodestone",
      7: "bamboo_block[axis=x]",
      8: "white_glazed_terracotta",
      9: "clay",
      10: "brown_mushroom_block",
      11: "andesite",
      12: "water",
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
      50: "decorated_pot",
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

const BUILTIN_BUILDERS: Record<string, () => BlockPreset> = {
  PistonClear: buildPistonClearPreset,
  Carpets: buildCarpetsPreset,
  Fullblock: buildFullblockPreset,
};

// Callers:
// - src/Index.tsx
export function arePresetBlocksEqual(
  left: Record<number, string>,
  right: Record<number, string>,
): boolean {
  return BASE_COLORS.every((_, baseIndex) => (left[baseIndex] ?? "") === (right[baseIndex] ?? ""));
}

// Callers:
// - src/Index.tsx
// - tests/run.mts
export const getBuiltinPreset = (name: string): BlockPreset | null => BUILTIN_BUILDERS[name]?.() ?? null;
// Callers:
// - src/Index.tsx
export const isAutoCustomPresetName = (name: string): boolean => /^Custom(?: \d+)?$/.test(name);
// Callers:
// - src/Index.tsx
export function findMatchingBuiltinPresetName(selectedBlocks: Record<number, string>): string | null {
  return BUILTIN_PRESET_NAMES.find(name => {
    const builtin = BUILTIN_BUILDERS[name]();
    return arePresetBlocksEqual(selectedBlocks, builtin.selectedBlocks);
  }) ?? null;
}
