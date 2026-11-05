/**
 * Advisory checks on resolved placements, not a world/redstone simulation.
 * Assumed floors provide suitable support unless map visibility requires a transparent platform.
 *
 * Public API:
 * - getPlacementWarnings()
 *
 * Callers:
 * - src/Index.tsx
 */
import { FRAGILE_SUPPORT_RULES, isFragileBlock, isFallingBlock } from "@/data/blockFragility";
import { WATER_BASE_INDEX } from "@/data/mapColors";
import { getLightEmission, isFlammable, isLightTransparent, MELT_LIGHT } from "@/data/blockEnvironment";
import { DEFAULT_MINECRAFT_VERSION } from "@/data/defaultSettings";
import { MINECRAFT_VERSIONS } from "@/data/minecraftVersions";
import { resolveShapeColorBlockName, type ColorBlockSelections } from "./blockId";
import { environmentalRole, isGrowthCoverValid } from "./environmentalSupport";
import { buildFillerAssignmentMap, isCoralSupportValid } from "./fillerRules";
import { analyzeScaffoldingSupport } from "./shapeAnalysis";
import { canSupportBlock, getBlockSupport } from "./blockSupport";
import { isShapeColorCell, parseShapeCoordKey, resolveShapeBlockName, resolveShapeFiller, toShapeCoordKey } from "./shapeModel";
import { BuildMode, FillerRole, type FillerAssignment } from "@/types/conversion";
import type { GeneratedShape, ShapeColorRef, ShapePart } from "@/types/shape";

// Display order. true: error (red); false: reminder (yellow).
const SUPPORT_KINDS = {
  missingSupport: true, shelfSupport: true, falling: true, attachmentSupport: true,
  scaffoldSupportFiller: true, scaffoldConnection: true, supportMode: true, supportBlock: true, autoSupport: true,
  transparentSupport: true, invalidSupport: true,
};
// Conditions of the surrounding world, listed as their own group.
const WORLD_KINDS = {
  cropLight: false, mushroomLight: false, mushroomSpread: false, missingCover: true, growthCover: false, coralSupport: false,
  tntIgnition: true, tnt: false, fireSpread: true, grassSpread: true, iceMelt: true, snowMelt: true, iceSnowMelt: true, meltRisk: false, snowRisk: false, iceSnowRisk: false, frostedIce: false,
};
const KINDS = { ...SUPPORT_KINDS, ...WORLD_KINDS };
type Kind = keyof typeof KINDS;
type Warning = { kind: Kind; blocks: string[]; invalid: boolean; world: boolean; support?: string; missingPlacements?: number };
const KIND_ORDER = Object.keys(KINDS) as Kind[];
type Cold = keyof typeof MELT_LIGHT;
const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACING: Record<string, number[]> = {
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};

function describeBlock(block: string, dataVersion: number) {
  const support = getBlockSupport(block, dataVersion);
  const { id, props } = support;
  const sturdy = support.full;
  const falling = isFallingBlock(id), fragile = isFragileBlock(id);
  const role = environmentalRole(id);
  const growth = role === FillerRole.GrowthCover && id !== "twisting_vines", coral = role === FillerRole.CoralSupport;
  return { name: block.replace(/^minecraft:/, ""), id, props, sturdy, outline: support.outline,
    falling, fragile, light: getLightEmission(id, props), growth, coral, cover: isGrowthCoverValid(block), wet: isCoralSupportValid(block),
    // Which per-placement checks apply; anything else is skipped without looking at neighbors.
    support: falling || fragile || id === "shelf_mushroom",
    world: growth || coral || /^(tnt|frosted_ice|fire|lava|wheat|brown_mushroom|red_mushroom)$/.test(id),
    igniter: id === "fire" || id === "lava"
      || NEIGHBORS.some(direction => tntSignal(support, direction, true) !== null || tntSignal(support, direction) !== null),
    faces: support.faces, conductor: support.conductor,
    // LavaFluid.randomTick: blocksMotion() ends a rising walk.
    blocksMotion: support.solid && id !== "cobweb" && id !== "bamboo_sapling",
    opaque: sturdy && !isLightTransparent(id),
    flammable: isFlammable(id, props),
  };
}

