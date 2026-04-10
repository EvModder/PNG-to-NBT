/**
 * Public API:
 * - EXCLUDED_BLOCKS
 *
 * Callers:
 * - src/components/PanelColorBlockTable.tsx
 * - src/lib/previewImageEdits.ts
 */
import { BASE_COLORS } from "./mapColors";

/* Exclusion documentation:
 * - Pattern-excluded obtainable omissions:
 *   - `.*_stairs`
 *   - `.*_shulker_box`, except `purple_shulker_box`
 *   - `.*_button`
 *   - `.*_wall`
 *   - `.*_fence`
 *   - `.*_fence_gate`
 *   - `.*_trapdoor`
 *   - `.*_door`
 *   - `.*_sign`
 *   - `.*_stained_glass_pane`
 *   - `.*lightning_rod`
 * - Explicit unobtainable/admin-only exclusions:
 *   - `barrier`, `structure_void`, `light`, `bedrock`
 *   - `jigsaw`, `structure_block`
 *   - `command_block`, `chain_command_block`, `repeating_command_block`
 *   - `end_portal`, `reinforced_deepslate`
 *   - `spawner`, `trial_spawner`, `vault`
 *   - `budding_amethyst`
 *   - `infested_*`
 * - Explicit obtainable but intentionally omitted exclusions:
 *   - `dragon_egg`, `nether_portal`, `hopper`, `cauldron`, `farmland`, `dirt_path`, `lily_pad`, `shulker_box`, `end_portal_frame`
 *   - `grindstone`, `brewing_stand`, `heavy_core`
 *   - `player_head`, `zombie_head`, `skeleton_skull`, `wither_skeleton_skull`, `creeper_head`, `dragon_head`, `piglin_head`
 *   - `jukebox`
 *   - `furnace`, `smoker`, `blast_furnace`, `dispenser`, `dropper`, `observer`, `stonecutter`, `ender_chest`, `crafter`
 *   - `chest`, `trapped_chest`, `loom`, `lectern`, `smithing_table`, `fletching_table`, `cartography_table`, `chiseled_bookshelf`
 *   - `enchanting_table`, `respawn_anchor`, `creaking_heart`
 *   - `copper_block`, `cut_copper`, `cut_copper_slab`
 *   - `exposed_copper`, `exposed_cut_copper`, `exposed_cut_copper_slab`
 *   - `weathered_copper`, `weathered_cut_copper`, `weathered_cut_copper_slab`
 *
 * These categories are enforced by `scripts/excluded-blocks.mjs` and audited by
 * `bun run audit:mapcolors`. When adding a new explicit block below, also add it
 * to either the unobtainable or obtainable-intentional audit set there.
 */

