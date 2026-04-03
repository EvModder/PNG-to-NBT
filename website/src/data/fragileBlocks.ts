/**
 * Public API:
 * - FragileSupportRule
 * - FRAGILE_SUPPORT_RULES
 * - isFragileBlock()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/shapeModel.ts
 *
 * Notes:
 * - Blocks with placement conditions from MCPropertyEncyclopedia.
 * - These blocks require a supporting block below them to stay placed.
 */
const FRAGILE_BLOCKS = new Set([
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
  "pink_petals", "wildflowers", "fern", "short_grass", "tall_grass", "dead_bush",
  "sugar_cane", "cactus", "vine", "lily_pad",
  "crimson_roots", "warped_roots", "nether_sprouts",
  "twisting_vines", "weeping_vines",
  "crimson_fungus", "warped_fungus",
  "hanging_roots", "sea_pickle", "nether_wart",
  "brown_mushroom", "red_mushroom",
  "chorus_plant", "chorus_flower",

    // Other blocks with placement conditions
  "fire", "soul_fire", "snow", "pointed_dripstone", "lantern",
  "bell", "turtle_egg", "leaf_litter",
  "open_eyeblossom", "closed_eyeblossom",
  "sculk_sensor", "calibrated_sculk_sensor", "sculk_vein",
  "scaffolding", "glow_lichen", "resin_clump",
]);

const DIRT_LIKE_SUPPORT_BLOCKS = [
  "dirt",
  "mud",
  "podzol",
  "mycelium",
  "grass_block",
  "moss_block",
  "pale_moss_block",
  "coarse_dirt",
  "rooted_dirt",
  "muddy_mangrove_roots",
] as const;
// Intentionally omits some edge-case valid supports such as farmland, to keep the shared
// dirt-like family small and predictable across the fragile-support replacement rules.

const MUSHROOM_SUPPORT_BLOCKS = [
  ...DIRT_LIKE_SUPPORT_BLOCKS,
  "crimson_nylium",
  "warped_nylium",
  "soul_soil",
] as const;

const SAND_SUPPORT_BLOCKS = [
  "sand",
  "red_sand",
  "suspicious_sand",
] as const;

const SUGAR_CANE_SUPPORT_BLOCKS = [
  ...DIRT_LIKE_SUPPORT_BLOCKS,
  ...SAND_SUPPORT_BLOCKS,
] as const;

type FragileSupportRuleValue = {
  validSupportBlocks: readonly string[];
  replacementBlock: string;
};

// Callers:
// - src/Index.tsx
// - src/lib/shapeModel.ts
export type FragileSupportRule = Readonly<FragileSupportRuleValue>;

// Callers:
// - src/Index.tsx
// - src/lib/shapeModel.ts
export const FRAGILE_SUPPORT_RULES = new Map<string, FragileSupportRule>([
  ["fire", { validSupportBlocks: ["netherrack"], replacementBlock: "netherrack" }],
  ["soul_fire", { validSupportBlocks: ["soul_sand", "soul_soil"], replacementBlock: "soul_soil" }],
  ["nether_wart", { validSupportBlocks: ["soul_sand"], replacementBlock: "soul_sand" }],
  // Direct-below support only. Sugar cane also requires adjacent water, waterlogging, or frosted ice,
  // which is intentionally outside the scope of this replacement system.
  ["sugar_cane", { validSupportBlocks: SUGAR_CANE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  // Direct-below support only. This does not try to model the cactus side-adjacency survival rules.
  ["cactus", { validSupportBlocks: SAND_SUPPORT_BLOCKS, replacementBlock: "sand" }],
  // Low-light-capable substrates only. This intentionally does not try to model every possible
  // full-top support block mushrooms can use at low light.
  ["brown_mushroom", { validSupportBlocks: MUSHROOM_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["red_mushroom", { validSupportBlocks: MUSHROOM_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["crimson_fungus", { validSupportBlocks: MUSHROOM_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["crimson_roots", { validSupportBlocks: MUSHROOM_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["warped_fungus", { validSupportBlocks: MUSHROOM_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["warped_roots", { validSupportBlocks: MUSHROOM_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["nether_sprouts", { validSupportBlocks: MUSHROOM_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  // Intentionally partial: vanilla also allows some waterlogged support blocks.
  ["lily_pad", { validSupportBlocks: ["water", "ice", "frosted_ice"], replacementBlock: "ice" }],
  ["pink_petals", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["wildflowers", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["fern", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["short_grass", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["tall_grass", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["open_eyeblossom", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["closed_eyeblossom", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  // Intentionally omitted for simplicity, but perfectly valid supports: [sand, red_sand, and terracotta variants].
  ["dead_bush", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
]);

function getBaseBlockId(blockId: string): string {
  return blockId.includes("[") ? blockId.slice(0, blockId.indexOf("[")) : blockId;
}

/**
 * Check if a block name (possibly with properties like "[south=true]") is fragile.
 * Strips the property suffix before checking.
 */
// Callers:
// - src/Index.tsx
// - src/lib/shapeModel.ts
export function isFragileBlock(blockId: string): boolean {
  return FRAGILE_BLOCKS.has(getBaseBlockId(blockId));
}
