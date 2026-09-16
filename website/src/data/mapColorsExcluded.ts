/**
 * Public API:
 * - EXCLUDED_BLOCKS
 *
 * Callers:
 * - src/lib/codecPreset.ts
 * - src/lib/minecraftVersion.ts
 */
import { BASE_COLORS } from "./mapColors";

/* Exclusion documentation:
 * - Pattern-excluded obtainable omissions:
 *   - Chiseled and cracked variants (including waxed/oxidized copper).
 *   - `.*_stairs`, `.*_slab`
 *   - `.*_shulker_box`, except `purple_shulker_box`
 *   - `.*_button`
 *   - `.*_wall`
 *   - `.*_fence`
 *   - `.*_fence_gate`
 *   - `.*_trapdoor`
 *   - Standing signs only; wall/hanging signs are omitted entirely because their support is not generated.
 *   - `.*_stained_glass_pane`
 *   - `.*lightning_rod`
 * - Explicit unobtainable/admin-only exclusions:
 *   - `barrier`, `structure_void`, `light`, `bedrock`
 *   - `jigsaw`, `structure_block`
 *   - `test_block`, `test_instance_block`, `end_gateway`, `suspicious_sand`, `suspicious_gravel`
 *   - `command_block`, `chain_command_block`, `repeating_command_block`
 *   - `end_portal`, `reinforced_deepslate`
 *   - `spawner`, `trial_spawner`, `vault`
 *   - `budding_amethyst`, and small/medium/large amethyst buds
 *   - `infested_*`
 * - Explicit obtainable but intentionally omitted exclusions:
 *   - `dragon_egg`, `nether_portal`, `hopper`, `cauldron`, `farmland`, `dirt_path`, `lily_pad`, `shulker_box`, `end_portal_frame`
 *   - `grindstone`, `brewing_stand`, `heavy_core`
 *   - `player_head`, `zombie_head`, `skeleton_skull`, `wither_skeleton_skull`, `creeper_head`, `dragon_head`, `piglin_head`
 *   - `jukebox`
 *   - `furnace`, `smoker`, `blast_furnace`, `dispenser`, `dropper`, `observer`, `stonecutter`, `ender_chest`, `crafter`
 *   - `chest`, `trapped_chest`, `loom`, `lectern`, `smithing_table`, `fletching_table`, `cartography_table`
 *   - `enchanting_table`, `respawn_anchor`, `creaking_heart`
 *   - Copper bulbs/chests/statues, gilded blackstone, calibrated sculk sensors, and upward pistons.
 *   - Conventional one-block flowers other than poppy (all share plant map color).
 *   - Fully grown wheat (`age=7` only), and dried ghast.
 *   - Chorus plants and dead chorus flowers (`age=5`; survival placement starts at age=0).
 *   - Rails, lever, torches, redstone wire, repeaters and comparators (require support).
 * - Doors, banners, potted plants, candle-cakes, and living coral are omitted entirely.
 * - Saplings, azaleas, mangrove propagules, other unrepresented crops, and filled cauldrons are omitted entirely.
 * - Damaged anvils, bamboo, cactus, sugar cane, kelp, seagrass, and frogspawn are omitted entirely.
 * - Shelves are omitted entirely; ordinary wood blocks provide the same map colors.
 * - Weathering copper is omitted entirely unless waxed or fully oxidized; ores, raw copper and torches do not oxidize.
 *
 * These categories are enforced by `scripts/excluded-blocks.mjs` and audited by
 * `bun run audit:mapcolors`. When adding a new explicit block below, also add it
 * to a matching pattern or the unobtainable/obtainable-intentional audit set there.
 */

