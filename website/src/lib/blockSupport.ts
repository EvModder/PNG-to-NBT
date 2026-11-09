/**
 * Public API: getBlockSupport(), canSupportBlock()
 * Callers:
 * - src/lib/mixedStepHeights.ts
 *
 * Support shape, collision shape and outline shape are different Minecraft properties.
 * Pair checks are shared by reuse and warnings; surroundings are checked separately.
 * Shapes use known IDs/families, not a general block-physics engine for arbitrary inputs.
 * Maintenance coverage and intentional omissions: scripts/block-support-review.json.
 */
import { FRAGILE_SUPPORT_RULES, isFallingBlock, isFragileBlock } from "@/data/fragileBlocks";
import { DEFAULT_MINECRAFT_VERSION } from "@/data/defaultSettings";
import { MINECRAFT_VERSIONS } from "@/data/minecraftVersions";
import { normalizeBlockId } from "./blockId";

const FULL_TOP_BLOCKS = new Set([
  "stone", "granite", "polished_granite", "diorite", "polished_diorite", "andesite", "polished_andesite",
  "cobblestone", "mossy_cobblestone", "smooth_stone", "deepslate", "cobbled_deepslate", "polished_deepslate",
  "tuff", "polished_tuff", "blackstone", "polished_blackstone", "obsidian", "crying_obsidian", "bedrock",
  "dirt", "coarse_dirt", "rooted_dirt", "podzol", "mycelium", "clay", "mud", "muddy_mangrove_roots",
  "sand", "red_sand", "gravel", "netherrack", "end_stone", "sandstone", "cut_sandstone", "smooth_sandstone",
  "red_sandstone", "cut_red_sandstone", "smooth_red_sandstone", "prismarine", "dark_prismarine", "terracotta",
  "ice", "packed_ice", "blue_ice", "glass", "tnt", "mushroom_stem", "crimson_stem", "warped_stem",
  "ancient_debris", "azalea", "flowering_azalea", "bamboo_mosaic", "barrel", "barrier", "basalt", "beacon",
  "bee_nest", "beehive", "blast_furnace", "bookshelf", "bricks", "brittle_ice", "budding_amethyst", "calcite",
  "cartography_table", "carved_pumpkin", "chiseled_bookshelf", "chiseled_cinnabar", "chiseled_deepslate",
  "chiseled_packed_ice", "chiseled_polished_blackstone", "chiseled_red_sandstone", "chiseled_sandstone",
  "chiseled_sulfur", "chiseled_tuff", "cinnabar", "copper_grate", "copper_bulb", "crafter", "crafting_table", "creaking_heart", "dispenser",
  "dropper", "fletching_table", "frosted_ice", "furnace", "gilded_blackstone", "glowstone",
  "infested_cobblestone", "infested_deepslate", "infested_stone", "jack_o_lantern", "jigsaw", "jukebox",
  "lodestone", "loom", "mangrove_roots", "melon", "observer", "packed_mud", "polished_basalt",
  "polished_cinnabar", "polished_sulfur", "potent_sulfur", "pumpkin", "purpur_pillar", "quartz_pillar",
  "redstone_lamp", "reinforced_deepslate", "respawn_anchor", "sculk", "sculk_catalyst", "sea_lantern",
  "shroomlight", "shulker_box", "smithing_table", "smoker", "smooth_basalt", "smooth_quartz", "soul_sand",
  "soul_soil", "spawner", "sponge", "stripped_crimson_stem", "stripped_warped_stem", "sulfur",
  "suspicious_gravel", "suspicious_sand", "target", "tinted_glass", "trial_spawner", "vault", "wet_sponge",
]);


const FALL_THROUGH_BLOCKS = new Set([
  "air", "cave_air", "void_air", "water", "lava", "bubble_column", "fire", "soul_fire", "snow",
  "short_grass", "tall_grass", "fern", "large_fern", "dead_bush", "bush", "red_shrub",
  "short_dry_grass", "tall_dry_grass", "seagrass", "tall_seagrass", "vine", "glow_lichen", "resin_clump",
  "light", "structure_void", "warped_roots", "nether_sprouts", "crimson_roots", "leaf_litter", "hanging_roots",
]);