const warningCache = new WeakMap<GeneratedShape, Map<string, ReturnType<typeof analyzePlacementWarnings>>>();

// Direction points from TNT (or its solid neighbor) to the signal source.
// null: no output toward the receiver; false: possible output; true: active output.
function tntSignal({ id, props }: Pick<ReturnType<typeof getBlockSupport>, "id" | "props">, direction: readonly number[], direct = false): boolean | null {
  const faces = (side: string) => FACING[side]?.every((v, i) => v === direction[i]) ?? false;
  const powered = props.get("powered") === "true" || Number(props.get("power") ?? 0) > 0;
  if (id === "redstone_block") return direct ? true : null;
  if (id === "redstone_torch" || id === "redstone_wall_torch") {
    if (direct ? faces(id === "redstone_torch" ? "up" : props.get("facing") ?? "north") : !faces("down")) return null;
    return props.get("lit") !== "false";
  }
  if (id === "observer") return faces(props.get("facing") ?? "south") ? powered : null;
  if (id === "repeater" || id === "comparator") return faces(props.get("facing") ?? "north") ? powered : null;
  if (id === "lightning_rod") return faces(props.get("facing") ?? "up") ? powered : null;
  if (id === "sculk_sensor" || id === "calibrated_sculk_sensor") {
    if (!direct && !faces("up")) return null;
    if (id === "calibrated_sculk_sensor" && faces(props.get("facing") ?? "north")) return null;
    return props.get("sculk_sensor_phase") === "active" && powered;
  }
  if (id.endsWith("_pressure_plate")) return direct || faces("up") ? powered : null;
  if (id === "lever" || id.endsWith("_button")) {
    const face = props.get("face") ?? "wall";
    const side = face === "floor" ? "up" : face === "ceiling" ? "down" : props.get("facing") ?? "north";
    return direct || faces(side) ? powered : null;
  }
  if (id === "tripwire_hook") return direct || faces(props.get("facing") ?? "north") ? powered : null;
  if (id === "daylight_detector") return direct ? powered : null;
  // Dust connectivity and comparator analog output need a circuit simulation.
  return null;
}

type BlockAt = (x: number, y: number, z: number) => ReturnType<typeof describeBlock>;

function fireHazards(x: number, y: number, z: number, lava: boolean, at: BlockAt, report: (id: string) => void) {
  const burn = (x: number, y: number, z: number) => {
    const block = at(x, y, z);
    if (block.flammable) report(block.id);
  };
  const ignite = (x: number, y: number, z: number) => {
    if (at(x, y, z).id) return;
    for (const [dx, dy, dz] of NEIGHBORS) burn(x + dx, y + dy, z + dz);
  };
  if (!lava) {
    for (const [dx, dy, dz] of NEIGHBORS) burn(x + dx, y + dy, z + dz);
    // FireBlock.tick: new fire in air at +/-1 X/Z, -1..+4 Y, beside fuel.
    for (let dx = -1; dx <= 1; ++dx) for (let dz = -1; dz <= 1; ++dz)
      for (let dy = -1; dy <= 4; ++dy) ignite(x + dx, y + dy, z + dz);
    return;
  }
  // LavaFluid.randomTick: up to two rising random-walk moves, or fire above
  // fuel in the surrounding 3x3. Solid blocks end the walk.
  // Lava also ignites some otherwise fireproof custom blocks (e.g. wooden doors);
  // that broader material flag, later fire chains and flowing lava are not simulated.
  for (let dx = -1; dx <= 1; ++dx) for (let dz = -1; dz <= 1; ++dz) {
    if (!at(x + dx, y + 1, z + dz).id) burn(x + dx, y, z + dz);
    ignite(x + dx, y + 1, z + dz);
  }
  for (let dx = -2; dx <= 2; ++dx) for (let dz = -2; dz <= 2; ++dz) {
    let reachable = false;
    for (let sx = Math.max(-1, dx - 1); sx <= Math.min(1, dx + 1) && !reachable; ++sx)
      for (let sz = Math.max(-1, dz - 1); sz <= Math.min(1, dz + 1); ++sz)
        if (!at(x + sx, y + 1, z + sz).blocksMotion) { reachable = true; break; }
    if (reachable) ignite(x + dx, y + 2, z + dz);
  }
}

