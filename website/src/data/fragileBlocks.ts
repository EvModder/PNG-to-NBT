/**
 * Public API:
 * - FRAGILE_SUPPORT_RULES
 * - isFragileBlock()
 * - isFallingBlock()
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/ToolbarFillerSettings.tsx
 * - src/lib/blockSupport.ts
 * - src/lib/fillerRules.ts
 * - src/lib/mixedStepHeights.ts
 * - src/lib/shapeModel.ts
 *
 * Notes:
 * - Placement conditions checked against Minecraft block implementations.
 * - Includes placement-time support (e.g. trapdoors), even without a continued survival check.
 * - Catalog exclusion does not remove placement requirements for custom block inputs.
 * - On version updates, run audit:block-support; see scripts/block-support-review.json.
 */
const DIRT_SUPPORTED_FLOWERS = [
  "poppy", "dandelion", "golden_dandelion", "blue_orchid", "allium", "azure_bluet",
  "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy",
  "cornflower", "lily_of_the_valley", "torchflower",
] as const;

const SAPLINGS = [
  "oak_sapling", "spruce_sapling", "birch_sapling", "jungle_sapling", "acacia_sapling",
  "dark_oak_sapling", "cherry_sapling", "pale_oak_sapling", "poplar_sapling",
] as const;

const FARMLAND_CROPS = ["wheat", "carrots", "potatoes", "beetroots", "torchflower_crop"] as const;

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
  "cherry_pressure_plate", "pale_oak_pressure_plate", "poplar_pressure_plate", "bamboo_pressure_plate",
  "light_weighted_pressure_plate", "heavy_weighted_pressure_plate",
  "mangrove_pressure_plate", "polished_blackstone_pressure_plate",

    // Signs (standing)
  "oak_sign", "birch_sign", "spruce_sign", "jungle_sign", "acacia_sign",
  "dark_oak_sign", "crimson_sign", "warped_sign", "cherry_sign",
  "pale_oak_sign", "poplar_sign", "mangrove_sign", "bamboo_sign",

    // Floor-mounted controls
  "lever", "stone_button", "oak_button", "birch_button", "spruce_button",
  "jungle_button", "acacia_button", "dark_oak_button", "mangrove_button",
  "cherry_button", "pale_oak_button", "poplar_button", "bamboo_button", "crimson_button", "warped_button", "polished_blackstone_button",

    // Trapdoors
  "oak_trapdoor", "birch_trapdoor", "spruce_trapdoor", "jungle_trapdoor",
  "acacia_trapdoor", "dark_oak_trapdoor", "crimson_trapdoor", "warped_trapdoor",
  "cherry_trapdoor", "pale_oak_trapdoor", "poplar_trapdoor", "mangrove_trapdoor", "iron_trapdoor",

    // Candles
  "candle", "white_candle", "orange_candle", "magenta_candle",
  "light_blue_candle", "yellow_candle", "lime_candle", "pink_candle",
  "gray_candle", "light_gray_candle", "cyan_candle", "purple_candle",
  "blue_candle", "brown_candle", "green_candle", "red_candle", "black_candle",

    // Plants / vegetation with placement conditions
  "pink_petals", "wildflowers", "fern", "short_grass", "short_dry_grass", "tall_dry_grass", "dead_bush", ...FARMLAND_CROPS,
  "lily_pad", "azalea", "flowering_azalea", "sweet_berry_bush",
  ...SAPLINGS, "mangrove_propagule", "bamboo_sapling",
  "bush", "firefly_bush", "red_shrub", "big_dripleaf",
  "crimson_roots", "warped_roots", "nether_sprouts",
  "twisting_vines",
  "crimson_fungus", "warped_fungus",
  "sea_pickle", "nether_wart",
  "brown_mushroom", "red_mushroom",
  "chorus_plant", "chorus_flower",
  ...DIRT_SUPPORTED_FLOWERS, "wither_rose", "cactus_flower",

    // Dry coral plants and floor fans need a sturdy top face, not soil.
    // Living variants also need adjacent water; a waterlogged support can supply it.
    // TODO: Generate hydration separately from attachment, preserving assumed platforms.
  "dead_tube_coral", "dead_brain_coral", "dead_bubble_coral", "dead_fire_coral", "dead_horn_coral",
  "dead_tube_coral_fan", "dead_brain_coral_fan", "dead_bubble_coral_fan", "dead_fire_coral_fan", "dead_horn_coral_fan",
  "tube_coral", "brain_coral", "bubble_coral", "fire_coral", "horn_coral",
  "tube_coral_fan", "brain_coral_fan", "bubble_coral_fan", "fire_coral_fan", "horn_coral_fan",

    // Other blocks with placement conditions
  "fire", "soul_fire", "snow", "pointed_dripstone", "lantern", "soul_lantern",
  "amethyst_cluster", "large_amethyst_bud", "medium_amethyst_bud", "small_amethyst_bud",
  "ice_crystal", "icicle",
  "sulfur_spike", "torch", "soul_torch", "copper_torch", "redstone_torch",
  "waxed_copper_lantern", "waxed_exposed_copper_lantern", "waxed_weathered_copper_lantern", "waxed_oxidized_copper_lantern",
  "copper_lantern", "exposed_copper_lantern", "weathered_copper_lantern", "oxidized_copper_lantern",
  "bell", "turtle_egg", "leaf_litter", "cake",
  "rail", "powered_rail", "detector_rail", "activator_rail", "repeater", "comparator", "redstone_wire",
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
  "farmland",
] as const;

