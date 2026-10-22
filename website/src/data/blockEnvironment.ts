/**
 * Light, light-transparency and fire facts that environmental placement warnings use.
 * Values follow vanilla block states. On version updates, run audit:block-support;
 * see scripts/block-support-review.json.
 *
 * Public API:
 * - MELT_LIGHT
 * - getLightEmission()
 * - isLightTransparent()
 * - isFlammable()
 *
 * Callers:
 * - src/lib/placementWarnings.ts
 */

// Lowest block light, at the block's own position, that melts it.
export const MELT_LIGHT = { ice: 11, snow: 12 };

const LIGHT_LEVELS: Record<string, number> = {
  glowstone: 15, sea_lantern: 15, shroomlight: 15, ochre_froglight: 15, pearlescent_froglight: 15,
  verdant_froglight: 15, jack_o_lantern: 15, lava: 15, fire: 15, lantern: 15, beacon: 15,
  conduit: 15, lava_cauldron: 15, end_portal: 15, end_gateway: 15,
  torch: 14, wall_torch: 14, copper_torch: 14, copper_wall_torch: 14, end_rod: 14,
  nether_portal: 11, soul_torch: 10, soul_wall_torch: 10, soul_lantern: 10, soul_fire: 10, crying_obsidian: 10,
  enchanting_table: 7, ender_chest: 7, glow_lichen: 7, sculk_catalyst: 6, amethyst_cluster: 5,
  large_amethyst_bud: 4, ice_crystal: 4, magma_block: 3, medium_amethyst_bud: 2, firefly_bush: 2,
  small_amethyst_bud: 1, sculk_sensor: 1, calibrated_sculk_sensor: 1, brewing_stand: 1, end_portal_frame: 1,
  dragon_egg: 1, brown_mushroom: 1,
};
// Light while lit; the default state is unlit unless listed in LIT_BY_DEFAULT.
const LIT_LIGHT: Record<string, number> = {
  furnace: 13, blast_furnace: 13, smoker: 13, redstone_lamp: 15, redstone_ore: 9, deepslate_redstone_ore: 9,
  campfire: 15, soul_campfire: 10, redstone_torch: 7, redstone_wall_torch: 7,
};
const LIT_BY_DEFAULT = new Set(["campfire", "soul_campfire", "redstone_torch", "redstone_wall_torch"]);
// Defaults are the unlit states (inactive).
const STATE_LIGHT: Record<string, [property: string, levels: Record<string, number>]> = {
  vault: ["vault_state", { inactive: 6, active: 12, unlocking: 12, ejecting: 12 }],
  trial_spawner: ["trial_spawner_state", { waiting_for_players: 4, active: 8, waiting_for_reward_ejection: 8, ejecting_reward: 8 }],
};

export function getLightEmission(id: string, props: ReadonlyMap<string, string>): number {
  if (id in LIT_LIGHT) return (props.get("lit") ?? String(LIT_BY_DEFAULT.has(id))) === "true" ? LIT_LIGHT[id] : 0;
  const state = STATE_LIGHT[id];
  if (state) return state[1][props.get(state[0]) ?? ""] ?? 0;
  if (id.startsWith("cave_vines")) return props.get("berries") === "true" ? 14 : 0;
  if (id === "copper_lantern" || id.endsWith("_copper_lantern")) return 15;
  if (id === "respawn_anchor") return Math.floor(Number(props.get("charges") ?? 0) * 15 / 4);
  if (id === "sea_pickle") return props.get("waterlogged") === "true" ? 3 + 3 * Number(props.get("pickles") ?? 1) : 0;
  if (id.endsWith("_copper_bulb") || id === "copper_bulb") return props.get("lit") !== "true" ? 0
    : id.includes("oxidized") ? 4 : id.includes("weathered") ? 8 : id.includes("exposed") ? 12 : 15;
  if (id === "candle" || id.endsWith("_candle")) return props.get("lit") === "true" ? 3 * Number(props.get("candles") ?? 1) : 0;
  if (id === "candle_cake" || id.endsWith("_candle_cake")) return props.get("lit") === "true" ? 3 : 0;
  if (id === "light") return Number(props.get("level") ?? 15);
  return LIGHT_LEVELS[id] ?? 0;
}

// Sturdy blocks that let light through; other sturdy blocks stop it. Partial-face
// occlusion (slabs, stairs, extended pistons) is approximated by the sturdy top face.
const LIGHT_TRANSPARENT = new Set([
  "glass", "ice", "frosted_ice", "brittle_ice", "slime_block", "honey_block", "beacon", "spawner", "trial_spawner",
  "vault", "barrier", "scaffolding", "azalea", "flowering_azalea", "mangrove_roots", "test_instance_block",
]);

export function isLightTransparent(id: string): boolean {
  return LIGHT_TRANSPARENT.has(id) || /(^|_)shulker_box$|_(stained_glass|grate|trapdoor)$/.test(id);
}

// FireBlock.bootStrap, excluding the wood/color families matched below.
const FIRE_FUELS = new Set([
  "bamboo_block", "stripped_bamboo_block", "bamboo_mosaic", "hay_block", "bookshelf", "tnt", "mangrove_roots",
  "short_grass", "fern", "dead_bush", "short_dry_grass", "tall_dry_grass", "sunflower", "lilac", "rose_bush", "peony",
  "red_shrub", "tall_grass", "large_fern", "dandelion", "golden_dandelion", "poppy", "open_eyeblossom", "closed_eyeblossom",
  "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy",
  "cornflower", "lily_of_the_valley", "torchflower", "pitcher_plant", "wither_rose", "pink_petals", "wildflowers",
  "leaf_litter", "cactus_flower", "vine", "coal_block", "target", "pale_moss_block", "pale_hanging_moss",
  "dried_kelp_block", "bamboo", "scaffolding", "lectern", "composter", "sweet_berry_bush", "beehive", "bee_nest",
  "cave_vines", "cave_vines_plant", "spore_blossom", "azalea", "flowering_azalea", "big_dripleaf", "big_dripleaf_stem",
  "small_dripleaf", "hanging_roots", "glow_lichen", "firefly_bush", "bush", "straw_bed",
]);

export function isFlammable(id: string, props: ReadonlyMap<string, string>): boolean {
  // FireBlock.bootStrap lists only the wool carpets; moss carpet is not flammable.
  return props.get("waterlogged") !== "true" && !/^(stripped_)?(crimson|warped)_/.test(id) && id !== "moss_carpet"
    && (/_(planks|log|wood|leaves|wool|wool_slab|wool_stairs|carpet|shelf)$/.test(id)
      || /^(oak|spruce|birch|jungle|acacia|cherry|dark_oak|pale_oak|poplar|mangrove|bamboo|bamboo_mosaic)_(slab|stairs|fence|fence_gate)$/.test(id)
      || FIRE_FUELS.has(id));
}
