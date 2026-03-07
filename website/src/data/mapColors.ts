// Minecraft map color data
// Base RGB values are the "light" shade (multiplier 255/255 = full brightness)
// Other shades: dark=180/255, flat=220/255, darkest=135/255
//
// Intentional omission policy (enforced/audited by `npm run audit:mapcolors`):
// - Excluded name patterns:
//   - `.*_stairs`
//   - `.*_shulker_box`
//   - `.*_button`
//   - `.*_wall`
//   - `.*_fence`
// - Explicitly excluded block IDs (unobtainable):
//   - `command_block`, `chain_command_block`, `repeating_command_block`
//   - `jigsaw`, `structure_block`
//   - `end_portal`, `reinforced_deepslate`, `spawner`
//   - `barrier`, `structure_void`, `light`
//   - `budding_amethyst`
// - Explicitly excluded block IDs (obtainable but intentionally omitted):
//   - `dragon_egg`
//   - all head/skull variants (for example `player_head`, `skeleton_skull`)
// - State-specific entries are used where one block ID can map to multiple map colors
//   depending on state (for example, `*_log[axis=x]` vs `*_log`).

export const SHADE_MULTIPLIERS = [180, 220, 255, 135] as const;
// Index 0=dark, 1=flat, 2=light, 3=darkest (table-only; not obtainable)
const OBTAINABLE_SHADE_INDICES = [0, 1, 2] as const;

export interface BaseColor {
  name: string;
  r: number;
  g: number;
  b: number;
  blocks: string[]; // possible block IDs (without minecraft: prefix)
}

// WATER is the only base color with special logic; current hardcoding has it stored at index 12
export const WATER_BASE_INDEX = 12;