// Excluded block options grouped by map color ID.
// Shared preset URLs use alphabetical indices separately from the normal lists,
// filtered by Minecraft DataVersion. Register future blocks in BLOCK_INTRODUCTIONS.
// Display reordering is safe; additions without a version cutoff, removals, renames
// and moves between color/visibility lists can still break affected links.
const EXCLUDED_BY_ID: Partial<Record<number, string[]>> = {
  0: [
    "rail", "powered_rail", "detector_rail", "activator_rail", "lever[face=floor]",
    "torch", "soul_torch", "copper_torch", "redstone_torch", "redstone_wire", "repeater", "comparator",
    "black_stained_glass_pane", "blue_stained_glass_pane", "brown_stained_glass_pane", "cyan_stained_glass_pane", "gray_stained_glass_pane", "green_stained_glass_pane", "light_blue_stained_glass_pane", "light_gray_stained_glass_pane",
    "lime_stained_glass_pane", "magenta_stained_glass_pane", "orange_stained_glass_pane", "pink_stained_glass_pane", "purple_stained_glass_pane", "red_stained_glass_pane", "white_stained_glass_pane", "yellow_stained_glass_pane",
    "acacia_button[face=floor]", "bamboo_button[face=floor]", "birch_button[face=floor]", "cherry_button[face=floor]", "crimson_button[face=floor]", "dark_oak_button[face=floor]", "jungle_button[face=floor]",
    "mangrove_button[face=floor]", "oak_button[face=floor]", "pale_oak_button[face=floor]", "spruce_button[face=floor]", "warped_button[face=floor]", "stone_button[face=floor]", "polished_blackstone_button[face=floor]",
    "creeper_head", "dragon_head", "piglin_head", "player_head", "skeleton_skull", "wither_skeleton_skull", "zombie_head",
    "barrier", "light", "nether_portal", "structure_void", "test_instance_block",
  ],
  2: [
    "suspicious_sand",
    "birch_fence",
    "birch_fence_gate",
    "birch_sign",
    "birch_slab", "birch_stairs",
    "birch_trapdoor",
    "end_stone_brick_slab", "end_stone_brick_stairs",
    "end_stone_brick_wall",
    "chiseled_sandstone", "sandstone_slab", "cut_sandstone_slab", "sandstone_stairs",
    "sandstone_wall",
    "smooth_sandstone_slab", "smooth_sandstone_stairs",
  ],
  6: ["brewing_stand", "grindstone[face=floor]", "heavy_core", "iron_trapdoor"],
  7: ["dandelion", "golden_dandelion", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley", "wither_rose", "torchflower", "lily_pad"],
  8: ["white_shulker_box"],
  9: [
    "infested_chiseled_stone_bricks",
    "infested_cobblestone",
    "infested_cracked_stone_bricks",
    "infested_mossy_stone_bricks",
    "infested_stone",
    "infested_stone_bricks",
  ],
  10: [
    "dirt_path",
    "farmland",
    "granite_slab", "granite_stairs",
    "granite_wall",
    "polished_granite_slab", "polished_granite_stairs",
    "jukebox",
    "jungle_fence",
    "jungle_fence_gate",
    "jungle_sign",
    "jungle_slab", "jungle_stairs",
    "jungle_trapdoor",
  ],
  11: [
    "andesite_slab", "andesite_stairs",
    "andesite_wall",
    "polished_andesite_slab", "polished_andesite_stairs",
    "bedrock",
    "cauldron",
    "cobblestone_slab", "cobblestone_stairs",
    "cobblestone_wall",
    "mossy_cobblestone_slab", "mossy_cobblestone_stairs",
    "mossy_cobblestone_wall",
    "crafter",
    "dispenser",
    "dropper",
    "ender_chest",
    "furnace",
    "blast_furnace",
    "smoker",
    "hopper",
    "piston[facing=up]", "sticky_piston[facing=up]", "observer",
    "stonecutter", "suspicious_gravel",
    "cracked_stone_bricks", "chiseled_stone_bricks", "stone_brick_slab", "stone_brick_stairs",
    "stone_brick_wall",
    "mossy_stone_brick_slab", "mossy_stone_brick_stairs",
    "mossy_stone_brick_wall",
    "stone_slab", "smooth_stone_slab", "stone_stairs",
    "spawner", "trial_spawner",
    "vault",
  ],
  13: [
    "crafting_table",
    "cartography_table",
    "fletching_table",
    "smithing_table",
    "loom",
    "lectern",
    "chiseled_bookshelf",
    "chest",
    "trapped_chest",
    "barrel",
    "note_block",
    "oak_fence",
    "oak_fence_gate",
    "oak_sign",
    "oak_slab",
    "petrified_oak_slab", "oak_stairs",
    "oak_trapdoor",
  ],
  14: [
    "diorite_slab", "diorite_stairs",
    "diorite_wall",
    "polished_diorite_slab", "polished_diorite_stairs",
    "pale_oak_fence",
    "pale_oak_fence_gate",
    "pale_oak_sign",
    "pale_oak_slab", "pale_oak_stairs",
    "pale_oak_trapdoor",
    "chiseled_quartz_block", "quartz_slab", "quartz_stairs",
    "smooth_quartz_slab", "smooth_quartz_stairs",
  ],
  15: [
    "orange_shulker_box",
    "acacia_fence",
    "acacia_fence_gate",
    "acacia_sign",
    "acacia_slab", "acacia_stairs",
    "acacia_trapdoor",
    "chiseled_red_sandstone", "red_sandstone_slab", "cut_red_sandstone_slab", "red_sandstone_stairs",
    "red_sandstone_wall",
    "smooth_red_sandstone_slab", "smooth_red_sandstone_stairs",
    "creaking_heart",
    "waxed_chiseled_copper", "waxed_cut_copper_slab", "waxed_cut_copper_stairs",
    "waxed_copper_grate",
    "waxed_copper_trapdoor", "waxed_copper_bulb",
    "waxed_lightning_rod",
    "waxed_copper_chest",
    "waxed_copper_golem_statue",
  ],
  16: ["magenta_shulker_box", "purpur_slab", "purpur_stairs"],
  17: ["light_blue_shulker_box"],
  18: ["sulfur_slab", "sulfur_stairs", "sulfur_wall", "polished_sulfur_slab", "polished_sulfur_stairs", "polished_sulfur_wall", "sulfur_brick_slab", "sulfur_brick_stairs", "sulfur_brick_wall", "chiseled_sulfur", "yellow_shulker_box", "bamboo_fence", "bamboo_fence_gate", "bamboo_sign", "bamboo_slab", "bamboo_stairs", "bamboo_mosaic", "bamboo_mosaic_slab", "bamboo_mosaic_stairs", "bamboo_trapdoor", "wheat[age=7]"],
  19: ["lime_shulker_box"],
  20: ["pink_shulker_box"],
  21: ["dried_ghast", "gray_shulker_box"],
  22: ["light_gray_shulker_box", "jigsaw", "structure_block", "test_block"],
  23: ["calibrated_sculk_sensor", "cyan_shulker_box", "prismarine_slab", "prismarine_stairs", "prismarine_wall"],
  24: ["large_amethyst_bud", "medium_amethyst_bud", "small_amethyst_bud", "budding_amethyst", "chorus_plant", "chorus_flower[age=5]", "shulker_box", "repeating_command_block"],
  25: ["blue_shulker_box"],
  26: ["brown_shulker_box", "command_block", "dark_oak_fence", "dark_oak_fence_gate", "dark_oak_sign", "dark_oak_slab", "dark_oak_stairs", "dark_oak_trapdoor"],
  27: ["green_shulker_box", "end_portal_frame", "chain_command_block"],
  28: ["cinnabar_slab", "cinnabar_stairs", "cinnabar_wall", "polished_cinnabar_slab", "polished_cinnabar_stairs", "polished_cinnabar_wall", "cinnabar_brick_slab", "cinnabar_brick_stairs", "cinnabar_brick_wall", "chiseled_cinnabar", "red_shulker_box", "brick_slab", "brick_stairs", "brick_wall", "enchanting_table", "mangrove_fence", "mangrove_fence_gate", "mangrove_sign", "mangrove_slab", "mangrove_stairs", "mangrove_trapdoor"],
  29: ["gilded_blackstone", "blackstone_slab", "blackstone_stairs", "blackstone_wall", "polished_blackstone_slab", "polished_blackstone_stairs", "polished_blackstone_wall", "chiseled_polished_blackstone", "cracked_polished_blackstone_bricks", "polished_blackstone_brick_slab", "polished_blackstone_brick_stairs", "polished_blackstone_brick_wall", "black_shulker_box", "dragon_egg", "end_portal", "end_gateway", "respawn_anchor"],
  31: ["prismarine_brick_slab", "prismarine_brick_stairs", "dark_prismarine_slab", "dark_prismarine_stairs"],
  34: ["spruce_fence", "spruce_fence_gate", "spruce_sign", "spruce_slab", "spruce_stairs", "spruce_trapdoor"],
  35: ["cracked_nether_bricks", "chiseled_nether_bricks", "nether_brick_fence", "nether_brick_slab", "nether_brick_stairs", "nether_brick_wall", "red_nether_brick_slab", "red_nether_brick_stairs", "red_nether_brick_wall"],
  36: ["cherry_fence", "cherry_fence_gate", "cherry_sign", "cherry_slab", "cherry_stairs", "cherry_trapdoor"],
  37: ["chiseled_resin_bricks", "resin_brick_slab", "resin_brick_stairs", "resin_brick_wall"],
  43: ["polished_tuff_slab", "polished_tuff_stairs", "polished_tuff_wall", "chiseled_tuff_bricks", "tuff_brick_slab", "tuff_brick_stairs", "tuff_brick_wall", "chiseled_tuff", "tuff_slab", "tuff_stairs", "tuff_wall"],
  44: ["mud_brick_slab", "mud_brick_stairs", "mud_brick_wall", "waxed_exposed_chiseled_copper", "waxed_exposed_cut_copper_slab", "waxed_exposed_cut_copper_stairs", "waxed_exposed_copper_grate", "waxed_exposed_copper_trapdoor", "waxed_exposed_copper_bulb", "waxed_exposed_lightning_rod", "waxed_exposed_copper_chest", "waxed_exposed_copper_golem_statue"],
  53: ["crimson_fence", "crimson_fence_gate", "crimson_sign", "crimson_slab", "crimson_stairs", "crimson_trapdoor"],
  55: ["waxed_oxidized_chiseled_copper", "waxed_oxidized_cut_copper_slab", "waxed_oxidized_cut_copper_stairs", "waxed_oxidized_copper_grate", "waxed_oxidized_copper_trapdoor", "waxed_oxidized_copper_bulb", "waxed_oxidized_lightning_rod", "waxed_oxidized_copper_chest", "waxed_oxidized_copper_golem_statue", "oxidized_chiseled_copper", "oxidized_cut_copper_slab", "oxidized_cut_copper_stairs", "oxidized_copper_grate", "oxidized_copper_trapdoor", "oxidized_copper_bulb", "oxidized_lightning_rod", "oxidized_copper_chest", "oxidized_copper_golem_statue"],
  56: [
    "warped_fence",
    "warped_fence_gate",
    "warped_sign",
    "warped_slab", "warped_stairs",
    "warped_trapdoor",
    "waxed_weathered_chiseled_copper", "waxed_weathered_cut_copper_slab", "waxed_weathered_cut_copper_stairs",
    "waxed_weathered_copper_grate",
    "waxed_weathered_copper_trapdoor", "waxed_weathered_copper_bulb",
    "waxed_weathered_lightning_rod",
    "waxed_weathered_copper_chest",
    "waxed_weathered_copper_golem_statue",
  ],
  59: [
    "chiseled_deepslate", "cobbled_deepslate_slab", "cobbled_deepslate_stairs",
    "cobbled_deepslate_wall", "polished_deepslate_slab", "polished_deepslate_stairs", "polished_deepslate_wall",
    "cracked_deepslate_bricks", "deepslate_brick_slab", "deepslate_brick_stairs",
    "deepslate_brick_wall",
    "cracked_deepslate_tiles", "deepslate_tile_slab", "deepslate_tile_stairs",
    "deepslate_tile_wall",
    "infested_deepslate",
    "reinforced_deepslate",
  ],
};

// Callers:
// - src/lib/codecPreset.ts
// - src/lib/minecraftVersion.ts
export const EXCLUDED_BLOCKS: string[][] = BASE_COLORS.map((_, idx) => EXCLUDED_BY_ID[idx] ?? []);
