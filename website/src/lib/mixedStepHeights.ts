/**
 * Public API:
 * - getMixedStepSettings()
 * - scopeMixedStepPalette()
 * - getGroundedStepColors()
 * - countUnsupportedLifts()
 * - getSupportedStepHeights()
 * - getMixedStepReuse()
 * - getMixedStepColor()
 *
 * Callers:
 * - src/Index.tsx
 * - src/api/generateTile.ts
 * - src/lib/shapeBlocksSuppress.ts
 * - src/lib/shapeGeneration.ts
 */
import { DEFAULT_GROWTH_COVER_BLOCK, DEFAULT_MINECRAFT_VERSION, MAX_STEP_COLOR_BLOCK_LIFT, MIXED_STEP_REACHABLE_TOP } from "@/data/defaultSettings";
import { BASE_COLORS, WATER_BASE_INDEX } from "@/data/mapColors";
import { isFragileBlock } from "@/data/blockFragility";
import { MINECRAFT_VERSIONS } from "@/data/minecraftVersions";
import { canSupportBlock, getBlockSupport, standsOnFloor } from "./blockSupport";
import { environmentalRole, isGrowthCoverEnabled } from "./environmentalSupport";
import { normalizeBlockId, resolveAssignedColorBlock, resolveExportBlockName, stripDefaultBlockNamespace, type ColorBlockSelections } from "@/lib/blockId";
import { isFillerDisabled } from "@/lib/fillerRules";
import { Shade, type ColorGrid, type ShadedColorRef } from "@/types/color";
import { FillerRole, type MixedStepPalette } from "@/types/conversion";
import { SupportMode } from "@/types/ui";
import { MAP_SIZE, isTransparentColor, isWaterColor } from "@/utils/color";
import { parseColorRefKey, type ColorRefKey } from "@/lib/colorRefs";
import type { ShapeColorRef } from "@/types/shape";

// Lift plan for a support block that could hold the listed blocks.
type UnsupportedLifts = { blocks: string[]; maxHeight: number; palette: MixedStepPalette };

