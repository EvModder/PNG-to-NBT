/**
 * Public API:
 * - getMixedStepSettings()
 * - getSupportedStepHeights()
 * - getMixedStepReuse()
 * - getMixedStepColor()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/shapeGeneration.ts
 */
import { MAX_STEP_COLOR_BLOCK_LIFT, MIXED_STEP_REACHABLE_TOP } from "@/data/defaultSettings";
import { BASE_COLORS, WATER_BASE_INDEX } from "@/data/mapColors";
import { isFragileBlock } from "@/data/fragileBlocks";
import { normalizeBlockId, resolveAssignedColorBlock, resolveExportBlockName, type ColorBlockSelections } from "@/lib/blockId";
import { getFillerFloorAttachmentFix, isFillerDisabled } from "@/lib/fillerRules";
import { getVersionedSupportRules } from "@/lib/minecraftVersion";
import { Shade, type ColorGrid, type ShadedColorRef } from "@/types/color";
import { FillerRole, type MixedStepPalette } from "@/types/conversion";
import { SupportMode } from "@/types/ui";
import { MAP_SIZE, isTransparentColor, isWaterColor } from "@/utils/color";
import { parseColorRefKey, type ColorRefKey } from "@/lib/colorRefs";
import type { ShapeColorRef } from "@/types/shape";

function needsRaisedStepSupport(block: string): boolean {
  const id = normalizeBlockId(block);
  return isFragileBlock(id)
    || /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|anvil|chipped_anvil|damaged_anvil|dragon_egg|shelf_mushroom)$/.test(id)
    || id.endsWith("_concrete_powder");
}

// Raised reuse must not add supports or leave unsupported blocks. Custom colors
// stay on the existing layout because their placement requirements are unknown.
function canRaiseStepBlocks(
  usedColorKeys: Iterable<ColorRefKey>,
  selections: ColorBlockSelections,
  shadeFillerBlock: string,
): boolean {
  if (needsRaisedStepSupport(shadeFillerBlock)) return false;
  for (const key of usedColorKeys) {
    const color = parseColorRefKey(key);
    if (color.isCustom || needsRaisedStepSupport(resolveAssignedColorBlock(color, selections))) return false;
  }
  return true;
}

// Sturdy top faces verified across block states; do not infer this from solidity.
const STEP_SUPPORT_BLOCKS = new Set([
  "stone", "granite", "polished_granite", "diorite", "polished_diorite", "andesite", "polished_andesite",
  "cobblestone", "mossy_cobblestone", "smooth_stone", "deepslate", "cobbled_deepslate", "polished_deepslate",
  "tuff", "polished_tuff", "blackstone", "polished_blackstone", "obsidian", "crying_obsidian", "bedrock",
  "dirt", "coarse_dirt", "rooted_dirt", "podzol", "mycelium", "clay", "mud", "muddy_mangrove_roots",
  "sand", "red_sand", "gravel", "netherrack", "end_stone", "sandstone", "cut_sandstone", "smooth_sandstone",
  "red_sandstone", "cut_red_sandstone", "smooth_red_sandstone", "prismarine", "dark_prismarine", "terracotta",
  "ice", "packed_ice", "blue_ice", "glass", "tnt", "scaffolding", "mushroom_stem", "crimson_stem", "warped_stem",
]);

function hasFullStepTop(block: string): boolean {
  const id = normalizeBlockId(block);
  return STEP_SUPPORT_BLOCKS.has(id) || (!id.includes(":") && id !== "honey_block"
    && /_(block|wool|concrete|terracotta|planks|log|wood|hyphae|ore|bricks|tiles|nylium|froglight|stained_glass)$/.test(id));
}

function getStepBlockProperties(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(\w+)\s*=\s*([^,\]]+)/g)].map(([, key, value]) => [key, value.trim()]));
}