// Excluded block options grouped by map color ID.
const EXCLUDED_BY_ID: Partial<Record<number, string[]>> = {
  0: [
    "acacia_button",
    "bamboo_button",
    "barrier",
    "birch_button",
    "black_stained_glass_pane",
    "blue_stained_glass_pane",
    "brown_stained_glass_pane",
    "cherry_button",
    "creeper_head",
    "crimson_button",
    "cyan_stained_glass_pane",
    "dark_oak_button",
    "dragon_head",
    "gray_stained_glass_pane",
    "green_stained_glass_pane",
    "jungle_button",
    "light",
    "light_blue_stained_glass_pane",
    "light_gray_stained_glass_pane",
    "lime_stained_glass_pane",
    "magenta_stained_glass_pane",
    "mangrove_button",
    "nether_portal",
    "oak_button",
    "orange_stained_glass_pane",
    "pale_oak_button",
    "piglin_head",
    "pink_stained_glass_pane",
    "player_head",
    "purple_stained_glass_pane",
    "red_stained_glass_pane",
    "skeleton_skull",
    "spruce_button",
    "stone_button",
    "structure_void",
    "warped_button",
    "white_stained_glass_pane",
    "wither_skeleton_skull",
    "yellow_stained_glass_pane",
    "zombie_head",
  ],
  2: [
    "birch_door",
    "birch_fence",
    "birch_fence_gate",
    "birch_hanging_sign",
    "birch_sign",
    "birch_stairs",
    "birch_trapdoor",
    "birch_wall_hanging_sign",
    "birch_wall_sign",
    "end_stone_brick_stairs",
    "end_stone_brick_wall",
    "sandstone_stairs",
    "sandstone_wall",
    "smooth_sandstone_stairs",
  ],
  6: ["brewing_stand", "grindstone", "heavy_core", "iron_door", "iron_trapdoor"],
  7: ["lily_pad"],
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
    "granite_stairs",
    "granite_wall",
    "jukebox",
    "jungle_door",
    "jungle_fence",
    "jungle_fence_gate",
    "jungle_sign",
    "jungle_stairs",
    "jungle_trapdoor",
    "polished_granite_stairs",
  ],
  11: [
    "andesite_stairs",
    "andesite_wall",
    "bedrock",
    "blast_furnace",
    "cauldron",
    "cobblestone_stairs",
    "cobblestone_wall",
    "crafter",
    "dispenser",
    "dropper",
    "ender_chest",
    "furnace",
    "hopper",
    "mossy_cobblestone_stairs",
    "mossy_cobblestone_wall",
    "observer",
    "mossy_stone_brick_stairs",
    "mossy_stone_brick_wall",
    "polished_andesite_stairs",
    "smoker",
    "spawner",
    "stonecutter",
    "stone_brick_stairs",
    "stone_brick_wall",
    "stone_stairs",
    "trial_spawner",
    "vault",
  ],
  13: [
    "cartography_table",
    "chest",
    "chiseled_bookshelf",
    "fletching_table",
    "lectern",
    "loom",
    "oak_door",
    "oak_fence",
    "oak_fence_gate",
    "oak_sign",
    "oak_stairs",
    "oak_trapdoor",
    "oak_wall_sign",
    "smithing_table",
    "spruce_wall_hanging_sign",
    "trapped_chest",
  ],
  14: [
    "diorite_stairs",
    "diorite_wall",
    "pale_oak_door",
    "pale_oak_fence",
    "pale_oak_fence_gate",
    "pale_oak_sign",
    "pale_oak_stairs",
    "pale_oak_trapdoor",
    "polished_diorite_stairs",
    "quartz_stairs",
    "smooth_quartz_stairs",
  ],
  15: [
    "orange_shulker_box",
    "acacia_door",
    "acacia_fence",
    "acacia_fence_gate",
    "acacia_hanging_sign",
    "acacia_sign",
    "acacia_stairs",
    "acacia_trapdoor",
    "copper_block",
    "cut_copper",
    "cut_copper_slab",
    "acacia_wall_hanging_sign",
    "acacia_wall_sign",
    "cut_copper_stairs",
    "lightning_rod",
    "red_sandstone_stairs",
    "red_sandstone_wall",
    "smooth_red_sandstone_stairs",
    "waxed_cut_copper_stairs",
    "creaking_heart",
  ],
  16: ["magenta_shulker_box", "purpur_stairs"],
  17: ["light_blue_shulker_box"],
  18: ["yellow_shulker_box", "bamboo_hanging_sign", "bamboo_trapdoor", "bamboo_wall_hanging_sign"],
  19: ["lime_shulker_box"],
  20: ["pink_shulker_box"],
  21: ["gray_shulker_box"],
  22: ["light_gray_shulker_box", "jigsaw", "structure_block"],
  23: ["cyan_shulker_box", "prismarine_stairs", "prismarine_wall"],
  24: ["shulker_box", "budding_amethyst", "repeating_command_block"],
  25: ["blue_shulker_box"],
  26: ["brown_shulker_box", "command_block", "dark_oak_door", "dark_oak_fence", "dark_oak_fence_gate", "dark_oak_sign", "dark_oak_stairs", "dark_oak_trapdoor"],
  27: ["green_shulker_box", "end_portal_frame", "chain_command_block"],
  28: ["red_shulker_box", "brick_stairs", "brick_wall", "enchanting_table", "mangrove_door", "mangrove_fence", "mangrove_fence_gate", "mangrove_sign", "mangrove_stairs", "mangrove_trapdoor"],
  29: ["black_shulker_box", "dragon_egg", "end_portal", "respawn_anchor"],
  34: ["spruce_door", "spruce_fence", "spruce_fence_gate", "spruce_sign", "spruce_stairs", "spruce_trapdoor"],
  35: ["nether_brick_fence", "nether_brick_stairs", "nether_brick_wall", "red_nether_brick_stairs", "red_nether_brick_wall"],
  36: ["cherry_door", "cherry_fence", "cherry_fence_gate", "cherry_sign", "cherry_stairs", "cherry_trapdoor"],
  37: ["resin_brick_stairs", "resin_brick_wall"],
  42: ["cherry_hanging_sign", "cherry_wall_hanging_sign"],
  43: ["polished_tuff_stairs", "polished_tuff_wall", "tuff_brick_stairs", "tuff_brick_wall", "tuff_stairs", "tuff_wall"],
  44: ["exposed_copper", "exposed_cut_copper", "exposed_cut_copper_slab", "exposed_copper_trapdoor", "exposed_cut_copper_stairs", "exposed_lightning_rod", "mud_brick_stairs", "mud_brick_wall", "waxed_exposed_cut_copper_stairs"],
  53: ["crimson_door", "crimson_fence", "crimson_fence_gate", "crimson_hanging_sign", "crimson_sign", "crimson_stairs", "crimson_trapdoor", "crimson_wall_hanging_sign"],
  55: ["oxidized_copper_trapdoor", "oxidized_cut_copper_stairs", "oxidized_lightning_rod", "waxed_oxidized_cut_copper_stairs"],
  56: [
    "warped_door",
    "warped_fence",
    "warped_fence_gate",
    "warped_hanging_sign",
    "warped_sign",
    "warped_stairs",
    "warped_trapdoor",
    "warped_wall_hanging_sign",
    "weathered_copper",
    "weathered_cut_copper",
    "weathered_cut_copper_slab",
    "waxed_weathered_cut_copper_stairs",
    "weathered_cut_copper_stairs",
    "weathered_lightning_rod",
  ],
  59: [
    "cobbled_deepslate_stairs",
    "cobbled_deepslate_wall",
    "deepslate_brick_stairs",
    "deepslate_brick_wall",
    "deepslate_tile_stairs",
    "deepslate_tile_wall",
    "infested_deepslate",
    "reinforced_deepslate",
  ],
};

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/lib/previewImageEdits.ts
export const EXCLUDED_BLOCKS: string[][] = BASE_COLORS.map((_, idx) => EXCLUDED_BY_ID[idx] ?? []);