const DYE_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;

const DRY_VEGETATION_SUPPORT_BLOCKS = [
  ...DIRT_LIKE_SUPPORT_BLOCKS, "sand", "red_sand", "suspicious_sand", "terracotta",
  ...DYE_COLORS.map(color => `${color}_terracotta`),
];

const NETHER_PLANT_SUPPORT_BLOCKS = [
  ...DIRT_LIKE_SUPPORT_BLOCKS,
  "crimson_nylium",
  "warped_nylium",
  "soul_soil",
] as const;
// The current mushroom rule needs center support; farmland no longer qualifies.
const MUSHROOM_SUPPORT_BLOCKS = NETHER_PLANT_SUPPORT_BLOCKS.filter(block => block !== "farmland");

type FragileSupportRuleValue = {
  validSupportBlocks: readonly string[];
  replacementBlock: string;
};

type FragileSupportRule = Readonly<FragileSupportRuleValue>;

// Callers:
// - src/Index.tsx
// - src/lib/blockSupport.ts
// - src/lib/mixedStepHeights.ts
// - src/lib/shapeModel.ts
// Modern substrate rules are used for every target version.
export const FRAGILE_SUPPORT_RULES = new Map<string, FragileSupportRule>([
  ["fire", { validSupportBlocks: ["netherrack"], replacementBlock: "netherrack" }],
  ["soul_fire", { validSupportBlocks: ["soul_sand", "soul_soil"], replacementBlock: "soul_soil" }],
  ["nether_wart", { validSupportBlocks: ["soul_sand"], replacementBlock: "soul_sand" }],
  ...FARMLAND_CROPS.map(block => [block, { validSupportBlocks: ["farmland"], replacementBlock: "farmland" }] as const),
  ["azalea", { validSupportBlocks: [...DIRT_LIKE_SUPPORT_BLOCKS, "clay"], replacementBlock: "dirt" }],
  ["flowering_azalea", { validSupportBlocks: [...DIRT_LIKE_SUPPORT_BLOCKS, "clay"], replacementBlock: "dirt" }],
  ["sweet_berry_bush", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ...SAPLINGS.map(block => [block, { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }] as const),
  ["mangrove_propagule", { validSupportBlocks: [...DIRT_LIKE_SUPPORT_BLOCKS, "clay"], replacementBlock: "dirt" }],
  ["bamboo_sapling", { validSupportBlocks: [...DIRT_LIKE_SUPPORT_BLOCKS.filter(block => block !== "farmland"), "sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel", "bamboo", "bamboo_sapling"], replacementBlock: "dirt" }],
  // Low-light-capable substrates only. This intentionally does not try to model every possible
  // full-top support block mushrooms can use at low light.
  ["brown_mushroom", { validSupportBlocks: MUSHROOM_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["red_mushroom", { validSupportBlocks: MUSHROOM_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["crimson_fungus", { validSupportBlocks: NETHER_PLANT_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["crimson_roots", { validSupportBlocks: NETHER_PLANT_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["warped_fungus", { validSupportBlocks: NETHER_PLANT_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["warped_roots", { validSupportBlocks: NETHER_PLANT_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["nether_sprouts", { validSupportBlocks: NETHER_PLANT_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  // Waterlogged supports and mushroom support faces are checked by blockSupport.
  ["lily_pad", { validSupportBlocks: ["water", "ice", "frosted_ice"], replacementBlock: "ice" }],
  ["pink_petals", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["wildflowers", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ...DIRT_SUPPORTED_FLOWERS.map(block => [block, { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }] as const),
  ["wither_rose", { validSupportBlocks: [...DIRT_LIKE_SUPPORT_BLOCKS, "netherrack", "soul_sand", "soul_soil"], replacementBlock: "dirt" }],
  ["fern", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["short_grass", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["short_dry_grass", { validSupportBlocks: DRY_VEGETATION_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["tall_dry_grass", { validSupportBlocks: DRY_VEGETATION_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["bush", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["red_shrub", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["firefly_bush", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["big_dripleaf", { validSupportBlocks: ["clay", "moss_block", "dirt", "grass_block", "podzol", "coarse_dirt", "mycelium", "rooted_dirt", "mud", "muddy_mangrove_roots", "farmland", "big_dripleaf", "big_dripleaf_stem"], replacementBlock: "dirt" }],
  ["open_eyeblossom", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["closed_eyeblossom", { validSupportBlocks: DIRT_LIKE_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["dead_bush", { validSupportBlocks: DRY_VEGETATION_SUPPORT_BLOCKS, replacementBlock: "dirt" }],
  ["chorus_flower", { validSupportBlocks: ["end_stone", "chorus_plant"], replacementBlock: "end_stone" }],
  ["chorus_plant", { validSupportBlocks: ["end_stone", "chorus_plant"], replacementBlock: "end_stone" }],
]);

const FALLING_BLOCKS = new Set([
  "sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel",
  "anvil", "chipped_anvil", "damaged_anvil", "dragon_egg",
]);

function getBaseBlockId(blockId: string): string {
  blockId = blockId.trim();
  const start = blockId.startsWith("minecraft:") ? 10 : 0;
  const end = blockId.indexOf("[");
  return blockId.slice(start, end < 0 ? undefined : end);
}

// Callers:
// - src/lib/blockSupport.ts
export function isFallingBlock(blockId: string): boolean {
  const id = getBaseBlockId(blockId);
  return FALLING_BLOCKS.has(id) || id.endsWith("_concrete_powder");
}

/**
 * Check if a block name (possibly with properties like "[south=true]") is fragile.
 * Strips the property suffix before checking.
 */
// Callers:
// - src/Index.tsx
// - src/components/ToolbarFillerSettings.tsx
// - src/lib/blockSupport.ts
// - src/lib/fillerRules.ts
// - src/lib/mixedStepHeights.ts
// - src/lib/shapeModel.ts
export function isFragileBlock(blockId: string): boolean {
  const id = getBaseBlockId(blockId);
  return FRAGILE_BLOCKS.has(id) || FALLING_BLOCKS.has(id) || id.endsWith("_concrete_powder")
    || id === "candle_cake" || id.endsWith("_candle_cake") || id.endsWith("_banner") && !id.endsWith("_wall_banner");
}
