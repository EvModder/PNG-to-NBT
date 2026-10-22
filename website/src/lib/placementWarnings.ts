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
import { DEFAULT_MINECRAFT_VERSION } from "@/data/defaultSettings";
import { MINECRAFT_VERSIONS } from "@/data/minecraftVersions";
import { resolveShapeColorBlockName, type ColorBlockSelections } from "./blockId";
import { buildFillerAssignmentMap } from "./fillerRules";
import { analyzeScaffoldingSupport } from "./shapeAnalysis";
import { canSupportBlock, getBlockSupport } from "./blockSupport";
import { isShapeColorCell, parseShapeCoordKey, resolveShapeBlockName, toShapeCoordKey } from "./shapeModel";
import { BuildMode, type FillerAssignment } from "@/types/conversion";
import type { GeneratedShape, ShapeColorRef, ShapePart } from "@/types/shape";

// Display order. true: error (red); false: reminder (yellow).
const KINDS = {
  missingSupport: true, shelfSupport: true, falling: true, attachmentSupport: true, transparentSupport: true, invalidSupport: true,
};
type Kind = keyof typeof KINDS;
type Warning = { kind: Kind; blocks: string[]; invalid: boolean; support?: string };
const KIND_ORDER = Object.keys(KINDS) as Kind[];
const FACING: Record<string, number[]> = {
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};

function describeBlock(block: string, dataVersion: number) {
  const support = getBlockSupport(block, dataVersion);
  const { id, props } = support;
  const sturdy = support.full;
  const falling = isFallingBlock(id), fragile = isFragileBlock(id);
  return { name: block.replace(/^minecraft:/, ""), id, props, sturdy, outline: support.outline, falling, fragile,
    // Which per-placement checks apply; anything else is skipped without looking at neighbors.
    support: falling || fragile || id === "shelf_mushroom",
    faces: support.faces,
  };
}

const warningCache = new WeakMap<GeneratedShape, Map<string, ReturnType<typeof analyzePlacementWarnings>>>();

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
  const settingsKey = JSON.stringify([selections.minecraftVersion, assignments, assumeFloor, crubTech, mode === BuildMode.Flat]);
  const combined = new Map<string, ReturnType<typeof analyzePlacementWarnings>[number]>();
  for (const shape of shapes) {
    let cache = warningCache.get(shape);
    if (!cache) warningCache.set(shape, cache = new Map());
    const key = JSON.stringify([settingsKey, getShapePalettes(shape).map(({ colors }) => colors.map(color => resolveShapeColorBlockName(color, selections)))]);
    let warnings = cache.get(key);
    if (!warnings) {
      warnings = analyzePlacementWarnings(shape, selections, assignments, assumeFloor, mode === BuildMode.Flat);
      if (cache.size === 8) cache.delete(cache.keys().next().value!);
      cache.set(key, warnings);
    }
    for (const warning of warnings) {
      const group = JSON.stringify([warning.kind, warning.support]);
      const previous = combined.get(group);
      combined.set(group, previous ? { ...warning, blocks: [...new Set([...previous.blocks, ...warning.blocks])].sort(), invalid: previous.invalid || warning.invalid } : warning);
    }
  }
  return [...combined.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function analyzePlacementWarnings(
  shape: GeneratedShape, selections: ColorBlockSelections, assignments: readonly FillerAssignment[],
  assumeFloor: boolean, flat: boolean,
): Warning[] {
  const flatPlatform = flat && assumeFloor && shape.parts.every(part => part.supportFloorYs.size <= 1 && !hasWaterBelowFloor(part));
  const issues = Object.fromEntries(KIND_ORDER.map(kind => [kind, new Set<string>()])) as Record<Kind, Set<string>>;
  const invalidSupports = new Map<string, Set<string>>();
  const unsupported = (block: string, support: string) => {
    if (!invalidSupports.has(support)) invalidSupports.set(support, new Set());
    invalidSupports.get(support)!.add(block);
  };
  const fillers = buildFillerAssignmentMap(assignments);
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
  if (!flatPlatform && partBlocks.some(blocks => blocks.some(block => block.id === "scaffolding"))) {
    const scaffolding = analyzeScaffoldingSupport([shape], selections, assignments, assumeFloor);
    if (scaffolding.colors || scaffolding.roles.size) issues.missingSupport.add("scaffolding");
  }
  if (flatPlatform) return [];
  for (const [index, part] of shape.parts.entries()) {
    // Gate each scan on what this part actually places, not on the whole palette.
    if (!partBlocks[index].some(block => block.support)) continue;
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
    for (const coord of part.cells.keys()) {
      const [x, y, z] = parseShapeCoordKey(coord);
      const block = at(x, y, z);
      const { id, props } = block;
      if (!id || !block.support) continue;
      const below = at(x, y - 1, z);
      const floorBelow = assumeFloor && part.supportFloorYs.has(y - 1);
      const platform = !below.id && floorBelow;
      const unsupportedBelow = () => {
        if (transparentFloor(y - 1)) issues.transparentSupport.add(id);
        else unsupported(id, below.name);
      };
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
        if (!faces.length || faces.some(([, [dx, dy, dz]]) => !attached(dx, dy, dz))) issues.attachmentSupport.add(id);
      } else if (anchor && anchor !== FACING.down && !attached(anchor[0], anchor[1], anchor[2])) issues.attachmentSupport.add(id);
      // Floors are wildcard substrates unless map visibility constrains them.
      if (block.fragile && !block.falling && id !== "scaffolding" && !platform && anchor === FACING.down
        // A transparent platform may still be waterlogged; plain glass is only a face proxy.
        && !(id === "lily_pad" && transparentFloor(y - 1))
        && !canSupportBlock(below.name, block.name, dataVersion)) {
        if (!below.id) issues.missingSupport.add(id);
        else unsupportedBelow();
      }
      if (block.falling && !platform && !canSupportBlock(below.name, block.name, dataVersion)) issues.falling.add(id);
      if (id === "shelf_mushroom") {
        const [dx, , dz] = FACING[props.get("facing") ?? "north"] ?? FACING.north;
        if (!attached(-dx, 0, -dz)) issues.shelfSupport.add(id);
      }
    }
  }
  return [
    ...KIND_ORDER.filter(kind => issues[kind].size).map(kind => ({ kind, blocks: [...issues[kind]].sort(), invalid: KINDS[kind] })),
    ...[...invalidSupports].map(([support, blocks]) => ({ kind: "invalidSupport" as const, blocks: [...blocks].sort(), support, invalid: true })),
  ];
}
