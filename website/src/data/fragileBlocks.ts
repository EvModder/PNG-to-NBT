/**
 * Public API:
 * - FRAGILE_SUPPORT_RULES
 * - isFragileBlock()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/minecraftVersion.ts
 * - src/lib/shapeModel.ts
 *
 * Notes:
 * - Placement conditions checked against Minecraft block implementations.
 * - These blocks require a supporting block below them to stay placed.
 */
const DIRT_SUPPORTED_FLOWERS = [
  "poppy", "dandelion", "golden_dandelion", "blue_orchid", "allium", "azure_bluet",
  "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy",
  "cornflower", "lily_of_the_valley", "torchflower",
] as const;

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
  "cherry_pressure_plate", "pale_oak_pressure_plate", "bamboo_pressure_plate",
  "light_weighted_pressure_plate", "heavy_weighted_pressure_plate",
  "mangrove_pressure_plate", "polished_blackstone_pressure_plate",

    // Signs (standing)
  "oak_sign", "birch_sign", "spruce_sign", "jungle_sign", "acacia_sign",
  "dark_oak_sign", "crimson_sign", "warped_sign", "cherry_sign",
  "pale_oak_sign", "mangrove_sign", "bamboo_sign",

    // Floor-mounted controls
  "lever", "stone_button", "oak_button", "birch_button", "spruce_button",
  "jungle_button", "acacia_button", "dark_oak_button", "mangrove_button",
  "cherry_button", "pale_oak_button", "bamboo_button", "crimson_button", "warped_button", "polished_blackstone_button",

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
  "pink_petals", "wildflowers", "fern", "short_grass", "short_dry_grass", "tall_dry_grass", "dead_bush", "wheat",
  "lily_pad",
  "bush", "firefly_bush", "big_dripleaf",
  "crimson_roots", "warped_roots", "nether_sprouts",
  "twisting_vines",
  "crimson_fungus", "warped_fungus",
  "sea_pickle", "nether_wart",
  "brown_mushroom", "red_mushroom",
  "chorus_plant", "chorus_flower",
  ...DIRT_SUPPORTED_FLOWERS, "wither_rose", "cactus_flower",

    // Dry coral plants and floor fans need a sturdy top face, not soil.
  "dead_tube_coral", "dead_brain_coral", "dead_bubble_coral", "dead_fire_coral", "dead_horn_coral",
  "dead_tube_coral_fan", "dead_brain_coral_fan", "dead_bubble_coral_fan", "dead_fire_coral_fan", "dead_horn_coral_fan",

    // Other blocks with placement conditions
  "fire", "soul_fire", "snow", "pointed_dripstone", "lantern", "soul_lantern",
  "amethyst_cluster", "large_amethyst_bud", "medium_amethyst_bud", "small_amethyst_bud",
  "sulfur_spike", "torch", "soul_torch", "copper_torch", "redstone_torch",
  "waxed_copper_lantern", "waxed_exposed_copper_lantern", "waxed_weathered_copper_lantern", "waxed_oxidized_copper_lantern",
  "oxidized_copper_lantern",
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

type FragileSupportRuleValue = {
  validSupportBlocks: readonly string[];
  replacementBlock: string;
};

type FragileSupportRule = Readonly<FragileSupportRuleValue>;

// Callers:
// - src/lib/minecraftVersion.ts
export const FRAGILE_SUPPORT_RULES = new Map<string, FragileSupportRule>([
  ["fire", { validSupportBlocks: ["netherrack"], replacementBlock: "netherrack" }],
  ["soul_fire", { validSupportBlocks: ["soul_sand", "soul_soil"], replacementBlock: "soul_soil" }],
  ["nether_wart", { validSupportBlocks: ["soul_sand"], replacementBlock: "soul_sand" }],
  ["wheat", { validSupportBlocks: ["farmland"], replacementBlock: "farmland" }],
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
  ...DIRT_SUPPORTED_FLOWERS.map(block => [block, { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }] as const),
  ["wither_rose", { validSupportBlocks: [...DIRT_LIKE_SUPPORT_BLOCKS, "netherrack", "soul_sand", "soul_soil"], replacementBlock: "dirt" }],
  ["fern", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["short_grass", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["short_dry_grass", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["tall_dry_grass", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["bush", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["firefly_bush", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["big_dripleaf", { validSupportBlocks: ["clay", "moss_block", "dirt", "grass_block", "podzol", "coarse_dirt", "mycelium", "rooted_dirt", "mud", "muddy_mangrove_roots", "farmland", "big_dripleaf", "big_dripleaf_stem"], replacementBlock: "dirt" }],
  ["open_eyeblossom", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["closed_eyeblossom", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  // Intentionally omitted for simplicity, but perfectly valid supports: [sand, red_sand, and terracotta variants].
  ["dead_bush", { validSupportBlocks: [...DIRT_LIKE_SUPPORT_BLOCKS, "farmland"], replacementBlock: "dirt" }],
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
