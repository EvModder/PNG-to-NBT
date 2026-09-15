/**
 * Public API:
 * - OMITTED_BLOCK_PATTERNS
 * - EXCLUDED_BLOCK_PATTERNS
 * - EXCLUDED_BLOCK_IDS_OBTAINABLE_INTENTIONAL
 * - EXCLUDED_BLOCK_IDS_UNOBTAINABLE
 * - EXCLUDED_BLOCK_IDS
 * - isExcludedBlockPattern()
 *
 * Callers:
 * - scripts/audit-mapcolors.mjs
 * - scripts/build-block-icon-files.mjs
 */
// These blocks are absent even from the excluded-block UI and icon atlas.
// Audited against Java 26.2 Blocks/BlockIds and the blocks' survival/update rules.
// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export const OMITTED_BLOCK_PATTERNS = [
  /_shelf$/, // Block entities with no map-art advantage over their simpler wood alternatives.
  /^(chipped|damaged)_anvil$/,
  /^(bamboo|cactus|sugar_cane)$/, // Uncontrolled growth changes column height and shading.
  /^(kelp|seagrass|frogspawn)$/, // Water-colored alternatives needing extra placement work.
  // Tree starts and unrepresented crops; wheat is offered only as wheat[age=7].
  /_sapling$/,
  /^(mangrove_propagule|azalea|flowering_azalea)$/,
  /^(carrots|potatoes|beetroots|melon_stem|pumpkin_stem|torchflower_crop|sweet_berry_bush)$/,
  /^(water|lava|powder_snow)_cauldron$/,
  // Redundant transparent choices, or live coral needing unmodeled adjacent water.
  /^potted_/,
  /(^|_)candle_cake$/,
  /^(tube|brain|bubble|fire|horn)_coral($|_)/,
  // Side/ceiling support is not generated, including hanging plant body blocks.
  /(^|_)wall_/,
  /_hanging_sign$/,
  /^(ladder|tripwire_hook|vine|cocoa|hanging_roots|pale_hanging_moss|spore_blossom)$/,
  /^(cave_vines|weeping_vines)(_plant)?$/,
  // Additional halves/parts are not generated for these multiblock placements.
  /_bed$/,
  /_door$/,
  /_banner$/, // Redundant wood-colored block entities.
  /^(sunflower|lilac|peony|rose_bush|pitcher_plant|pitcher_crop|large_fern|tall_grass|small_dripleaf|tall_seagrass)$/,
  // Non-standalone plant parts: require another plant block or revert to its head.
  /^attached_(melon|pumpkin)_stem$/,
  /^(kelp_plant|twisting_vines_plant|big_dripleaf_stem)$/,
  // Empty space and internal piston/fluid states, not standalone building materials.
  /^(air|cave_air|void_air|piston_head|moving_piston|bubble_column)$/,
  // Weathering copper only: ores, raw copper and torches do not oxidize.
  /^(exposed|weathered)_(copper|cut_copper|chiseled_copper|lightning_rod)($|_)/,
  /^copper_(block|bars|bulb|chain|grate|lantern|door|trapdoor|chest|golem_statue)$/,
  /^cut_copper($|_)/,
  /^(chiseled_copper|lightning_rod)$/,
];

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export const EXCLUDED_BLOCK_PATTERNS = [
  /(^|_)chiseled_/,
  /(^|_)cracked_/,
  /^bamboo_mosaic($|_)/,
  /_stairs$/,
  /_slab$/,
  /^(?!purple_shulker_box$).*_shulker_box$/,
  /_button$/,
  /_wall$/,
  /_fence$/,
  /_fence_gate$/,
  /_trapdoor$/,
  /_sign$/,
  /_stained_glass_pane$/,
  /lightning_rod$/,
  /copper_bulb$/,
  /copper_chest$/,
  /copper_golem_statue$/,
  /copper_grate$/,
];

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export const EXCLUDED_BLOCK_IDS_OBTAINABLE_INTENTIONAL = new Set([
  "rail", "powered_rail", "detector_rail", "activator_rail", "lever", "torch", "soul_torch", "copper_torch", "redstone_torch", "redstone_wire", "repeater", "comparator",
  "dragon_egg",
  "nether_portal",
  "hopper",
  "cauldron",
  "farmland",
  "dirt_path",
  "shulker_box",
  "end_portal_frame",
  "grindstone",
  "brewing_stand",
  "heavy_core",
  "player_head",
  "zombie_head",
  "skeleton_skull",
  "wither_skeleton_skull",
  "creeper_head",
  "dragon_head",
  "piglin_head",
  "jukebox",
  "note_block",
  "furnace",
  "smoker",
  "blast_furnace",
  "dispenser",
  "dropper",
  "observer",
  "stonecutter",
  "ender_chest",
  "crafter",
  "chest",
  "trapped_chest",
  "barrel",
  "loom",
  "lectern",
  "smithing_table",
  "fletching_table",
  "cartography_table",
  "crafting_table",
  "enchanting_table",
  "respawn_anchor",
  "creaking_heart",
  "gilded_blackstone",
  "calibrated_sculk_sensor",
  "piston",
  "sticky_piston",
  "wheat", // The catalog contains only the fully grown age=7 state.
  "dried_ghast",
  "chorus_plant",
  "chorus_flower", // Exported at age=5; survival placement starts at age=0.
  // Poppy is the default representative for plant-color, one-block flowers.
  "dandelion", "golden_dandelion", "blue_orchid", "allium", "azure_bluet",
  "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy",
  "cornflower", "lily_of_the_valley", "wither_rose", "torchflower",
]);

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export const EXCLUDED_BLOCK_IDS_UNOBTAINABLE = new Set([
  "petrified_oak_slab",
  "barrier",
  "structure_void",
  "light",
  "bedrock",
  "jigsaw",
  "structure_block",
  "test_block",
  "test_instance_block",
  "command_block",
  "chain_command_block",
  "repeating_command_block",
  "end_portal",
  "end_gateway",
  "suspicious_sand",
  "suspicious_gravel",
  "reinforced_deepslate",
  "spawner",
  "budding_amethyst",
  "large_amethyst_bud",
  "medium_amethyst_bud",
  "small_amethyst_bud",
  "trial_spawner",
  "vault",
  "infested_stone",
  "infested_cobblestone",
  "infested_stone_bricks",
  "infested_mossy_stone_bricks",
  "infested_cracked_stone_bricks",
  "infested_chiseled_stone_bricks",
  "infested_deepslate",
]);

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export const EXCLUDED_BLOCK_IDS = new Set([
  ...EXCLUDED_BLOCK_IDS_OBTAINABLE_INTENTIONAL,
  ...EXCLUDED_BLOCK_IDS_UNOBTAINABLE,
]);

// Callers:
// - scripts/audit-mapcolors.mjs
export function isExcludedBlockPattern(blockId) {
  return EXCLUDED_BLOCK_PATTERNS.some(rx => rx.test(blockId));
}