function lightReaches(source: readonly number[], target: readonly number[], range: number, at: BlockAt): boolean {
  // Only called after a bounded proximity match. Check light paths through air,
  // glass and transparent blocks; partial-face occlusion remains approximate.
  const queue = [[source[0], source[1], source[2], 0]];
  const visited = new Set<number>();
  for (let i = 0; i < queue.length; ++i) {
    const [x, y, z, distance] = queue[i];
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (distance + 1 + Math.abs(nx - target[0]) + Math.abs(ny - target[1]) + Math.abs(nz - target[2]) > range) continue;
      if (nx === target[0] && ny === target[1] && nz === target[2]) return true;
      const coord = toShapeCoordKey(nx, ny, nz);
      if (visited.has(coord) || at(nx, ny, nz).opaque) continue;
      visited.add(coord);
      queue.push([nx, ny, nz, distance + 1]);
    }
  }
  return false;
}

function hasWaterBelowFloor(part: ShapePart): boolean {
  const bottomFloor = Math.min(...part.supportFloorYs);
  return part.cells.entries().some(([coord, cell]) => isShapeColorCell(cell)
    && !cell.isCustom && cell.id === WATER_BASE_INDEX && parseShapeCoordKey(coord)[1] <= bottomFloor);
}

// Geometry is immutable: list each part's distinct colors once, so palette edits
// that touch no checked block skip the per-placement scan.
const shapePalettes = new WeakMap<GeneratedShape, { colors: ShapeColorRef[]; fillers: boolean }[]>();
function getShapePalettes(shape: GeneratedShape) {
  let palettes = shapePalettes.get(shape);
  if (!palettes) shapePalettes.set(shape, palettes = shape.parts.map(part => {
    const colors = new Map<number, ShapeColorRef>();
    let fillers = false;
    for (const cell of part.cells.values()) {
      if (isShapeColorCell(cell) && !cell.fillerRole) colors.set(cell.id * 2 + +cell.isCustom, cell);
      else fillers = true;
    }
    return { colors: [...colors.values()], fillers };
  }));
  return palettes;
}