// 62 base colors (index 0 = transparent/NONE)
export const BASE_COLORS: BaseColor[] = [
  { name: "NONE", r: 0, g: 0, b: 0, blocks: ["glass", "glass_pane", "chain", "end_rod", "ladder", "rail", "powered_rail", "detector_rail", "activator_rail", "lever", "torch", "wall_torch", "soul_torch", "soul_wall_torch", "redstone_wire", "repeater", "comparator", "tripwire_hook", "tripwire", "flower_pot", "cake", "white_stained_glass_pane", "orange_stained_glass_pane", "magenta_stained_glass_pane", "light_blue_stained_glass_pane", "yellow_stained_glass_pane", "lime_stained_glass_pane", "pink_stained_glass_pane", "gray_stained_glass_pane", "light_gray_stained_glass_pane", "cyan_stained_glass_pane", "purple_stained_glass_pane", "blue_stained_glass_pane", "brown_stained_glass_pane", "green_stained_glass_pane", "red_stained_glass_pane", "black_stained_glass_pane", "nether_portal"] },
  { name: "GRASS", r: 127, g: 178, b: 56, blocks: ["grass_block", "slime_block"] },
  { name: "SAND", r: 247, g: 233, b: 163, blocks: ["sand", "suspicious_sand", "sandstone", "sandstone_slab", "cut_sandstone", "cut_sandstone_slab", "smooth_sandstone", "smooth_sandstone_slab", "chiseled_sandstone", "ochre_froglight", "glowstone", "end_stone", "end_stone_bricks", "end_stone_brick_slab", "bone_block", "scaffolding", "candle", "birch_log", "birch_stripped_log", "birch_wood", "birch_stripped_wood", "birch_planks", "birch_slab", "birch_pressure_plate", "birch_trapdoor", "birch_sign", "turtle_egg", "birch_fence_gate", "birch_door"] },
  { name: "WOOL", r: 199, g: 199, b: 199, blocks: ["mushroom_stem", "cobweb", "white_candle"] },
  { name: "FIRE", r: 255, g: 0, b: 0, blocks: ["redstone_block", "tnt", "lava", "fire"] },
  { name: "ICE", r: 160, g: 160, b: 255, blocks: ["ice", "packed_ice", "blue_ice", "frosted_ice"] },
  { name: "METAL", r: 167, g: 167, b: 167, blocks: ["iron_block", "iron_trapdoor", "iron_bars", "heavy_weighted_pressure_plate", "lantern", "grindstone", "lodestone", "heavy_core", "pale_oak_leaves", "closed_eyeblossom", "iron_door", "anvil", "brewing_stand"] },
  { name: "PLANT", r: 0, g: 124, b: 0, blocks: ["oak_leaves", "spruce_leaves", "birch_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "azalea_leaves", "flowering_azalea_leaves", "cactus", "vines", "sugar_cane", "fern", "short_grass", "tall_grass", "lily_pad", "pink_petals", "wildflowers"] },
  { name: "SNOW", r: 255, g: 255, b: 255, blocks: ["white_wool", "white_carpet", "white_concrete", "white_concrete_powder", "white_glazed_terracotta", "white_stained_glass", "snow_block", "snow", "powder_snow"] },
  { name: "CLAY", r: 164, g: 168, b: 184, blocks: ["clay"] },
  { name: "DIRT", r: 151, g: 109, b: 77, blocks: ["dirt", "coarse_dirt", "granite", "granite_slab", "polished_granite", "polished_granite_slab", "farmland", "packed_mud", "dirt_path", "jungle_log[axis=x]", "jungle_stripped_log", "jungle_wood", "jungle_stripped_wood", "jungle_planks", "jungle_slab", "jungle_pressure_plate", "jungle_trapdoor", "jungle_sign", "jukebox", "brown_mushroom_block", "rooted_dirt", "hanging_roots", "jungle_fence_gate", "jungle_door"] },
  { name: "STONE", r: 112, g: 112, b: 112, blocks: ["cobblestone", "cobblestone_slab", "mossy_cobblestone", "mossy_cobblestone_slab", "stone", "stone_slab", "stone_pressure_plate", "smooth_stone", "smooth_stone_slab", "stone_bricks", "stone_brick_slab", "mossy_stone_bricks", "mossy_stone_brick_slab", "cracked_stone_bricks", "chiseled_stone_bricks", "andesite", "andesite_slab", "polished_andesite", "polished_andesite_slab", "gravel", "furnace", "smoker", "blast_furnace", "dispenser", "dropper", "observer", "stonecutter", "ender_chest", "coal_ore", "copper_ore", "iron_ore", "gold_ore", "redstone_ore", "lapis_lazuli_ore", "emerald_ore", "diamond_ore", "crafter", "pale_oak_log", "pale_oak_wood", "hopper", "cauldron", "bedrock"] },
  { name: "WATER", r: 64, g: 64, b: 255, blocks: ["water", "oak_leaves[waterlogged=true]", "spruce_leaves[waterlogged=true]", "birch_leaves[waterlogged=true]", "jungle_leaves[waterlogged=true]", "acacia_leaves[waterlogged=true]", "dark_oak_leaves[waterlogged=true]", "cherry_leaves[waterlogged=true]", "pale_oak_leaves[waterlogged=true]", "mangrove_leaves[waterlogged=true]", "azalea_leaves[waterlogged=true]", "flowering_azalea_leaves[waterlogged=true]"] },
  { name: "WOOD", r: 143, g: 119, b: 72, blocks: ["oak_planks", "oak_slab", "oak_pressure_plate", "oak_trapdoor", "oak_sign", "crafting_table", "bookshelf", "note_block", "chest", "trapped_chest", "daylight_detector", "loom", "composter", "lectern", "smithing_table", "fletching_table", "beehive", "oak_wood", "oak_stripped_wood", "oak_stripped_log", "barrel", "cartography_table", "chiseled_bookshelf", "petrified_oak_slab", "bamboo_sapling", "dead_bush", "oak_fence_gate", "oak_door"] },
  { name: "QUARTZ", r: 255, g: 252, b: 245, blocks: ["quartz_block", "smooth_quartz", "smooth_quartz_slab", "chiseled_quartz_block", "quartz_pillar", "quartz_slab", "diorite", "diorite_slab", "polished_diorite", "polished_diorite_slab", "sea_lantern", "target", "pale_oak_planks", "pale_oak_slab", "pale_oak_pressure_plate", "pale_oak_trapdoor", "pale_oak_sign", "pale_oak_stripped_log", "pale_oak_stripped_wood", "pale_oak_fence_gate", "pale_oak_door"] },
  { name: "COLOR_ORANGE", r: 216, g: 127, b: 51, blocks: ["orange_wool", "orange_carpet", "orange_concrete", "orange_concrete_powder", "orange_glazed_terracotta", "orange_stained_glass", "orange_candle", "acacia_log", "acacia_stripped_log", "acacia_stripped_wood", "acacia_planks", "acacia_slab", "acacia_pressure_plate", "acacia_trapdoor", "acacia_sign", "pumpkin", "carved_pumpkin", "jack_o_lantern", "terracotta", "red_sand", "red_sandstone", "red_sandstone_slab", "honey_block", "honeycomb_block", "lightning_rod", "waxed_copper_block", "waxed_cut_copper", "waxed_cut_copper_slab", "waxed_copper_trapdoor", "copper_block", "cut_copper", "cut_copper_slab", "copper_trapdoor", "raw_copper_block", "cut_red_sandstone", "cut_red_sandstone_slab", "chiseled_red_sandstone", "smooth_red_sandstone", "smooth_red_sandstone_slab", "creaking_heart", "open_eyeblossom", "acacia_fence_gate", "acacia_door"] },
  { name: "COLOR_MAGENTA", r: 178, g: 76, b: 216, blocks: ["magenta_wool", "magenta_carpet", "magenta_concrete", "magenta_concrete_powder", "magenta_glazed_terracotta", "magenta_stained_glass", "magenta_candle", "purpur_block", "purpur_pillar", "purpur_slab"] },
  { name: "COLOR_LIGHT_BLUE", r: 102, g: 153, b: 216, blocks: ["light_blue_wool", "light_blue_carpet", "light_blue_concrete", "light_blue_concrete_powder", "light_blue_glazed_terracotta", "light_blue_stained_glass", "light_blue_candle"] },
  { name: "COLOR_YELLOW", r: 229, g: 229, b: 51, blocks: ["yellow_wool", "yellow_carpet", "yellow_concrete", "yellow_concrete_powder", "yellow_glazed_terracotta", "yellow_stained_glass", "yellow_candle", "sponge", "wet_sponge", "hay_block", "bee_nest", "bamboo_planks", "bamboo_trapdoor"] },
  { name: "COLOR_LIGHT_GREEN", r: 127, g: 204, b: 25, blocks: ["lime_wool", "lime_carpet", "lime_concrete", "lime_concrete_powder", "lime_glazed_terracotta", "lime_stained_glass", "lime_candle", "melon"] },
  { name: "COLOR_PINK", r: 242, g: 127, b: 165, blocks: ["pink_wool", "pink_carpet", "pink_concrete", "pink_concrete_powder", "pink_glazed_terracotta", "pink_stained_glass", "pink_candle", "brain_coral_block", "pearlescent_froglight", "cherry_leaves"] },
  { name: "COLOR_GRAY", r: 76, g: 76, b: 76, blocks: ["gray_wool", "gray_carpet", "gray_concrete", "gray_concrete_powder", "gray_glazed_terracotta", "gray_stained_glass", "gray_candle", "tinted_glass", "acacia_wood"] },
  { name: "COLOR_LIGHT_GRAY", r: 153, g: 153, b: 153, blocks: ["light_gray_wool", "light_gray_carpet", "light_gray_concrete", "light_gray_concrete_powder", "light_gray_glazed_terracotta", "light_gray_stained_glass", "light_gray_candle", "pale_moss_block", "pale_moss_carpet"] },
  { name: "COLOR_CYAN", r: 76, g: 127, b: 153, blocks: ["cyan_wool", "cyan_carpet", "cyan_concrete", "cyan_concrete_powder", "cyan_glazed_terracotta", "cyan_stained_glass", "cyan_candle", "prismarine", "prismarine_slab", "sculk_sensor", "warped_roots", "nether_sprouts", "twisting_vines", "calibrated_sculk_sensor", "warped_fungus"] },
  { name: "COLOR_PURPLE", r: 127, g: 63, b: 178, blocks: ["purple_wool", "purple_carpet", "purple_concrete", "purple_concrete_powder", "purple_glazed_terracotta", "purple_stained_glass", "purple_candle", "bubble_coral_block", "mycelium", "chorus_plant", "chorus_flower", "amethyst_block"] },
  { name: "COLOR_BLUE", r: 51, g: 76, b: 178, blocks: ["blue_wool", "blue_carpet", "blue_concrete", "blue_concrete_powder", "blue_glazed_terracotta", "blue_stained_glass", "blue_candle", "tube_coral_block"] },
  { name: "COLOR_BROWN", r: 102, g: 76, b: 51, blocks: ["brown_wool", "brown_carpet", "brown_concrete", "brown_concrete_powder", "brown_glazed_terracotta", "brown_stained_glass", "brown_candle", "dark_oak_log", "dark_oak_stripped_log", "dark_oak_wood", "dark_oak_stripped_wood", "dark_oak_planks", "dark_oak_slab", "dark_oak_pressure_plate", "dark_oak_trapdoor", "dark_oak_sign", "spruce_log[axis=x]", "soul_sand", "soul_soil", "brown_mushroom", "leaf_litter", "dark_oak_fence_gate", "dark_oak_door"] },
  { name: "COLOR_GREEN", r: 102, g: 127, b: 51, blocks: ["green_wool", "green_carpet", "green_concrete", "green_concrete_powder", "green_glazed_terracotta", "green_stained_glass", "green_candle", "moss_block", "moss_carpet", "dried_kelp_block", "sea_pickle"] },
  { name: "COLOR_RED", r: 153, g: 51, b: 51, blocks: ["red_wool", "red_carpet", "red_concrete", "red_concrete_powder", "red_glazed_terracotta", "red_stained_glass", "red_candle", "fire_coral_block", "bricks", "brick_slab", "nether_wart_block", "nether_wart", "enchanting_table", "red_mushroom_block", "red_mushroom", "shroomlight", "mangrove_log", "mangrove_stripped_log", "mangrove_wood", "mangrove_stripped_wood", "mangrove_planks", "mangrove_slab", "mangrove_pressure_plate", "mangrove_trapdoor", "mangrove_sign", "sniffer_egg", "mangrove_fence_gate", "mangrove_door"] },
  { name: "COLOR_BLACK", r: 25, g: 25, b: 25, blocks: ["black_wool", "black_carpet", "black_concrete", "black_concrete_powder", "black_glazed_terracotta", "black_stained_glass", "black_candle", "obsidian", "crying_obsidian", "respawn_anchor", "coal_block", "blackstone", "polished_blackstone", "polished_blackstone_bricks", "netherite_block", "ancient_debris", "sculk", "sculk_catalyst", "sculk_shrieker", "sculk_vein", "basalt", "polished_basalt", "smooth_basalt"] },
  { name: "GOLD", r: 250, g: 238, b: 77, blocks: ["gold_block", "light_weighted_pressure_plate", "raw_gold_block", "bell"] },
  { name: "DIAMOND", r: 92, g: 219, b: 213, blocks: ["diamond_block", "prismarine_bricks", "dark_prismarine", "beacon", "conduit"] },
  { name: "LAPIS", r: 74, g: 128, b: 255, blocks: ["lapis_block"] },
  { name: "EMERALD", r: 0, g: 217, b: 58, blocks: ["emerald_block"] },
  { name: "PODZOL", r: 129, g: 86, b: 49, blocks: ["podzol", "spruce_log", "spruce_stripped_log", "spruce_wood", "spruce_stripped_wood", "spruce_planks", "spruce_slab", "spruce_pressure_plate", "spruce_trapdoor", "spruce_sign", "oak_log", "jungle_log", "mangrove_roots", "muddy_mangrove_roots", "campfire", "soul_campfire", "spruce_fence_gate", "spruce_door"] },
  { name: "NETHER", r: 112, g: 2, b: 0, blocks: ["netherrack", "nether_bricks", "nether_brick_slab", "cracked_nether_bricks", "chiseled_nether_bricks", "red_nether_bricks", "red_nether_brick_slab", "nether_gold_ore", "nether_quartz_ore", "magma_block", "crimson_roots", "crimson_fungus", "weeping_vines"] },
  { name: "TERRACOTTA_WHITE", r: 209, g: 177, b: 161, blocks: ["white_terracotta", "calcite", "cherry_log[axis=x]", "cherry_planks", "cherry_slab", "cherry_pressure_plate", "cherry_trapdoor", "cherry_sign", "cherry_fence_gate", "cherry_door"] },
  { name: "TERRACOTTA_ORANGE", r: 159, g: 82, b: 36, blocks: ["orange_terracotta", "redstone_lamp", "resin_block", "resin_bricks", "resin_brick_slab", "resin_clump[down=true]"] },
  { name: "TERRACOTTA_MAGENTA", r: 149, g: 87, b: 108, blocks: ["magenta_terracotta"] },
  { name: "TERRACOTTA_LIGHT_BLUE", r: 112, g: 108, b: 138, blocks: ["light_blue_terracotta"] },
  { name: "TERRACOTTA_YELLOW", r: 186, g: 133, b: 36, blocks: ["yellow_terracotta"] },
  { name: "TERRACOTTA_LIGHT_GREEN", r: 103, g: 117, b: 53, blocks: ["lime_terracotta"] },
  { name: "TERRACOTTA_PINK", r: 160, g: 77, b: 78, blocks: ["pink_terracotta", "cherry_wood"] },
  { name: "TERRACOTTA_GRAY", r: 57, g: 41, b: 35, blocks: ["gray_terracotta", "cherry_log", "tuff", "tuff_slab", "polished_tuff", "polished_tuff_slab", "tuff_bricks", "tuff_brick_slab", "chiseled_tuff", "chiseled_tuff_bricks"] },
  { name: "TERRACOTTA_LIGHT_GRAY", r: 135, g: 107, b: 98, blocks: ["light_gray_terracotta", "waxed_exposed_copper", "waxed_exposed_cut_copper", "waxed_exposed_cut_copper_slab", "waxed_exposed_copper_trapdoor", "exposed_copper", "exposed_cut_copper", "exposed_cut_copper_slab", "exposed_copper_trapdoor", "mud_bricks", "mud_brick_slab"] },
  { name: "TERRACOTTA_CYAN", r: 87, g: 92, b: 92, blocks: ["cyan_terracotta", "mud"] },
  { name: "TERRACOTTA_PURPLE", r: 122, g: 73, b: 88, blocks: ["purple_terracotta"] },
  { name: "TERRACOTTA_BLUE", r: 76, g: 62, b: 92, blocks: ["blue_terracotta"] },
  { name: "TERRACOTTA_BROWN", r: 76, g: 50, b: 35, blocks: ["brown_terracotta", "dripstone_block", "pointed_dripstone"] },
  { name: "TERRACOTTA_GREEN", r: 76, g: 82, b: 42, blocks: ["green_terracotta"] },
  { name: "TERRACOTTA_RED", r: 142, g: 60, b: 46, blocks: ["red_terracotta", "decorated_pot"] },
  { name: "TERRACOTTA_BLACK", r: 37, g: 22, b: 16, blocks: ["black_terracotta"] },
  { name: "CRIMSON_NYLIUM", r: 189, g: 48, b: 49, blocks: ["crimson_nylium"] },
  { name: "CRIMSON_STEM", r: 148, g: 63, b: 97, blocks: ["crimson_stem", "stripped_crimson_stem", "crimson_planks", "crimson_slab", "crimson_pressure_plate", "crimson_trapdoor", "crimson_sign", "crimson_fence_gate", "crimson_door"] },
  { name: "CRIMSON_HYPHAE", r: 92, g: 25, b: 29, blocks: ["crimson_hyphae", "stripped_crimson_hyphae"] },
  { name: "WARPED_NYLIUM", r: 22, g: 126, b: 134, blocks: ["warped_nylium", "waxed_oxidized_copper", "waxed_oxidized_cut_copper", "waxed_oxidized_cut_copper_slab", "waxed_oxidized_copper_trapdoor", "oxidized_copper", "oxidized_cut_copper", "oxidized_cut_copper_slab", "oxidized_copper_trapdoor"] },
  { name: "WARPED_STEM", r: 58, g: 142, b: 140, blocks: ["warped_stem", "stripped_warped_stem", "warped_planks", "warped_slab", "warped_pressure_plate", "warped_trapdoor", "warped_sign", "waxed_weathered_copper", "waxed_weathered_cut_copper", "waxed_weathered_cut_copper_slab", "waxed_weathered_copper_trapdoor", "weathered_copper", "weathered_cut_copper", "weathered_cut_copper_slab", "weathered_copper_trapdoor", "warped_fence_gate", "warped_door"] },
  { name: "WARPED_HYPHAE", r: 86, g: 44, b: 62, blocks: ["warped_hyphae", "stripped_warped_hyphae"] },
  { name: "WARPED_WART_BLOCK", r: 20, g: 180, b: 133, blocks: ["warped_wart_block"] },
  { name: "DEEPSLATE", r: 100, g: 100, b: 100, blocks: ["deepslate", "cobbled_deepslate", "cobbled_deepslate_slab", "deepslate_bricks", "deepslate_brick_slab", "deepslate_tiles", "deepslate_tile_slab", "polished_deepslate", "chiseled_deepslate", "cracked_deepslate_bricks", "cracked_deepslate_tiles", "deepslate_coal_ore", "deepslate_copper_ore", "deepslate_iron_ore", "deepslate_gold_ore", "deepslate_redstone_ore", "deepslate_lapis_ore", "deepslate_emerald_ore", "deepslate_diamond_ore"] },
  { name: "RAW_IRON", r: 216, g: 175, b: 147, blocks: ["raw_iron_block"] },
  { name: "GLOW_LICHEN", r: 127, g: 167, b: 150, blocks: ["verdant_froglight", "glow_lichen[down=true]"] },
];

// Build lookup: "r,g,b" → { baseIndex, shade }
export interface ColorMatch {
  baseIndex: number;
  shade: number; // 0=dark, 1=flat, 2=light
}

let _colorLookup: Map<string, ColorMatch> | null = null;

export function getColorLookup(): Map<string, ColorMatch> {
  if (_colorLookup) return _colorLookup;
  _colorLookup = new Map();
  for (let i = 1; i < BASE_COLORS.length; ++i) {
    const { r, g, b } = BASE_COLORS[i];
    for (const s of OBTAINABLE_SHADE_INDICES) {
      const mr = Math.floor(r * SHADE_MULTIPLIERS[s] / 255);
      const mg = Math.floor(g * SHADE_MULTIPLIERS[s] / 255);
      const mb = Math.floor(b * SHADE_MULTIPLIERS[s] / 255);
      _colorLookup.set(`${mr},${mg},${mb}`, { baseIndex: i, shade: s });
    }
  }
  return _colorLookup;
}

// Get the shaded RGB for display
export function getShadedRgb(baseIndex: number, shade: number): [number, number, number] {
  const { r, g, b } = BASE_COLORS[baseIndex];
  const m = SHADE_MULTIPLIERS[shade];
  return [Math.floor((r * m) / 255), Math.floor((g * m) / 255), Math.floor((b * m) / 255)];
}