// Check the actual pair, not just the lower block's solidity. Unknown attachment
// rules stay out of raised reuse; these checks run once per palette, not per pixel.
function canSupportStepBlock(support: string, block: string): boolean {
  const id = normalizeBlockId(block);
  if (!isFragileBlock(id)) return true;
  const below = normalizeBlockId(support);
  const full = hasFullStepTop(support);
  const center = full || below === "decorated_pot" || below === "soul_sand";
  const props = getStepBlockProperties(block);
  if (id.endsWith("_carpet")) return props.get("bottom") !== "false" && (center || below === "honey_block");
  if (id.endsWith("_pressure_plate") || id === "candle" || id.endsWith("_candle") || id === "sea_pickle") return center;
  // Packed ice rejects snow in older supported versions. Keep the shared policy conservative.
  if (id === "snow") return (full && below !== "ice" && below !== "packed_ice") || below === "honey_block" || below === "soul_sand";
  if (id === "resin_clump" || id === "glow_lichen" || id === "sculk_vein") return full && getFillerFloorAttachmentFix(block) === null;
  if (id === "amethyst_cluster" || /^(small|medium|large)_amethyst_bud$/.test(id) || id === "ice_crystal") return full && (props.get("facing") ?? "up") === "up";
  if (id.endsWith("_trapdoor")) return center && props.get("open") !== "true" && (props.get("half") ?? "bottom") === "bottom";
  if (id.endsWith("_lantern") || id === "lantern") return center && props.get("hanging") !== "true";
  if (id === "lever" || id.endsWith("_button")) return full && props.get("face") === "floor";
  return full && (id === "scaffolding" || id === "turtle_egg" || id === "sculk_sensor" || id === "calibrated_sculk_sensor"
    || id.endsWith("_sign") || /^(soul_|redstone_|copper_)?torch$/.test(id)
    || /^dead_(tube|brain|bubble|fire|horn)_coral(_fan)?$/.test(id));
}

// Verified floor-supported shapes: jump directly onto <=1/4-height tops, or
// land on exposed support and step onto inset tops <=1/2 high. Unknowns stay down.
function canRaiseReachableBlock(block: string): boolean {
  const id = normalizeBlockId(block);
  if (!isFragileBlock(id)) return false;
  const props = getStepBlockProperties(block);
  if (props.get("waterlogged") === "true") return false;
  // Passable from the side despite its sturdy top; still requires support.
  if (id === "scaffolding") return true;
  if (id === "resin_clump" || id === "glow_lichen" || id === "sculk_vein") return getFillerFloorAttachmentFix(block) === null;
  if (id === "sea_pickle" || /^dead_(tube|brain|bubble|fire|horn)_coral_fan$/.test(id)) return props.get("waterlogged") === "false";
  if (id.endsWith("_carpet")) return props.get("bottom") !== "false";
  if (id.endsWith("_pressure_plate") || id === "candle" || id.endsWith("_candle")) return true;
  if (id === "amethyst_cluster" || /^(small|medium|large)_amethyst_bud$/.test(id) || id === "ice_crystal") return (props.get("facing") ?? "up") === "up";
  if (id === "snow") return ["1", "2", "3"].includes(props.get("layers") ?? "1");
  if (id.endsWith("_trapdoor")) return props.get("open") !== "true" && (props.get("half") ?? "bottom") === "bottom";
  return false;
}

// Callers:
// - src/Index.tsx
export function getMixedStepSettings(
  usedColorKeys: Iterable<ColorRefKey>,
  selections: ColorBlockSelections,
  supportMode: SupportMode,
  shadeFiller: string,
  supportFiller: string,
  assumeFloor: boolean,
  maxColorBlockLift = MAX_STEP_COLOR_BLOCK_LIFT,
  reachableTop = MIXED_STEP_REACHABLE_TOP,
): { maxHeight: number; palette?: MixedStepPalette } {
  reachableTop &&= maxColorBlockLift === 1;
  if (!reachableTop && supportMode === SupportMode.None) return {
    maxHeight: maxColorBlockLift > 0 && canRaiseStepBlocks(usedColorKeys, selections, shadeFiller) ? maxColorBlockLift : 0,
  };
  if (maxColorBlockLift < 1
    || supportMode !== SupportMode.Fragile || !assumeFloor
    || !normalizeBlockId(supportFiller) || isFillerDisabled(supportFiller)
    || isFragileBlock(normalizeBlockId(supportFiller))
    || (!reachableTop && !canRaiseStepBlocks([], selections, supportFiller))) return { maxHeight: 0 };
  const shade = resolveExportBlockName(shadeFiller);
  const support = resolveExportBlockName(supportFiller);
  const blocks = BASE_COLORS.map((_, id) => {
    const block = resolveAssignedColorBlock({ id, isCustom: false }, selections);
    return block ? resolveExportBlockName(block) : "";
  });
  // Exact catalog states only: arbitrary input tags can change a block's map color.
  const fillerColor = (name: string) => BASE_COLORS.findIndex((color, id) => id > 0 && id !== WATER_BASE_INDEX
    && color.blocks.some(block => resolveExportBlockName(block) === name));
  const supportRules = getVersionedSupportRules(selections.minecraftVersion);
  const canRaiseBlock = (block: string) => canSupportStepBlock(support, block) && (reachableTop ? canRaiseReachableBlock(block)
    : canRaiseStepBlocks([], selections, block) || (isFragileBlock(normalizeBlockId(block))
      && !supportRules.has(normalizeBlockId(block)) && fillerColor(block) > 0));
  if (isFillerDisabled(shade) || !canRaiseBlock(shade)) return { maxHeight: 0 };
  const canRaise = blocks.map(canRaiseBlock);
  const canSupport = blocks.map(block => canSupportStepBlock(block, shade));
  const needsSupport = blocks.map(block => isFragileBlock(normalizeBlockId(block)));
  const shadeColor = fillerColor(shade);
  const supportColor = fillerColor(support);
  const supportCanShade = supportColor > 0;
  const shadeNeedsSupport = isFragileBlock(normalizeBlockId(shade));
  const shadeCanSupport = canSupportStepBlock(shade, shade);
  return { maxHeight: maxColorBlockLift, palette: {
    blocks, canRaise, canSupport, needsSupport, reachableTop, shadeNeedsSupport, shadeCanSupport,
    supportCanShade, shadeColor, supportColor, shade, support,
    key: JSON.stringify([reachableTop, blocks, canRaise, canSupport, needsSupport, shadeNeedsSupport, shadeCanSupport, shadeColor, supportColor, shade, support]),
  } };
}