function needsRaisedStepSupport(block: string): boolean {
  const id = normalizeBlockId(block);
  return isFragileBlock(id) || id === "shelf_mushroom";
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

// Callers:
// - src/Index.tsx
// - src/api/generateTile.ts
//
// Colors that N/S step reuse must leave at their required height: lifted, they would
// need a support these settings do not place, or one that cannot hold them.
export function getGroundedStepColors(
  usedColorKeys: Iterable<ColorRefKey>,
  selections: ColorBlockSelections,
  supportMode: SupportMode,
  supportFiller: string,
): ColorRefKey[] {
  const support = resolveExportBlockName(supportFiller);
  const dataVersion = MINECRAFT_VERSIONS[selections.minecraftVersion ?? DEFAULT_MINECRAFT_VERSION].dataVersion;
  // A support that needs its own support cannot be stacked under a second lift.
  const placed = (supportMode === SupportMode.Fragile || supportMode === SupportMode.All)
    && !!normalizeBlockId(supportFiller) && !isFillerDisabled(supportFiller) && !needsRaisedStepSupport(support);
  return [...usedColorKeys].filter(key => {
    const block = resolveAssignedColorBlock(parseColorRefKey(key), selections);
    if (!needsRaisedStepSupport(block) && supportMode !== SupportMode.All) return false;
    return !placed || !canSupportBlock(support, block, dataVersion);
  }).sort((a, b) => a - b);
}

// Verified floor-supported shapes: jump directly onto <=1/4-height tops, or
// land on exposed support and step onto inset tops <=1/2 high. Unknowns stay down.
function canRaiseReachableBlock(block: string, growthCover: string): boolean {
  const { id, props, passable } = getBlockSupport(block);
  if (!isFragileBlock(id) || !standsOnFloor(block)) return false;
  // Coral and sea pickles default to waterlogged, so only an explicitly dry state counts.
  if (/coral|sea_pickle/.test(id) ? props.get("waterlogged") !== "false" : props.get("waterlogged") === "true") return false;
  // Living coral already has a generated support of its own below it.
  if (environmentalRole(id) === FillerRole.CoralSupport) return false;
  // Without a collision box the bot lands on the support itself. Fire would burn it there.
  if (passable && id !== "fire" && id !== "soul_fire") {
    // A growing plant's cover is in the bot's head space, so it must be passable too.
    return environmentalRole(id) !== FillerRole.GrowthCover || !isGrowthCoverEnabled(growthCover) || getBlockSupport(growthCover).passable;
  }
  // Passable from the side despite its sturdy top; still requires support.
  if (id === "scaffolding") return true;
  if (id === "sea_pickle") return true;
  if (id.endsWith("_carpet")) return props.get("bottom") !== "false";
  if (id === "candle" || id.endsWith("_candle")) return true;
  if (id === "amethyst_cluster" || /^(small|medium|large)_amethyst_bud$/.test(id) || id === "ice_crystal") return true;
  if (id === "snow") return ["1", "2", "3"].includes(props.get("layers") ?? "1");
  if (id.endsWith("_trapdoor")) return props.get("open") !== "true" && (props.get("half") ?? "bottom") === "bottom";
  return false;
}

// Fragile blocks that return their own item when the block below is broken; scaffolding does once its whole
// connected group is unsupported. The rest, and any unverified block, take a break action or are lost: they
// stay (trapdoors), drop something else or nothing (amethyst, snow, cake, coral), or need shears or silk touch.
function dropsUnsupported(block: string): boolean {
  const id = normalizeBlockId(block);
  return isFragileBlock(id) && !/(_trapdoor|_amethyst_bud|coral|coral_fan)$/.test(id)
    && !/^(lily_pad|turtle_egg|sculk_sensor|calibrated_sculk_sensor|sculk_vein|chorus_plant|chorus_flower|amethyst_cluster|snow|cake|fire|soul_fire|fern|short_grass|short_dry_grass|tall_dry_grass|dead_bush|bush|nether_sprouts|glow_lichen|twisting_vines|icicle|ice_crystal|sulfur_spike|red_shrub)$/.test(id);
}

// Callers:
// - src/Index.tsx
// - src/api/generateTile.ts
export function getMixedStepSettings(
  usedColorKeys: Iterable<ColorRefKey>,
  selections: ColorBlockSelections,
  supportMode: SupportMode,
  shadeFiller: string,
  supportFiller: string,
  assumeFloor: boolean,
  maxColorBlockLift = MAX_STEP_COLOR_BLOCK_LIFT,
  reachableTop = MIXED_STEP_REACHABLE_TOP,
  growthCover = DEFAULT_GROWTH_COVER_BLOCK,
): { maxHeight: number; palette?: MixedStepPalette; unsupported?: UnsupportedLifts } {
  reachableTop &&= maxColorBlockLift === 1;
  if (!reachableTop && supportMode === SupportMode.None) return {
    maxHeight: maxColorBlockLift > 0 && canRaiseStepBlocks(usedColorKeys, selections, shadeFiller) ? maxColorBlockLift : 0,
  };
  if (maxColorBlockLift < 1
    || supportMode !== SupportMode.Fragile || !assumeFloor
    || !normalizeBlockId(supportFiller) || isFillerDisabled(supportFiller)
    || (maxColorBlockLift !== 1 && isFragileBlock(normalizeBlockId(supportFiller)))
    || (!reachableTop && maxColorBlockLift !== 1 && !canRaiseStepBlocks([], selections, supportFiller))) return { maxHeight: 0 };
  const shade = resolveExportBlockName(shadeFiller);
  const support = resolveExportBlockName(supportFiller);
  const dataVersion = MINECRAFT_VERSIONS[selections.minecraftVersion ?? DEFAULT_MINECRAFT_VERSION].dataVersion;
  const floorOnlySupport = reachableTop || isFragileBlock(support);
  const blocks = BASE_COLORS.map((_, id) => {
    const block = resolveAssignedColorBlock({ id, isCustom: false }, selections);
    return block ? resolveExportBlockName(block) : "";
  });
  // Exact catalog states only: arbitrary input tags can change a block's map color.
  const fillerColor = (name: string) => BASE_COLORS.findIndex((color, id) => id > 0 && id !== WATER_BASE_INDEX
    && color.blocks.some(block => resolveExportBlockName(block) === name));
  // Covers go above palette blocks only, so the shade filler is checked without one.
  const fits = (block: string, cover = "") => reachableTop ? canRaiseReachableBlock(block, cover)
    : canRaiseStepBlocks([], selections, block) || (isFragileBlock(normalizeBlockId(block)) && fillerColor(block) > 0);
  if (isFillerDisabled(shade) || !fits(shade)) return { maxHeight: 0 };
  const holds = (block: string) => canSupportBlock(support, block, dataVersion);
  const fit = blocks.map(block => fits(block, growthCover));
  const canRaise = fit.map((ok, id) => ok && holds(blocks[id]));
  const shadeHeld = holds(shade);
  const canSupport = blocks.map(block => canSupportBlock(block, shade, dataVersion));
  const needsSupport = blocks.map(block => isFragileBlock(normalizeBlockId(block)));
  const shadeColor = fillerColor(shade);
  const supportColor = fillerColor(support);
  const supportCanShade = supportColor > 0;
  const shadeNeedsSupport = isFragileBlock(normalizeBlockId(shade));
  const drops = blocks.map(dropsUnsupported);
  const shadeDropsUnsupported = dropsUnsupported(shade);
  const shadeCanSupport = canSupportBlock(shade, shade, dataVersion);
  const palette = (canRaise: boolean[]): MixedStepPalette => ({
    blocks, canRaise, canSupport, needsSupport, dropsUnsupported: drops, floorOnlySupport, shadeNeedsSupport, shadeDropsUnsupported, shadeCanSupport,
    supportCanShade, shadeColor, supportColor, shade, support,
    key: JSON.stringify([reachableTop, blocks, canRaise, canSupport, needsSupport, drops, shadeNeedsSupport, shadeDropsUnsupported, shadeCanSupport, shadeColor, supportColor, shade, support]),
  });
  // Blocks kept on the floor only because this support block cannot hold them.
  const kept = [...new Set([...(shadeHeld ? [] : [shade]),
    ...Array.from(usedColorKeys, key => key & 1 || !fit[key >> 1] || canRaise[key >> 1] ? "" : blocks[key >> 1])])]
    .filter(Boolean).map(stripDefaultBlockNamespace);
  const unsupported = kept.length ? { blocks: kept, maxHeight: maxColorBlockLift, palette: palette(fit) } : undefined;
  return shadeHeld ? { maxHeight: maxColorBlockLift, unsupported, palette: palette(canRaise) } : { maxHeight: 0, unsupported };
}

// Callers:
// - src/Index.tsx
// - src/api/generateTile.ts
//
// Pixels that stay on the floor but would be lifted if the support block could hold every block.
export function countUnsupportedLifts(colorGrid: ColorGrid, palette: MixedStepPalette | undefined, unsupported: UnsupportedLifts): number {
  // The two plans can only differ on lines holding a block this support cannot hold.
  const affected = palette && ((line: ColorGrid[number]) => line.some(color => !color.isCustom && unsupported.palette.canRaise[color.id] !== palette.canRaise[color.id]));
  const lifted = palette && getSupportedStepHeights(colorGrid, unsupported.maxHeight, palette, affected);
  let count = 0;
  for (const [x, heights] of getSupportedStepHeights(colorGrid, unsupported.maxHeight, unsupported.palette, affected)) {
    const current = lifted?.get(x);
    for (let z = 0; z < MAP_SIZE; ++z) if (heights[z] && !current?.[z]) ++count;
  }
  return count;
}

// Callers:
// - src/Index.tsx
//
// The palette covers every base color. Keying a tile's geometry by only the colors it
// uses (plus the fillers placed in it) keeps block changes elsewhere from regenerating it.
export function scopeMixedStepPalette(palette: MixedStepPalette | undefined, usedColorKeys: Iterable<ColorRefKey>): MixedStepPalette | undefined {
  if (!palette) return undefined;
  const ids = new Set(Array.from(usedColorKeys, key => parseColorRefKey(key).id)).add(palette.shadeColor).add(palette.supportColor);
  const key = JSON.stringify(Object.entries(palette).map(([name, value]) => name === "key" ? 0
    : Array.isArray(value) ? value.map((entry, id) => ids.has(id) ? entry : 0) : value));
  return { ...palette, key };
}

function needsStepSupport(color: ShapeColorRef, palette: MixedStepPalette): boolean {
  return color.fillerRole === FillerRole.SupportRetained ? false
    : color.fillerRole === FillerRole.ShadeSuppress ? palette.shadeNeedsSupport : palette.needsSupport[color.id];
}

// Callers:
// - src/lib/shapeBlocksSuppress.ts
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

// More than the break actions of one line and its north-edge shader, so placements always decide first.
const PLACEMENT_COST = 4 * (MAP_SIZE + 1) + 1;

// Placements, then break actions: a block that drops itself when unsupported goes with the block below it.
function getMixedStepCost(
  north: (ShadedColorRef & ShapeColorRef) | undefined, height: number, south: ShadedColorRef | undefined, southHeight: number,
  palette: MixedStepPalette, reuseSupport = true,
): number {
  const block = !north || isTransparentColor(north) ? "" : north.fillerRole === FillerRole.SupportRetained ? palette.support
    : north.fillerRole === FillerRole.ShadeSuppress ? palette.shade : palette.blocks[north.id];
  const ownSupport = !!north && !!block && height > 0 && needsStepSupport(north, palette);
  let placed = block ? 1 + Number(ownSupport) : 0;
  let dropped = Number(ownSupport && (north!.fillerRole === FillerRole.ShadeSuppress ? palette.shadeDropsUnsupported
    : !north!.fillerRole && palette.dropsUnsupported[north!.id]));
  const reuse = !south || isTransparentColor(south) || south.shade === Shade.Light ? "color" : getMixedStepReuse(north, height, south, southHeight, palette);
  if (reuse !== "color" && !(reuseSupport && reuse === "support")) {
    const shaderHeight = southHeight + Number(south!.shade === Shade.Dark);
    const shader = height !== shaderHeight || block !== palette.shade;
    placed += Number(shader)
      + Number(palette.shadeNeedsSupport && shaderHeight > 0 && !(ownSupport && height === shaderHeight)
        && !(block === palette.support && height === shaderHeight - 1) && !(reuseSupport && reuse === "color-support"));
    dropped += Number(shader && palette.shadeNeedsSupport && palette.shadeDropsUnsupported && shaderHeight > 0);
  }
  return placed * PLACEMENT_COST + placed - dropped;
}

// Callers:
// - src/lib/shapeBlocksSuppress.ts
export function getMixedStepColor(
  color: ShadedColorRef, height: number, south: ShadedColorRef | undefined, southHeight: number, palette: MixedStepPalette,
): ShadedColorRef & ShapeColorRef {
  if (isTransparentColor(color) || (color.id !== palette.supportColor && color.id !== palette.shadeColor)) return color;
  let chosen: ShadedColorRef & ShapeColorRef = color;
  let best = height && !palette.canRaise[color.id] ? Infinity : getMixedStepCost(color, height, south, southHeight, palette);
  // Fragile supports must stay grounded even without the one-jump restriction.
  for (const role of [FillerRole.SupportRetained, FillerRole.ShadeSuppress]) {
    if (role === FillerRole.SupportRetained ? (height !== 0 && palette.floorOnlySupport) || color.id !== palette.supportColor : color.id !== palette.shadeColor) continue;
    const candidate = { ...color, fillerRole: role };
    const cost = getMixedStepCost(candidate, height, south, southHeight, palette);
    if (cost < best) { chosen = candidate; best = cost; }
  }
  return chosen;
}

// Callers:
// - src/lib/shapeGeneration.ts
export function getSupportedStepHeights(
  colorGrid: ColorGrid, maxHeight: number, palette: MixedStepPalette, include?: (line: ColorGrid[number]) => boolean,
): Map<number, Uint8Array> {
  const result = new Map<number, Uint8Array>();
  const states = maxHeight + 1;
  const previousHeights = new Uint8Array(MAP_SIZE * states);
  let previous = new Float64Array(states);
  let next = new Float64Array(states);
  const lowerMinima = new Uint8Array(states);
  const higherMinima = new Uint8Array(states);
  const candidates = new Uint8Array(6);
  // Minimize placements, then break actions, then substitutions, then raised pixels.
  const preferenceWeight = MAP_SIZE * maxHeight + 1;
  const weight = preferenceWeight * (MAP_SIZE + 1);
  // Costs depend on the north color, south shade and two heights, not pixel position.
  // Store score + 1 so zero remains the uncached sentinel.
  const scores = new Uint32Array(palette.blocks.length * 4 * states * states);
  for (let x = 0; x < MAP_SIZE; ++x) {
    const column = colorGrid[x];
    if (include && !include(column)) continue;
    if (column.some(color => color.isCustom || isWaterColor(color)
      || (!isTransparentColor(color) && !palette.blocks[color.id]))) continue;
    if (!column.some(color => color.shade === Shade.Dark && !isTransparentColor(color))) continue;
    const limits = column.map(color => !isTransparentColor(color)
      && (palette.canRaise[color.id] || color.id === palette.shadeColor || (!palette.floorOnlySupport && color.id === palette.supportColor))
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