function describe(block: string, modern: boolean) {
  const id = normalizeBlockId(block);
  const props = new Map([...block.matchAll(/(\w+)\s*=\s*([^,\]]+)/g)].map(([, key, value]) => [key, value.trim()]));
  const full = id === "honey_block" ? modern
    : id.endsWith("_slab") ? ["top", "double"].includes(props.get("type") ?? "bottom")
    : id.endsWith("_stairs") ? props.get("half") === "top"
    : id.endsWith("_trapdoor") ? props.get("half") === "top" && props.get("open") !== "true"
    : id === "snow" ? props.get("layers") === "8"
    : id === "piston" || id === "sticky_piston" ? props.get("extended") !== "true" || props.get("facing") === "down"
    : id === "piston_head" ? props.get("facing") === "up"
    : id === "scaffolding" || FULL_TOP_BLOCKS.has(id) || (!id.includes(":")
      && /_(block|wool|concrete|concrete_powder|terracotta|planks|log|wood|hyphae|ore|bricks|tiles|nylium|froglight|stained_glass|shulker_box|copper|copper_grate|copper_bulb)$/.test(id));
  // Connected wall arms and wall-hanging signs use their ordinary/default state.
  // Exotic connection states are not simulated; do not infer arbitrary custom shapes.
  const center = full || /_(fence|wall|wall_hanging_sign)$/.test(id) || id.endsWith("_fence_gate") && props.get("open") !== "true"
    || id === "glass_pane" || id.endsWith("_stained_glass_pane") || id.endsWith("_bars") || id === "iron_bars"
    || (id.endsWith("_chain") || id === "chain" ? (props.get("axis") ?? "y") === "y" : false)
    || (id === "end_rod" || id.endsWith("lightning_rod") ? ["up", "down"].includes(props.get("facing") ?? "up") : false)
    || ["decorated_pot", "anvil", "chipped_anvil", "damaged_anvil", "dragon_egg", "sniffer_egg", "bell"].includes(id);
  const rigid = full || id.endsWith("cauldron") || id === "composter" || id === "hopper";
  const leaves = id.endsWith("_leaves");
  const collision = (full && !["mud", "soul_sand", "honey_block", "snow"].includes(id)) || leaves || id === "chorus_flower";
  // Unusual outlines (portal blocks, multi-face decorations used as supports) are omitted.
  const outline = full || leaves || ["chorus_flower", "powder_snow", "cobweb", "sculk_shrieker"].includes(id);
  const partial = collision || !full && (center || rigid || id.endsWith("_stairs") || id.endsWith("_door") || id.endsWith("_shelf")
    || (id.endsWith("_trapdoor") && props.get("open") === "true") || id === "bamboo" || id === "ladder");
  // Signs/cake also accept some niche solid decorations (e.g. amethyst buds).
  // Omitted cases conservatively warn/skip reuse rather than expanding a full shape catalog.
  const solid = !["azalea", "flowering_azalea", "scaffolding", "snow", "end_rod"].includes(id) && (full
    || center || rigid || leaves || /_(slab|stairs|trapdoor|door|sign|shelf|pressure_plate|bed)$/.test(id)
    || ["farmland", "dirt_path", "cake", "cactus", "bamboo", "bamboo_sapling", "cobweb", "brewing_stand", "chest", "ender_chest",
      "enchanting_table", "end_portal_frame", "lectern", "daylight_detector"].includes(id));
  return { id, props, full, center, rigid, collision, outline, partial, solid, modern,
    water: id === "water" || props.get("waterlogged") === "true",
    fallThrough: !id || FALL_THROUGH_BLOCKS.has(id) };
}