function needsStepSupport(color: ShapeColorRef, palette: MixedStepPalette): boolean {
  return color.fillerRole === FillerRole.SupportRetained ? false
    : color.fillerRole === FillerRole.ShadeSuppress ? palette.shadeNeedsSupport : palette.needsSupport[color.id];
}

// Callers:
// - src/lib/shapeGeneration.ts
export function getMixedStepReuse(
  north: (ShadedColorRef & ShapeColorRef) | undefined,
  northHeight: number,
  south: ShadedColorRef | undefined,
  southHeight: number,
  palette: MixedStepPalette,
): "color" | "support" | "color-support" | undefined {
  if (!north || isTransparentColor(north) || !south || isTransparentColor(south)) return;
  if (south.shade === Shade.Flat ? northHeight === southHeight : south.shade === Shade.Dark ? northHeight > southHeight : northHeight < southHeight) return "color";
  if (northHeight > 0 && needsStepSupport(north, palette) && south.shade === Shade.Flat
    && southHeight === northHeight - 1 && palette.supportCanShade) return "support";
  if (palette.shadeNeedsSupport && south.shade !== Shade.Light
    && northHeight === southHeight + Number(south.shade === Shade.Dark) - 1
    && (north.fillerRole === FillerRole.SupportRetained
      || (north.fillerRole === FillerRole.ShadeSuppress ? palette.shadeCanSupport : palette.canSupport[north.id]))) return "color-support";
}

function getMixedStepCost(
  north: (ShadedColorRef & ShapeColorRef) | undefined, height: number, south: ShadedColorRef | undefined, southHeight: number,
  palette: MixedStepPalette, reuseSupport = true,
): number {
  const block = !north || isTransparentColor(north) ? "" : north.fillerRole === FillerRole.SupportRetained ? palette.support
    : north.fillerRole === FillerRole.ShadeSuppress ? palette.shade : palette.blocks[north.id];
  const ownSupport = !!north && !!block && height > 0 && needsStepSupport(north, palette);
  const own = block ? 1 + Number(ownSupport) : 0;
  if (!south || isTransparentColor(south) || south.shade === Shade.Light) return own;
  const reuse = getMixedStepReuse(north, height, south, southHeight, palette);
  if (reuse === "color" || (reuseSupport && reuse === "support")) return own;
  const shaderHeight = southHeight + Number(south.shade === Shade.Dark);
  return own + Number(height !== shaderHeight || block !== palette.shade)
    + Number(palette.shadeNeedsSupport && shaderHeight > 0 && !(ownSupport && height === shaderHeight)
      && !(block === palette.support && height === shaderHeight - 1) && !(reuseSupport && reuse === "color-support"));
}

// Callers:
// - src/lib/shapeGeneration.ts
export function getMixedStepColor(
  color: ShadedColorRef, height: number, south: ShadedColorRef | undefined, southHeight: number, palette: MixedStepPalette,
): ShadedColorRef & ShapeColorRef {
  if (isTransparentColor(color) || (color.id !== palette.supportColor && color.id !== palette.shadeColor)) return color;
  let chosen: ShadedColorRef & ShapeColorRef = color;
  let best = height && !palette.canRaise[color.id] ? Infinity : getMixedStepCost(color, height, south, southHeight, palette);
  // Only one-jump mode keeps full-height support substitutions on the floor.
  for (const role of [FillerRole.SupportRetained, FillerRole.ShadeSuppress]) {
    if (role === FillerRole.SupportRetained ? (height !== 0 && palette.reachableTop) || color.id !== palette.supportColor : color.id !== palette.shadeColor) continue;
    const candidate = { ...color, fillerRole: role };
    const cost = getMixedStepCost(candidate, height, south, southHeight, palette);
    if (cost < best) { chosen = candidate; best = cost; }
  }
  return chosen;
}

