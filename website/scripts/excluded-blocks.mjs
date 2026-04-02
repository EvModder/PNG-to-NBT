/**
 * Public API:
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
// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export const EXCLUDED_BLOCK_PATTERNS = [
  /_stairs$/,
  /^(?!purple_shulker_box$).*_shulker_box$/,
  /_button$/,
  /_wall$/,
  /_fence$/,
  /_fence_gate$/,
  /_trapdoor$/,
  /_door$/,
  /_sign$/,
  /_stained_glass_pane$/,
  /lightning_rod$/,
];

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export const EXCLUDED_BLOCK_IDS_OBTAINABLE_INTENTIONAL = new Set([
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
  "player_wall_head",
  "zombie_head",
  "zombie_wall_head",
  "skeleton_skull",
  "skeleton_wall_skull",
  "wither_skeleton_skull",
  "wither_skeleton_wall_skull",
  "creeper_head",
  "creeper_wall_head",
  "dragon_head",
  "dragon_wall_head",
  "piglin_head",
  "piglin_wall_head",
  "jukebox",
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
  "loom",
  "lectern",
  "smithing_table",
  "fletching_table",
  "cartography_table",
  "chiseled_bookshelf",
  "enchanting_table",
  "respawn_anchor",
  "creaking_heart",
  "copper_block",
  "cut_copper",
  "cut_copper_slab",
  "exposed_copper",
  "exposed_cut_copper",
  "exposed_cut_copper_slab",
  "weathered_copper",
  "weathered_cut_copper",
  "weathered_cut_copper_slab",
]);

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export const EXCLUDED_BLOCK_IDS_UNOBTAINABLE = new Set([
  "barrier",
  "structure_void",
  "light",
  "bedrock",
  "jigsaw",
  "structure_block",
  "command_block",
  "chain_command_block",
  "repeating_command_block",
  "end_portal",
  "reinforced_deepslate",
  "spawner",
  "budding_amethyst",
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