// Two rule eras; bound arbitrary custom state strings, while retaining common palettes.
const caches = [new Map<string, ReturnType<typeof describe>>(), new Map<string, ReturnType<typeof describe>>()];
export function getBlockSupport(block: string, dataVersion: number = MINECRAFT_VERSIONS[DEFAULT_MINECRAFT_VERSION].dataVersion) {
  const modern = dataVersion >= MINECRAFT_VERSIONS["26.4"].dataVersion;
  const cache = caches[Number(modern)];
  let result = cache.get(block);
  if (!result) {
    result = describe(block, modern);
    if (cache.size === 1024) cache.delete(cache.keys().next().value!);
    cache.set(block, result);
  }
  return result;
}

// Whether this exact block can use this exact base, without help from other neighbors.
// Scaffolding connectivity, chorus branches and side/ceiling attachments need geometry checks.
// Chorus is treated as independently floor-supported: dense branches can still violate
// surrounding-air rules. Sloped rails' raised-end support, piston movement and exotic
// connected-wall states are not simulated here; catalog defaults do not request those states.
export function canSupportBlock(support: string, block: string, dataVersion?: number): boolean {
  const base = getBlockSupport(support, dataVersion);
  const { id, props } = getBlockSupport(block, dataVersion);
  if (!id) return true;
  if (isFallingBlock(id)) return !base.fallThrough;
  // This is not a survival guarantee for unknown/custom-only attachments or compound blocks;
  // intentionally unmodeled vanilla cases are recorded in the maintenance support review.
  if (!isFragileBlock(id)) return true;
  if (props.get("hanging") === "true" || ["wall", "ceiling"].includes(props.get("face") ?? "") || props.get("vertical_direction") === "down") return false;
  if (id === "bell" && (props.get("attachment") ?? "floor") !== "floor") return false;
  if (["resin_clump", "glow_lichen", "sculk_vein"].includes(id)) return base.outline && props.get("down") === "true"
    && !["north", "south", "east", "west", "up"].some(face => props.get(face) === "true");
  if (id.includes("amethyst") || id === "ice_crystal") return base.full && (props.get("facing") ?? "up") === "up";
  if (id === "brown_mushroom" || id === "red_mushroom") return base.modern ? base.center
    : FRAGILE_SUPPORT_RULES.get(id)!.validSupportBlocks.includes(base.id) || base.full;
  if (id === "lily_pad") return base.water && (base.id !== "water" || (base.props.get("level") ?? "0") === "0")
    || ["ice", "frosted_ice"].includes(base.id);
  const rule = FRAGILE_SUPPORT_RULES.get(id);
  if (rule) return rule.validSupportBlocks.includes(base.id);
  if (id === "cactus_flower") return base.center || ["farmland", "cactus"].includes(base.id);
  if (id.endsWith("_pressure_plate")) return base.center || base.rigid;
  if (id === "sea_pickle") return base.partial || base.full;
  if (id.endsWith("_candle") || id === "candle" || id.endsWith("_lantern") || id === "lantern"
    || /^(soul_|redstone_|copper_)?torch$/.test(id)) return base.center;
  if (id.endsWith("_carpet")) return !!base.id && !["air", "cave_air", "void_air"].includes(base.id) && props.get("bottom") !== "false";
  if (id.endsWith("_sign") || id.endsWith("_banner") || id === "cake" || id.endsWith("candle_cake")) return base.solid;
  if (id === "snow") return !["ice", "barrier", ...(!base.modern ? ["packed_ice"] : [])].includes(base.id)
    && (base.collision || ["honey_block", "soul_sand", "mud"].includes(base.id)
      || base.id === "snow" && base.props.get("layers") === "8");
  if (["rail", "powered_rail", "detector_rail", "activator_rail", "repeater", "comparator"].includes(id)) return base.rigid;
  if (id === "redstone_wire") return base.full || base.id === "hopper";
  if (id === "twisting_vines") return base.full || ["twisting_vines", "twisting_vines_plant"].includes(base.id);
  if (["pointed_dripstone", "icicle", "sulfur_spike"].includes(id)) return base.full
    || base.id === id && (base.props.get("vertical_direction") ?? "up") === (props.get("vertical_direction") ?? "up");
  if (id.endsWith("_trapdoor") || ["sculk_sensor", "calibrated_sculk_sensor", "turtle_egg"].includes(id)) return true;
  return base.full;
}