// Callers:
// - src/lib/shapeGeneration.ts
export function getSupportedStepHeights(colorGrid: ColorGrid, maxHeight: number, palette: MixedStepPalette): Map<number, Uint8Array> {
  const result = new Map<number, Uint8Array>();
  const states = maxHeight + 1;
  const previousHeights = new Uint8Array(MAP_SIZE * states);
  let previous = new Float64Array(states);
  let next = new Float64Array(states);
  const lowerMinima = new Uint8Array(states);
  const higherMinima = new Uint8Array(states);
  const candidates = new Uint8Array(6);
  // Minimize placements, then substitutions, then raised pixels.
  const preferenceWeight = MAP_SIZE * maxHeight + 1;
  const weight = preferenceWeight * (MAP_SIZE + 1);
  // Costs depend on the north color, south shade and two heights, not pixel position.
  // Store score + 1 so zero remains the uncached sentinel.
  const scores = new Uint32Array(palette.blocks.length * 4 * states * states);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const column = colorGrid[x];
    if (column.some(color => color.isCustom || isWaterColor(color)
      || (!isTransparentColor(color) && !palette.blocks[color.id]))) continue;
    if (!column.some(color => color.shade === Shade.Dark && !isTransparentColor(color))) continue;
    const limits = column.map(color => !isTransparentColor(color)
      && (palette.canRaise[color.id] || color.id === palette.shadeColor || (!palette.reachableTop && color.id === palette.supportColor))
      ? maxHeight - Number(color.shade === Shade.Dark) : 0);
    // Each XZ column has its own color in one phase and its southern pixel's
    // shader in the other. Count shared blocks once, regardless of phase order.
    const score = (z: number, height: number, southHeight: number): number => {
      const south = column[z + 1];
      const shade = !south || isTransparentColor(south) ? 3 : south.shade;
      const key = (((column[z]?.id ?? 0) * 4 + shade) * states + height) * states + southHeight;
      if (scores[key]) return scores[key] - 1;
      const color = column[z] && getMixedStepColor(column[z], height, column[z + 1], southHeight, palette);
      const cost = getMixedStepCost(color, height, column[z + 1], southHeight, palette) * weight
        + Number(!!color?.fillerRole) * preferenceWeight;
      scores[key] = cost + 1;
      return cost;
    };
    previous.fill(Infinity);
    for (let height = 0; height <= limits[0]; ++height) previous[height] = score(-1, 0, height) + height;
    let baseline = getMixedStepCost(undefined, 0, column[0], 0, palette);
    for (let z = 1; z < MAP_SIZE; ++z) {
      // Compare against the unchanged floor-only exporter, before substitutions.
      baseline += getMixedStepCost(column[z - 1], 0, column[z], 0, palette, false);
      next.fill(Infinity);
      const northLimit = limits[z - 1];
      let best = 1;
      for (let h = 1; h <= northLimit; ++h) {
        if (previous[h] < previous[best]) best = h;
        lowerMinima[h] = best;
      }
      best = northLimit;
      for (let h = northLimit; h > 0; --h) {
        if (previous[h] <= previous[best]) best = h;
        higherMinima[h] = best;
      }
      for (let height = 0; height <= limits[z]; ++height) {
        // Away from the floor and adjacent heights, costs are constant on each
        // side. Prefix/suffix minima keep the search O(pixels * height states).
        let count = 1;
        if (height > 2 && northLimit > 0) candidates[count++] = lowerMinima[Math.min(height - 2, northLimit)];
        for (let h = Math.max(1, height - 1); h <= Math.min(northLimit, height + 1); ++h) candidates[count++] = h;
        if (height + 2 <= northLimit) candidates[count++] = higherMinima[height + 2];
        for (let i = 0; i < count; ++i) {
          const northHeight = candidates[i];
          const candidate = previous[northHeight] + score(z - 1, northHeight, height) + height;
          if (candidate < next[height]) {
            next[height] = candidate;
            previousHeights[z * states + height] = northHeight;
          }
        }
      }
      [previous, next] = [next, previous];
    }
    baseline += getMixedStepCost(column[MAP_SIZE - 1], 0, undefined, 0, palette);
    for (let height = 0; height < states; ++height) previous[height] += score(MAP_SIZE - 1, height, 0);
    let height = 0;
    for (let h = 1; h < states; ++h) if (previous[h] < previous[height]) height = h;
    if (previous[height] >= baseline * weight) continue;
    const heights = new Uint8Array(MAP_SIZE);
    for (let z = MAP_SIZE - 1; z >= 0; --z) {
      heights[z] = height;
      height = previousHeights[z * states + height];
    }
    result.set(x, heights);
  }
  return result;
}
