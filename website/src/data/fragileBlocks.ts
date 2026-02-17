// Blocks with placement conditions (from MCPropertyEncyclopedia)
// These blocks require a supporting block below them to stay placed.
// Source: https://joakimthorsen.github.io/MCPropertyEncyclopedia/?selection=placement_condition&filter=(placement_condition:No)

export const FRAGILE_BLOCKS = new Set([
  // Carpets
  "white_carpet", "orange_carpet", "magenta_carpet", "light_blue_carpet",
  "yellow_carpet", "lime_carpet", "pink_carpet", "gray_carpet",
  "light_gray_carpet", "cyan_carpet", "purple_carpet", "blue_carpet",
  "brown_carpet", "green_carpet", "red_carpet", "black_carpet",
  "moss_carpet", "pale_moss_carpet",

  // Pressure plates
  "stone_pressure_plate", "oak_pressure_plate", "birch_pressure_plate",
  "spruce_pressure_plate", "jungle_pressure_plate", "acacia_pressure_plate",
  "dark_oak_pressure_plate", "crimson_pressure_plate", "warped_pressure_plate",
  "cherry_pressure_plate", "pale_oak_pressure_plate",
  "light_weighted_pressure_plate", "heavy_weighted_pressure_plate",
  "mangrove_pressure_plate",

  // Signs (standing)
  "oak_sign", "birch_sign", "spruce_sign", "jungle_sign", "acacia_sign",
  "dark_oak_sign", "crimson_sign", "warped_sign", "cherry_sign",
  "pale_oak_sign", "mangrove_sign",

  // Doors
  "oak_door", "birch_door", "spruce_door", "jungle_door", "acacia_door",
  "dark_oak_door", "crimson_door", "warped_door", "cherry_door",
  "pale_oak_door", "mangrove_door", "iron_door",

  // Trapdoors
  "oak_trapdoor", "birch_trapdoor", "spruce_trapdoor", "jungle_trapdoor",
  "acacia_trapdoor", "dark_oak_trapdoor", "crimson_trapdoor", "warped_trapdoor",
  "cherry_trapdoor", "pale_oak_trapdoor", "mangrove_trapdoor", "iron_trapdoor",

  // Candles
  "candle", "white_candle", "orange_candle", "magenta_candle",
  "light_blue_candle", "yellow_candle", "lime_candle", "pink_candle",
  "gray_candle", "light_gray_candle", "cyan_candle", "purple_candle",
  "blue_candle", "brown_candle", "green_candle", "red_candle", "black_candle",

  // Plants / vegetation with placement conditions
  "pink_petals", "fern", "short_grass", "tall_grass", "dead_bush",
  "sugar_cane", "cactus", "vines", "lily_pad",
  "crimson_roots", "warped_roots", "nether_sprouts",
  "twisting_vines", "weeping_vines",
  "crimson_fungus", "warped_fungus",
  "hanging_roots", "sea_pickle", "nether_wart",
  "bamboo_sapling", "brown_mushroom", "red_mushroom",
  "chorus_plant", "chorus_flower",

  // Other blocks with placement conditions
  "fire", "snow", "pointed_dripstone", "lantern",
  "bell", "turtle_egg", "leaf_litter",
  "open_eyeblossom", "closed_eyeblossom",
  "sculk_sensor", "calibrated_sculk_sensor", "sculk_vein",
  "scaffolding", "glow_lichen", "resin_clump",
]);

/**
 * Check if a block name (possibly with properties like "[south=true]") is fragile.
 * Strips the property suffix before checking.
 */
export function isFragileBlock(blockId: string): boolean {
  const name = blockId.includes("[") ? blockId.slice(0, blockId.indexOf("[")) : blockId;
  return FRAGILE_BLOCKS.has(name);
}