export function getPlacementWarnings(
  shapes: readonly GeneratedShape[], selections: ColorBlockSelections, assignments: readonly FillerAssignment[],
  assumeFloor: boolean, mode: BuildMode, crubTech = false,
) {
  // Geometry is immutable. Keep a few palette/state variants without retaining discarded images.
  // Unlike material counts, placement warnings must retain state tags in their key. Only blocks
  // a shape places enter its key, so palette edits for other tiles reuse its warnings.
  const settingsKey = JSON.stringify([selections.minecraftVersion, selections.autoPickSupports, assignments, assumeFloor, crubTech, mode === BuildMode.Flat]);
  const combined = new Map<string, ReturnType<typeof analyzePlacementWarnings>[number]>();
  for (const shape of shapes) {
    let cache = warningCache.get(shape);
    if (!cache) warningCache.set(shape, cache = new Map());
    const key = JSON.stringify([settingsKey, getShapePalettes(shape).map(({ colors }) => colors.map(color => resolveShapeColorBlockName(color, selections)))]);
    let warnings = cache.get(key);
    if (!warnings) {
      warnings = analyzePlacementWarnings(shape, selections, assignments, assumeFloor, crubTech, mode === BuildMode.Flat);
      if (cache.size === 8) cache.delete(cache.keys().next().value!);
      cache.set(key, warnings);
    }
    for (const warning of warnings) {
      const group = JSON.stringify([warning.kind, warning.support]);
      const previous = combined.get(group);
      combined.set(group, previous ? { ...warning, blocks: [...new Set([...previous.blocks, ...warning.blocks])].sort(),
        invalid: previous.invalid || warning.invalid,
        ...(warning.missingPlacements && { missingPlacements: previous.missingPlacements! + warning.missingPlacements }),
      } : warning);
    }
  }
  const kindGroup = (kind: Kind) => JSON.stringify([kind, undefined]);
  // A detected hazard displaces its heads-up across selected tiles; fixing it reveals any remaining risk.
  if (combined.has(kindGroup("tntIgnition"))) combined.delete(kindGroup("tnt"));
  if (combined.has(kindGroup("iceMelt"))) combined.delete(kindGroup("meltRisk"));
  if (combined.has(kindGroup("snowMelt"))) combined.delete(kindGroup("snowRisk"));
  // One line covers both blocks; the reminder quotes the stricter ice threshold.
  for (const [ice, snow, both] of [["iceMelt", "snowMelt", "iceSnowMelt"], ["meltRisk", "snowRisk", "iceSnowRisk"]] as const) {
    const a = combined.get(kindGroup(ice)), b = combined.get(kindGroup(snow));
    if (!a || !b) continue;
    combined.delete(kindGroup(ice));
    combined.delete(kindGroup(snow));
    combined.set(kindGroup(both), { ...a, kind: both, blocks: [...new Set([...a.blocks, ...b.blocks])].sort() });
  }
  return [...combined.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function analyzePlacementWarnings(
  shape: GeneratedShape, selections: ColorBlockSelections, assignments: readonly FillerAssignment[],
  assumeFloor: boolean, crubTech: boolean, flat: boolean,
): Warning[] {
  const flatPlatform = flat && assumeFloor && shape.parts.every(part => part.supportFloorYs.size === 1
    && part.bounds.maxY <= Math.min(...part.supportFloorYs) + 1 && !hasWaterBelowFloor(part));
  const issues = Object.fromEntries(KIND_ORDER.map(kind => [kind, new Set<string>()])) as Record<Kind, Set<string>>;
  const invalidSupports = new Map<string, Set<string>>();
  let missingPlacements = 0;
  const unsupported = (block: string, support: string) => {
    if (!invalidSupports.has(support)) invalidSupports.set(support, new Set());
    invalidSupports.get(support)!.add(block);
  };
  const fillers = buildFillerAssignmentMap(assignments);
  const withAutoSupports = { ...selections, autoPickSupports: true };
  const dataVersion = MINECRAFT_VERSIONS[selections.minecraftVersion ?? DEFAULT_MINECRAFT_VERSION].dataVersion;
  const descriptions = new Map<string, ReturnType<typeof describeBlock>>();
  const describe = (block: string) => {
    if (!descriptions.has(block)) descriptions.set(block, describeBlock(block, dataVersion));
    return descriptions.get(block)!;
  };
  // Blocks each part can place. Fillers resolve per position, so any filler cell admits
  // every assignment and the substrate a fragile block substitutes below itself.
  const palettes = getShapePalettes(shape);
  const partBlocks = palettes.map(({ colors, fillers: hasFillers }) => {
    const placed = [...colors.map(color => resolveShapeColorBlockName(color, selections, fillers) ?? ""),
      ...(hasFillers ? assignments.map(({ block }) => block) : [])].map(describe);
    return hasFillers ? [...placed, ...placed.flatMap(({ id }) => FRAGILE_SUPPORT_RULES.get(id)?.replacementBlock ?? []).map(describe)] : placed;
  });
  const scaffolding = !flatPlatform && partBlocks.some(blocks => blocks.some(block => block.id === "scaffolding"))
    ? analyzeScaffoldingSupport([shape], selections, assignments, assumeFloor) : undefined;
  for (const role of scaffolding?.roles ?? []) {
    const supportField = !crubTech && (role.startsWith("support_") || role.startsWith("convenience_"));
    issues[supportField ? "scaffoldSupportFiller" : "scaffoldConnection"].add("scaffolding");
  }
  let growth = false, missingCover = false;
  for (const [index, part] of shape.parts.entries()) {
    // Gate each scan on what this part actually places, not on the whole palette.
    const blocks = partBlocks[index];
    const unstableScaffoldColors = scaffolding?.colors.get(part);
    const hasIgniter = blocks.some(block => block.igniter), hasTnt = blocks.some(block => block.id === "tnt");
    const fuels = new Set(blocks.filter(block => block.flammable && block.id !== "tnt" && !issues.fireSpread.has(block.id)).map(block => block.id));
    // Color blocks come first; filler dirt never counts.
    let dirtPending = !issues.grassSpread.size && blocks.slice(0, palettes[index].colors.length).some(block => block.id === "dirt");
    const checked = (block: (typeof blocks)[number]) => block.support && !flatPlatform
      || (block.id === "tnt" ? hasIgniter : block.id === "fire" || block.id === "lava" ? fuels.size > 0 || hasTnt
        : block.id === "grass_block" || block.id === "mycelium" ? dirtPending : block.world);
    if (!blocks.some(block => block.id in MELT_LIGHT || checked(block))) continue;
    const bottomFloor = Math.min(...part.supportFloorYs);
    const waterBelowFloor = assumeFloor && hasWaterBelowFloor(part);
    // Only the lowest platform can use arbitrary opaque substrates. Upper platforms
    // and platforms over water need transparent blocks; glass models their support face.
    const transparentFloor = (y: number) => assumeFloor && part.supportFloorYs.has(y) && (y !== bottomFloor || waterBelowFloor);
    // Per-part only: neighboring phases are not simultaneously built at their exported Y positions.
    const resolved = new Map<number, ReturnType<typeof describeBlock>>();
    const at = (x: number, y: number, z: number) => {
      const coord = toShapeCoordKey(x, y, z);
      if (!part.cells.has(coord)) return describe(transparentFloor(y) ? "glass" : "");
      if (!resolved.has(coord)) resolved.set(coord, describe(resolveShapeBlockName(part, coord, selections, fillers, assumeFloor)
        || (transparentFloor(y) ? "glass" : "")));
      return resolved.get(coord)!;
    };
    const cold: [number, number, number, Cold][] = [];
    const lights: [number, number, number, number, string][] = [];
    for (const coord of part.cells.keys()) {
      const [x, y, z] = parseShapeCoordKey(coord);
      const block = at(x, y, z);
      const { id, props } = block;
      if (!id) continue;
      const cell = part.cells.get(coord)!;
      const waterColor = isShapeColorCell(cell) && !cell.isCustom && cell.id === WATER_BASE_INDEX;
      if ((id === "ice" && !waterColor) || id === "snow") {
        cold.push([x, y, z, id]);
        issues[id === "ice" ? "meltRisk" : "snowRisk"].add(id);
      }
      if (block.light >= MELT_LIGHT.ice) lights.push([x, y, z, block.light, id]);
      if (!checked(block)) continue;
      if (block.support && !flatPlatform) {
        const below = at(x, y - 1, z);
        const floorBelow = assumeFloor && part.supportFloorYs.has(y - 1);
        const platform = !below.id && floorBelow;
        const unsupportedBelow = (fallback: "missingSupport" | "falling" | "scaffoldConnection" = "missingSupport") => {
          const belowCoord = toShapeCoordKey(x, y - 1, z);
          const cellBelow = part.cells.get(belowCoord);
          const rolesBelow = cellBelow && !isShapeColorCell(cellBelow) ? cellBelow : undefined;
          if (!selections.autoPickSupports && !crubTech && !floorBelow && rolesBelow) {
            const fixed = resolveShapeFiller(part, belowCoord, rolesBelow, withAutoSupports, fillers);
            if (fixed?.constrainedBlock === id && fixed.blockName && describe(fixed.blockName).name !== below.name
              && canSupportBlock(fixed.blockName, block.name, dataVersion)) {
              issues.autoSupport.add(block.name);
              return;
            }
          }
          if (below.id) {
            if (transparentFloor(y - 1)) issues.transparentSupport.add(id);
            else if (fallback !== "missingSupport") issues[fallback].add(id);
            else unsupported(id, below.name);
            return;
          }
          if (rolesBelow?.includes(FillerRole.SupportFragile) && rolesBelow.includes(FillerRole.SupportAll)) {
            // An active support role at an empty position needs a block, not a different mode.
            const enabled = rolesBelow.some(role => fillers.has(role) &&
              (role === FillerRole.StairStep || role === FillerRole.SupportFragile || role === FillerRole.SupportAll));
            issues[enabled ? "supportBlock" : "supportMode"].add(enabled ? block.name : id);
            if (!enabled) ++missingPlacements;
          } else issues[fallback].add(id);
        };
        if (id === "scaffolding" && unstableScaffoldColors?.has(coord)) unsupportedBelow("scaffoldConnection");
        const multiface = ["resin_clump", "glow_lichen", "sculk_vein"].includes(id);
        const crystal = id.includes("amethyst") || id === "ice_crystal";
        // Offset to the anchoring block; undefined where no single anchor is checked.
        const anchor = multiface || id === "bell" && (props.get("attachment") ?? "floor") !== "floor" ? undefined
          : props.get("hanging") === "true" || props.get("face") === "ceiling" || props.get("vertical_direction") === "down" ? FACING.up
          : props.get("face") === "wall" || crystal && (props.get("facing") ?? "up") !== "up" ? FACING[props.get("facing") ?? "north"]?.map(v => -v)
          : FACING.down;
        const attached = (dx: number, dy: number, dz: number) => {
          const neighbor = at(x + dx, y + dy, z + dz);
          // Multiface attachment uses the outline face, not the collision or sturdy face.
          // Side/ceiling attachments need the neighbor's full face toward the block; center-post
          // supports (e.g. hanging lanterns on chains) may warn unnecessarily.
          if (dy === -1) return (multiface ? neighbor.outline : neighbor.sturdy) || (!neighbor.id && floorBelow);
          return neighbor.faces.includes(dy ? "d" : dx ? (dx > 0 ? "w" : "e") : dz > 0 ? "n" : "s");
        };
        if (multiface) {
          const faces = Object.entries(FACING).filter(([face]) => props.get(face) === "true");
          for (const [, [dx, dy, dz]] of faces) {
            if (attached(dx, dy, dz)) continue;
            if (dy === -1) unsupportedBelow();
            else issues.attachmentSupport.add(id);
          }
        } else if (anchor && anchor !== FACING.down && !attached(anchor[0], anchor[1], anchor[2])) issues.attachmentSupport.add(id);
        // Floors are wildcard substrates unless map visibility constrains them.
        if (block.fragile && !block.falling && id !== "scaffolding" && !platform && anchor === FACING.down
          // A transparent platform may still be waterlogged; plain glass is only a face proxy.
          && !(id === "lily_pad" && transparentFloor(y - 1))
          && !canSupportBlock(below.name, block.name, dataVersion)) {
          unsupportedBelow();
        }
        if (block.falling && !platform && !canSupportBlock(below.name, block.name, dataVersion)) unsupportedBelow("falling");
        if (id === "shelf_mushroom") {
          const [dx, , dz] = FACING[props.get("facing") ?? "north"] ?? FACING.north;
          if (!attached(-dx, 0, -dz)) issues.shelfSupport.add(id);
        }
      }
      if (id === "tnt" && hasIgniter) for (const direction of NEIGHBORS) {
        const [dx, dy, dz] = direction;
        const neighbor = at(x + dx, y + dy, z + dz);
        const signal = tntSignal(neighbor, direction, true);
        if (signal !== null || neighbor.id === "fire" || neighbor.id === "lava") {
          issues[signal === false ? "tnt" : "tntIgnition"].add(neighbor.id);
        }
        // Only strong power conducted through a redstone conductor can reach TNT.
        if (neighbor.conductor) for (const direction of NEIGHBORS) {
          const [sx, sy, sz] = direction;
          const source = at(x + dx + sx, y + dy + sy, z + dz + sz);
          const signal = tntSignal(source, direction);
          if (signal !== null) issues[signal ? "tntIgnition" : "tnt"].add(source.id);
        }
      }
      // Each fuel is reported once, so stop scanning sources when none is left to find.
      if ((id === "fire" || id === "lava") && (fuels.size || hasTnt && !issues.tntIgnition.has(id))) fireHazards(x, y, z, id === "lava", at, fuel => {
        if (fuel === "tnt") issues.tntIgnition.add(id);
        else if (fuels.delete(fuel)) issues.fireSpread.add(fuel);
      });
      const exported = (dy: number) => describe(resolveShapeBlockName(part, toShapeCoordKey(x, y + dy, z), selections, fillers, assumeFloor));
      // Covers go on color blocks only; a sapling used as a filler is left to the user.
      if (block.growth && isShapeColorCell(cell) && !cell.fillerRole) {
        growth = true;
        missingCover ||= !exported(1).cover;
      }
      if (block.coral && !at(x, y - 1, z).wet) issues.coralSupport.add("coral");
      // SpreadingSnowyBlock: grass and mycelium convert uncovered dirt within x/z +/-1 and y -3..+1,
      // changing its map color. Dirt placed as a filler stays hidden below its block.
      if (dirtPending && (id === "grass_block" || id === "mycelium")) {
        for (let dx = -1; dx <= 1 && dirtPending; ++dx) for (let dz = -1; dz <= 1 && dirtPending; ++dz) for (let dy = -3; dy <= 1; ++dy) {
          const target = part.cells.get(toShapeCoordKey(x + dx, y + dy, z + dz));
          if (!target || !isShapeColorCell(target) || target.fillerRole || at(x + dx, y + dy, z + dz).id !== "dirt") continue;
          const above = at(x + dx, y + dy + 1, z + dz);
          if (above.opaque || above.id === "water") continue;
          issues.grassSpread.add("dirt");
          dirtPending = false;
          break;
        }
      }
      if (id === "wheat") issues.cropLight.add(id);
      if ((id === "brown_mushroom" || id === "red_mushroom")
        && dataVersion < MINECRAFT_VERSIONS["26.4"].dataVersion
        && !["mycelium", "podzol", "crimson_nylium", "warped_nylium"].includes(at(x, y - 1, z).id)) issues.mushroomLight.add(id);
      // MushroomBlock: spreads unless 5 of its type, itself included, are within x/z +/-4 and y +/-1.
      // Where it can land depends on light and floor blocks outside the schematic, so only density is checked.
      if ((id === "brown_mushroom" || id === "red_mushroom") && !issues.mushroomSpread.has(id)) {
        let nearby = 0;
        // Its own layer first: that is where a dense patch reaches 5 soonest.
        for (const dy of [0, -1, 1]) for (let dx = -4; dx <= 4 && nearby < 5; ++dx) for (let dz = -4; dz <= 4 && nearby < 5; ++dz) {
          if (part.cells.has(toShapeCoordKey(x + dx, y + dy, z + dz)) && at(x + dx, y + dy, z + dz).id === id) ++nearby;
        }
        if (nearby < 5) issues.mushroomSpread.add(id);
      }
      // Icicles are skipped: only stacked segments melt, and only a typed icicle support stacks them.
      if (id === "frosted_ice") issues.frostedIce.add(id);
    }
    // Bounded local lookup, not an O(ice * lights) search; verify paths only at matches.
    if (lights.length && cold.length) {
      const coldByCoord = new Map(cold.map(([x, y, z, id]) => [toShapeCoordKey(x, y, z), id]));
      const coldKinds = new Set(cold.map(([, , , id]) => id));
      const meltLight = Math.min(...coldKinds.values().map(id => MELT_LIGHT[id]));
      const melted = (id: Cold) => issues[`${id}Melt` as const];
      for (const [x, y, z, light, source] of lights) {
        if (coldKinds.values().every(id => melted(id).has(source))) continue;
        const radius = light - meltLight;
        for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
          const span = radius - Math.abs(dx) - Math.abs(dy);
          for (let dz = -span; dz <= span; dz++) {
            const id = coldByCoord.get(toShapeCoordKey(x + dx, y + dy, z + dz));
            if (!id || melted(id).has(source)) continue;
            const reach = light - MELT_LIGHT[id];
            const target = [x + dx, y + dy, z + dz];
            if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= reach && lightReaches([x, y, z], target, reach, at)) melted(id).add(source);
          }
        }
      }
    }
  }
  if (!flatPlatform && growth) issues[missingCover ? "missingCover" : "growthCover"].add("saplings");
  return [
    ...KIND_ORDER.filter(kind => issues[kind].size).map(kind => ({ kind, blocks: [...issues[kind]].sort(), invalid: KINDS[kind], world: kind in WORLD_KINDS,
      ...(kind === "supportMode" && { missingPlacements }),
    })),
    ...[...invalidSupports].map(([support, blocks]) => ({ kind: "invalidSupport" as const, blocks: [...blocks].sort(), support, invalid: true, world: false })),
  ];
}
