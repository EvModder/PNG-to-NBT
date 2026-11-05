/**
 * Public API:
 * - analyzeFillerNeeds()
 * - hasStairStepSupport()
 * - collectFillerRolePixels()
 * - nooblineIsSingleY()
 * - hasNonWaterColorHeightVariance()
 * - hasBuildAtWorldMinYOpportunity()
 * - analyzeMaterialNeeds()
 * - aggregateMaterialCounts()
 * - analyzeScaffoldingSupport()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/generationPolicy.ts
 * - src/lib/placementWarnings.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysisCache.ts
 * - src/lib/suppressLoadMarkers.ts
 * - src/lib/tileGeometry.ts
 */
import { TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX } from "../data/mapColors";
import { DEFAULT_MINECRAFT_VERSION } from "@/data/defaultSettings";
import { MINECRAFT_VERSIONS } from "@/data/minecraftVersions";
import { getBlockSupport } from "./blockSupport";
import { Shade, type ColorGrid } from "@/types/color";
import { MAP_SIZE, TRANSPARENT_COLOR, isTransparentColor, isWaterColor } from "@/utils/color";
import { FillerRole, type FillerAssignment } from "@/types/conversion";
import { buildFillerAssignmentMap, resolveAssignedFillerName } from "./fillerRules";
import { normalizeBlockId, resolveShapeColorBlockName, type ColorBlockSelections } from "./blockId";
import { getColorRefKey } from "./colorRefs";
import { ShapePartType, type GeneratedShape, type ShapePart } from "@/types/shape";
import { forEachSuppressClearanceCell, getSuppressClearancePlan } from "./suppressClearance";
import {
  resolveShapeFiller,
  isShapeColorCell,
  isShapeFillerCell,
  isWithinShapeBounds,
  NO_SUPPORT_FLOORS,
  parseShapeCoordKey,
  toShapeCoordKey,
  shouldIncludeFragileSupportCell,
} from "./shapeModel";

interface FillerNeedStats {
  roleCounts: Map<FillerRole, number>;
}

interface FillerRolePixel {
  x: number;
  z: number;
  role: FillerRole;
}

interface MaterialNeedStats {
  blockCounts: Record<string, number>;
  colorCounts: Record<string, number>;
  numUniqueColorShadesForPart: number;
  fillerRoleCounts: Map<FillerRole, number>;
  supportNeeds: SupportNeeds;
  retainedState?: { blocks: ReadonlyMap<number, RetainedMaterial>; pixelMask: Uint8Array };
}

interface SupportNeeds {
  aboveFloor: number;
  atFloor: number;
  constrainedBlocks: Set<string>;
}

type MaterialAnalysisOptions = ColorBlockSelections & {
  fillerAssignments: FillerAssignment[];
  applySupportFloorYs: boolean;
  xColumnRange?: [number, number];
  zColumnRange?: [number, number];
  phaseRange?: [number, number];
  keepSuppressExtras?: boolean;
};

type RetainedMaterial = {
  blockName: string;
  colorKey?: number;
  visibleKey?: number;
  role?: FillerRole;
  waterColumn?: number;
};

interface PartMaterialNeedStats {
  blockCounts: Record<string, number>;
  colorCounts: Record<string, number>;
  visibleColorKeys: Set<number>;
  fillerRoleCounts: Map<FillerRole, number>;
  supportNeeds: SupportNeeds;
}

function emptySupportNeeds(): SupportNeeds {
  return { aboveFloor: 0, atFloor: 0, constrainedBlocks: new Set() };
}

function mergeSupportNeeds(into: SupportNeeds, from: SupportNeeds, phases: boolean): void {
  into.aboveFloor = phases ? Math.max(into.aboveFloor, from.aboveFloor) : into.aboveFloor + from.aboveFloor;
  into.atFloor = phases ? Math.max(into.atFloor, from.atFloor) : into.atFloor + from.atFloor;
  for (const block of from.constrainedBlocks) into.constrainedBlocks.add(block);
}

function addCount(map: Record<string, number>, key: string, amount = 1): void {
  map[key] = (map[key] || 0) + amount;
}

function maximizeCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [key, count] of Object.entries(from)) {
    into[key] = Math.max(into[key] || 0, count);
  }
}

function maximizeRoleCounts(into: Map<FillerRole, number>, from: Map<FillerRole, number>): void {
  for (const [role, count] of from) {
    into.set(role, Math.max(into.get(role) ?? 0, count));
  }
}

function addRoleCount(map: Map<FillerRole, number>, role: FillerRole, amount = 1): void {
  map.set(role, (map.get(role) ?? 0) + amount);
}

function getVisibleColorShadeKey(colorGrid: ColorGrid, x: number, z: number): number | null {
  const color = z >= 0 && z < MAP_SIZE ? colorGrid[x][z] : TRANSPARENT_COLOR;
  if (isTransparentColor(color)) return null;
  return getColorRefKey(color) * 4 + color.shade;
}

// Check resolved placements, not optional support cells or their unfiltered roles.
export function analyzeScaffoldingSupport(
  shapes: Iterable<GeneratedShape>, selections: ColorBlockSelections,
  assignments: readonly FillerAssignment[], assumeFloor: boolean,
) {
  const result = { roles: new Set<FillerRole>(), colors: false };
  if (![...assignments.map(({ block }) => block), ...Object.values(selections.selectedBlocks),
    ...Object.values(selections.selectedBlocksCustom)].some(block => normalizeBlockId(block) === "scaffolding")) return result;
  const fillers = buildFillerAssignmentMap(assignments);
  const bases = new Map<string, boolean>();
  const dataVersion = MINECRAFT_VERSIONS[selections.minecraftVersion ?? DEFAULT_MINECRAFT_VERSION].dataVersion;
  const connections = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (const shape of shapes) for (const part of shape.parts) {
    const resolved = new Map<number, { blockName: string; role?: FillerRole } | null>();
    const floors = assumeFloor ? part.supportFloorYs : NO_SUPPORT_FLOORS;
    const at = (coord: number) => {
      if (resolved.has(coord)) return resolved.get(coord)!;
      const cell = part.cells.get(coord);
      let value: { blockName: string; role?: FillerRole } | null = null;
      if (cell && isShapeColorCell(cell)) {
        const blockName = resolveShapeColorBlockName(cell, selections, fillers);
        if (blockName) value = { blockName, role: cell.fillerRole };
      } else if (cell) {
        const [x, y, z] = parseShapeCoordKey(coord);
        if (isWithinShapeBounds({ x, y, z }, part.bounds, floors)) {
          const filler = resolveShapeFiller(part, coord, cell, selections, fillers);
          if (filler?.blockName) value = { blockName: filler.blockName, role: filler.role };
        }
      }
      resolved.set(coord, value);
      return value;
    };
    const scaffolds = new Map<number, FillerRole | undefined>();
    for (const coord of part.cells.keys()) {
      const value = at(coord);
      if (value && normalizeBlockId(value.blockName) === "scaffolding") scaffolds.set(coord, value.role);
    }
    if (!scaffolds.size) continue;
    const distances = new Map<number, number>();
    const queue: number[] = [];
    for (const coord of scaffolds.keys()) {
      const [x, y, z] = parseShapeCoordKey(coord);
      const below = toShapeCoordKey(x, y - 1, z);
      const block = at(below)?.blockName ?? "";
      if (!bases.has(block)) bases.set(block, getBlockSupport(block, dataVersion).full);
      if ((!block && floors.has(y - 1)) || (!scaffolds.has(below) && bases.get(block))) {
        distances.set(coord, 0);
        queue.push(coord);
      }
    }
    // Vertical scaffold connections preserve distance; horizontal ones cost one.
    // No connection propagates downward. Seven horizontal blocks is unsupported.
    for (let i = 0; i < queue.length && distances.size < scaffolds.size; i++) {
      const coord = queue[i];
      const distance = distances.get(coord)!;
      const [x, y, z] = parseShapeCoordKey(coord);
      for (const [dx, dy, dz] of connections) {
        const next = toShapeCoordKey(x + dx, y + dy, z + dz);
        const nextDistance = distance + (dy ? 0 : 1);
        if (!scaffolds.has(next) || nextDistance >= (distances.get(next) ?? 7)) continue;
        distances.set(next, nextDistance);
        queue.push(next);
      }
    }
    for (const [coord, role] of scaffolds) if (!distances.has(coord)) {
      if (role) result.roles.add(role);
      else result.colors = true;
    }
  }
  return result;
}

// Retained blocks are counted during replay; collecting them skips unused per-part totals.
function analyzePartMaterialNeeds(
  colorGrid: ColorGrid,
  part: ShapePart,
  fillerAssignments: Map<FillerRole, string>,
  options: MaterialAnalysisOptions,
  applyColumnRange: boolean,
  supportFloorYs: ReadonlySet<number>,
  materials?: Map<number, RetainedMaterial>,
  materialFloor = 0,
): PartMaterialNeedStats {
  const blockCounts: Record<string, number> = {};
  const colorCounts: Record<string, number> = {};
  const visibleColorKeys = new Set<number>();
  const fillerRoleCounts = new Map<FillerRole, number>();
  const countedVisibleWaterColumns = new Set<number>();
  const countedRealWaterColumns = new Set<number>();
  const colorBlockNames = new Map<number, string | null>();
  const supportNeeds = emptySupportNeeds();
  for (const [coord, cell] of part.cells) {
    const [x, y, z] = parseShapeCoordKey(coord);
    if (applyColumnRange && options.xColumnRange && (x < options.xColumnRange[0] || x > options.xColumnRange[1])) continue;
    // Include the north border with row 0, matching the clearing schedule.
    if (applyColumnRange && options.zColumnRange && (Math.max(0, z) < options.zColumnRange[0] || z > options.zColumnRange[1])) continue;
    const materialCoord = materials ? toShapeCoordKey(x, y - materialFloor, z) : coord;

    if (isShapeColorCell(cell)) {
      // A support reused as color still needs its material, even at floor level.
      if (cell.fillerRole === FillerRole.SupportRetained) ++supportNeeds.aboveFloor;
      const isWaterColorCell = !cell.isCustom && cell.id === WATER_BASE_INDEX;
      const waterColumnKey = isWaterColorCell ? (x * 128 + z) : -1;
      if (!materials && (!isWaterColorCell || !countedVisibleWaterColumns.has(waterColumnKey))) {
        if (isWaterColorCell) countedVisibleWaterColumns.add(waterColumnKey);
        if (!cell.fillerRole) {
          const key = getColorRefKey(cell);
          colorCounts[key] = (colorCounts[key] ?? 0) + 1;
        }
        const visibleKey = getVisibleColorShadeKey(colorGrid, x, z);
        if (visibleKey !== null) visibleColorKeys.add(visibleKey);
      }

      if (cell.fillerRole) {
        const blockName = resolveShapeColorBlockName(cell, options, fillerAssignments);
        if (blockName) {
          const blockId = normalizeBlockId(blockName);
          if (!materials) {
            addRoleCount(fillerRoleCounts, cell.fillerRole);
            addCount(blockCounts, blockId);
          }
          materials?.set(materialCoord, {
            blockName: blockId, role: cell.fillerRole,
            visibleKey: getVisibleColorShadeKey(colorGrid, x, z) ?? undefined,
          });
        }
        continue;
      }

      const colorKey = getColorRefKey(cell);
      let blockName = colorBlockNames.get(colorKey);
      if (blockName === undefined) {
        const resolved = resolveShapeColorBlockName(cell, options);
        blockName = resolved ? normalizeBlockId(resolved) : null;
        colorBlockNames.set(colorKey, blockName);
      }
      if (!blockName) continue;
      if (materials) {
        const visibleKey = getVisibleColorShadeKey(colorGrid, x, z);
        materials.set(materialCoord, {
          blockName, colorKey, visibleKey: visibleKey ?? undefined,
          waterColumn: isWaterColorCell ? x * (MAP_SIZE + 1) + z + 1 : undefined,
        });
        continue;
      }
      if (isWaterColorCell && blockName === "water") {
        if (countedRealWaterColumns.has(waterColumnKey)) continue;
        countedRealWaterColumns.add(waterColumnKey);
      }
      addCount(blockCounts, blockName);
      continue;
    }

    if (!isWithinShapeBounds({ x, y, z }, part.bounds, NO_SUPPORT_FLOORS)) continue;
    // Demand is independent of the selected support mode/block. Keep floor demand
    // separate: explicit Flat supports override assumed floors for export, not eligibility.
    if (cell.includes(FillerRole.CoralSupport) || cell.includes(FillerRole.SupportRetained) || (cell.includes(FillerRole.SupportFragile)
      && shouldIncludeFragileSupportCell(part, coord, cell, FillerRole.SupportFragile, options, fillerAssignments))) {
      if (part.supportFloorYs.has(y)) ++supportNeeds.atFloor;
      else ++supportNeeds.aboveFloor;
    }
    if (supportFloorYs.has(y)) continue;
    const resolved = resolveShapeFiller(part, coord, cell, options, fillerAssignments);
    if (!resolved) continue;
    if (resolved.constrainedBlock) supportNeeds.constrainedBlocks.add(resolved.constrainedBlock);
    const { role, blockName: fillerName } = resolved;
    // A substituted substrate is inventory, but is not the material named in the toolbar.
    const assignedRole = options.autoPickSupports && fillerName && (resolved.constrainedBlock || role === FillerRole.CoralSupport)
      && normalizeBlockId(fillerName) !== normalizeBlockId(fillerAssignments.get(role) ?? "") ? undefined : role;
    if (
      !materials && assignedRole &&
      (
        (assignedRole !== FillerRole.SupportWaterSides && assignedRole !== FillerRole.SupportWaterSidesCovered) ||
        !!resolveAssignedFillerName(fillerAssignments, assignedRole)
      )
    ) {
      addRoleCount(fillerRoleCounts, assignedRole);
    }
    if (!fillerName) continue;
    const blockId = normalizeBlockId(fillerName);
    if (!materials) addCount(blockCounts, blockId);
    materials?.set(materialCoord, { blockName: blockId, role: assignedRole ?? undefined });
  }

  return { blockCounts, colorCounts, visibleColorKeys, fillerRoleCounts, supportNeeds };
}

// Cache one range-preview preparation, not resolved phases for every tile/settings combination.
let retainedPreviewCache: {
  shape: GeneratedShape;
  colorGrid: ColorGrid;
  options: MaterialAnalysisOptions;
  prepared: {
    plan: NonNullable<ReturnType<typeof getSuppressClearancePlan>>;
    parts: Map<number, RetainedMaterial>[];
    supportNeeds: SupportNeeds[];
    maxHeight: number;
  };
} | undefined;

function prepareRetainedMaterials(
  colorGrid: ColorGrid,
  shape: GeneratedShape,
  options: MaterialAnalysisOptions,
) {
  const cached = retainedPreviewCache;
  // Selections are immutable React inputs. Range changes do not change material resolution.
  if (cached?.shape === shape && cached.colorGrid === colorGrid &&
    cached.options.selectedBlocks === options.selectedBlocks &&
    cached.options.selectedBlocksCustom === options.selectedBlocksCustom &&
    cached.options.customColors === options.customColors &&
    cached.options.minecraftVersion === options.minecraftVersion &&
    cached.options.autoPickSupports === options.autoPickSupports &&
    cached.options.fillerAssignments === options.fillerAssignments &&
    cached.options.applySupportFloorYs === options.applySupportFloorYs) return cached.prepared;
  const plan = getSuppressClearancePlan(shape)!;
  const fillerAssignments = buildFillerAssignmentMap(options.fillerAssignments);
  let maxHeight = 0;
  const supportNeeds: SupportNeeds[] = [];
  const parts = shape.parts.map((part, index) => {
    const materials = new Map<number, RetainedMaterial>();
    const stats = analyzePartMaterialNeeds(colorGrid, part, fillerAssignments, options, false,
      options.applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS, materials, plan[index].floor);
    supportNeeds.push(stats.supportNeeds);
    if (plan[index].columns.size) {
      for (const coord of materials.keys()) maxHeight = Math.max(maxHeight, parseShapeCoordKey(coord)[1]);
    }
    return materials;
  });
  const prepared = { plan, parts, maxHeight, supportNeeds };
  if (options.phaseRange) retainedPreviewCache = { shape, colorGrid, options, prepared };
  return prepared;
}

function analyzeRetainedMaterialNeeds(
  colorGrid: ColorGrid,
  shape: GeneratedShape,
  options: MaterialAnalysisOptions,
): MaterialNeedStats {
  const [start, end] = options.phaseRange ?? [0, shape.parts.length - 1];
  const { plan, parts, maxHeight, supportNeeds: phaseSupportNeeds } = prepareRetainedMaterials(colorGrid, shape, options);
  const supportNeeds = emptySupportNeeds();
  const world = new Map<number, RetainedMaterial>();
  const currentBlocks: Record<string, number> = {};
  const currentColors: Record<string, number> = {};
  const currentRoles = new Map<FillerRole, number>();
  const currentVisible = new Map<number, number>();
  const waterColors = new Map<number, number>();
  const waterBlocks = new Map<number, number>();
  const blockCounts: Record<string, number> = {};
  const colorCounts: Record<string, number> = {};
  const fillerRoleCounts = new Map<FillerRole, number>();
  const visibleColorKeys = new Set<number>();
  const adjustCount = (counts: Record<string, number>, key: string, amount: number) => {
    addCount(counts, key, amount);
    if (counts[key] === 0) delete counts[key];
  };
  const adjustColumn = (counts: Map<number, number>, key: number, amount: number) => {
    const before = counts.get(key) ?? 0;
    const after = before + amount;
    if (after) counts.set(key, after);
    else counts.delete(key);
    return Number(after > 0) - Number(before > 0);
  };
  const adjust = (material: RetainedMaterial, amount: number) => {
    const { blockName, colorKey, visibleKey, role, waterColumn } = material;
    // Water inventory/visible colors count columns, not flowing-water depth cells.
    adjustCount(currentBlocks, blockName, waterColumn !== undefined && blockName === "water"
      ? adjustColumn(waterBlocks, waterColumn, amount) : amount);
    if (colorKey !== undefined) adjustCount(currentColors, String(colorKey), waterColumn !== undefined
      ? adjustColumn(waterColors, waterColumn, amount) : amount);
    if (role !== undefined) {
      addRoleCount(currentRoles, role, amount);
      if (currentRoles.get(role) === 0) currentRoles.delete(role);
    }
    if (visibleKey !== undefined) adjustColumn(currentVisible, visibleKey, amount);
  };
  const remove = (coord: number) => {
    const material = world.get(coord);
    if (!material) return;
    adjust(material, -1);
    world.delete(coord);
  };
  // Replay the prefix even for a selected phase range: earlier leftovers still occupy inventory.
  for (let index = 0; index <= end && index < parts.length; ++index) {
    const part = parts[index];
    forEachSuppressClearanceCell(plan[index].columns, 0, maxHeight, coord => {
      if (!part.has(coord)) remove(coord);
    });
    for (const [coord, material] of part) {
      remove(coord);
      world.set(coord, material);
      adjust(material, 1);
    }
    if (index < start) continue;
    mergeSupportNeeds(supportNeeds, phaseSupportNeeds[index], true);
    maximizeCounts(blockCounts, currentBlocks);
    maximizeCounts(colorCounts, currentColors);
    maximizeRoleCounts(fillerRoleCounts, currentRoles);
    for (const key of currentVisible.keys()) visibleColorKeys.add(key);
  }
  // Only the selected range retains its world for preview; whole-tile caches stay small.
  let retainedPixelMask: Uint8Array | undefined;
  if (options.phaseRange) {
    retainedPixelMask = new Uint8Array(MAP_SIZE * MAP_SIZE);
    for (const coord of world.keys()) {
      const [x, y, z] = parseShapeCoordKey(coord);
      if (y >= 0 && x >= 0 && x < MAP_SIZE && z >= 0 && z < MAP_SIZE) retainedPixelMask[z * MAP_SIZE + x] = 1;
    }
    for (let index = start; index <= end && index < parts.length; ++index) {
      for (const coord of parts[index].keys()) {
        const [x, , z] = parseShapeCoordKey(coord);
        if (x >= 0 && x < MAP_SIZE && z >= 0 && z < MAP_SIZE) retainedPixelMask[z * MAP_SIZE + x] = 0;
      }
    }
  }
  return {
    blockCounts, colorCounts, fillerRoleCounts, supportNeeds, numUniqueColorShadesForPart: visibleColorKeys.size,
    ...(retainedPixelMask ? { retainedState: { blocks: world, pixelMask: retainedPixelMask } } : {}),
  };
}

// Callers:
// - src/lib/shapeAnalysisCache.ts
// - src/lib/tileGeometry.ts
export function analyzeFillerNeeds(shape: GeneratedShape): FillerNeedStats {
  const roleCounts = new Map<FillerRole, number>();

  for (const part of shape.parts) {
    for (const [, cell] of part.cells) {
      // Reused color cells still depend on their support/shade assignment.
      if (isShapeColorCell(cell)) {
        if (cell.fillerRole) addRoleCount(roleCounts, cell.fillerRole);
      } else for (const role of cell) addRoleCount(roleCounts, role);
    }
  }

  return { roleCounts };
}

// Callers:
// - src/Index.tsx
export function hasStairStepSupport(shape: GeneratedShape, applySupportFloorYs: boolean): boolean {
  return shape.parts.some(part => {
    const supportFloorYs = applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
    return part.cells.entries().some(([coord, cell]) => {
      if (!isShapeFillerCell(cell) || !cell.includes(FillerRole.StairStep)) return false;
      const [x, y, z] = parseShapeCoordKey(coord);
      return isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs);
    });
  });
}

// Callers:
// - src/lib/previewImageEdits.ts
// - src/lib/suppressLoadMarkers.ts
export function collectFillerRolePixels(
  shape: GeneratedShape,
  roles: readonly FillerRole[],
  xColumnRange?: [number, number],
  zColumnRange?: [number, number],
): FillerRolePixel[] {
  const roleSet = new Set<FillerRole>(roles);
  const pixels = new Map<number, FillerRole>();

  for (const part of shape.parts) {
    for (const [coord, cell] of part.cells) {
      if (!isShapeFillerCell(cell)) continue;
      const role = cell.find(entry => roleSet.has(entry));
      if (!role) continue;

      const [x, , z] = parseShapeCoordKey(coord);
      if (xColumnRange && (x < xColumnRange[0] || x > xColumnRange[1])) continue;
      if (zColumnRange && (z < zColumnRange[0] || z > zColumnRange[1])) continue;
      if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) continue;

      pixels.set(x * MAP_SIZE + z, role);
    }
  }

  return Array.from(pixels, ([key, role]) => ({ x: Math.floor(key / MAP_SIZE), z: key % MAP_SIZE, role }));
}

// Callers:
// - src/lib/shapeAnalysisCache.ts
// - src/lib/tileGeometry.ts
export function nooblineIsSingleY(shape: GeneratedShape): boolean {
  let northY: number | undefined;
  for (const part of shape.parts) {
    for (const [coord, cell] of part.cells) {
      if (
        !isShapeFillerCell(cell) ||
        (!cell.includes(FillerRole.ShadeNorthRow) &&
          !cell.includes(FillerRole.ShadeNorthRowBreakable) &&
          !cell.includes(FillerRole.ShadeNorthRowPushable))
      ) continue;
      const [, y] = parseShapeCoordKey(coord);
      if (northY === undefined) northY = y;
      else if (northY !== y) return false;
    }
  }
  return true;
}

// Callers:
// - src/lib/tileGeometry.ts
export function hasNonWaterColorHeightVariance(shape: GeneratedShape): boolean {
  let firstY: number | undefined;
  for (const part of shape.parts) {
    for (const [coord, cell] of part.cells) {
      if (!isShapeColorCell(cell)) continue;
      if (!cell.isCustom && cell.id === TRANSPARENCY_BASE_INDEX) continue;
      if (!cell.isCustom && cell.id === WATER_BASE_INDEX) continue;
      const [, y] = parseShapeCoordKey(coord);
      if (firstY === undefined) firstY = y;
      else if (firstY !== y) return true;
    }
  }
  return false;
}

// Callers:
// - src/lib/generationPolicy.ts
export function hasBuildAtWorldMinYOpportunity(
  colorGrid: ColorGrid,
  shape: GeneratedShape,
  applySupportFloorYs: boolean,
): boolean {
  let minY = Infinity;

  for (const part of shape.parts) {
    const supportFloorYs = applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
    for (const [coord, cell] of part.cells) {
      const [x, y, z] = parseShapeCoordKey(coord);
      if (!isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs)) continue;
      if (isShapeColorCell(cell) && !cell.isCustom && cell.id === TRANSPARENCY_BASE_INDEX) continue;
      if (y < minY) minY = y;
    }
  }

  if (!Number.isFinite(minY)) return false;

  for (const part of shape.parts) {
    const supportFloorYs = applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
    for (const [coord, cell] of part.cells) {
      if (!isShapeColorCell(cell)) continue;
      const [x, y, z] = parseShapeCoordKey(coord);
      if (!isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs)) continue;
      if (y !== minY || z <= 0) continue;

      const color = colorGrid[x][z];
      if (isTransparentColor(color) || isWaterColor(color)) continue;
      if (!isTransparentColor(colorGrid[x][z - 1])) continue;
      if (color.shade !== Shade.Flat) continue;
      return true;
    }
  }

  return false;
}

// Callers:
// - src/Index.tsx
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysisCache.ts
export function analyzeMaterialNeeds(
  colorGrid: ColorGrid,
  shape: GeneratedShape,
  options: MaterialAnalysisOptions,
): MaterialNeedStats {
  if (options.keepSuppressExtras && shape.partType === ShapePartType.SuppressStepPhases && shape.suppressStepLayout) {
    return analyzeRetainedMaterialNeeds(colorGrid, shape, options);
  }
  const fillerAssignments = buildFillerAssignmentMap(options.fillerAssignments);
  const supportNeeds = emptySupportNeeds();
  if (shape.partType === ShapePartType.SuppressStepPhases) {
    const [start, end] = options.phaseRange ?? [0, shape.parts.length - 1];
    const blockCounts: Record<string, number> = {};
    const colorCounts: Record<string, number> = {};
    const visibleColorKeys = new Set<number>();
    const fillerRoleCounts = new Map<FillerRole, number>();

    for (let i = start; i <= end && i < shape.parts.length; ++i) {
      const part = shape.parts[i];
      const supportFloorYs = options.applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
      const step = analyzePartMaterialNeeds(
        colorGrid,
        part,
        fillerAssignments,
        options,
        false,
        supportFloorYs,
      );
      maximizeCounts(blockCounts, step.blockCounts);
      maximizeCounts(colorCounts, step.colorCounts);
      for (const key of step.visibleColorKeys) visibleColorKeys.add(key);
      maximizeRoleCounts(fillerRoleCounts, step.fillerRoleCounts);
      mergeSupportNeeds(supportNeeds, step.supportNeeds, true);
    }

    return {
      blockCounts,
      colorCounts,
      numUniqueColorShadesForPart: visibleColorKeys.size,
      fillerRoleCounts,
      supportNeeds,
    };
  }

  const blockCounts: Record<string, number> = {};
  const colorCounts: Record<string, number> = {};
  const visibleColorKeys = new Set<number>();
  const fillerRoleCounts = new Map<FillerRole, number>();

  for (const part of shape.parts) {
    const supportFloorYs = options.applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
    const stats = analyzePartMaterialNeeds(
      colorGrid,
      part,
      fillerAssignments,
      options,
      true,
      supportFloorYs,
    );
    for (const [key, count] of Object.entries(stats.blockCounts)) addCount(blockCounts, key, count);
    for (const [key, count] of Object.entries(stats.colorCounts)) addCount(colorCounts, key, count);
    for (const key of stats.visibleColorKeys) visibleColorKeys.add(key);
    for (const [role, count] of stats.fillerRoleCounts) addRoleCount(fillerRoleCounts, role, count);
    mergeSupportNeeds(supportNeeds, stats.supportNeeds, false);
  }

  return {
    blockCounts,
    colorCounts,
    numUniqueColorShadesForPart: visibleColorKeys.size,
    fillerRoleCounts,
    supportNeeds,
  };
}

type MaterialCountsLike = Pick<MaterialNeedStats, "blockCounts" | "colorCounts" | "fillerRoleCounts">;

// Callers:
// - src/Index.tsx
export function aggregateMaterialCounts(
  stats: readonly MaterialCountsLike[],
  mode: "sum" | "max",
): MaterialCountsLike {
  const blockCounts: Record<string, number> = {};
  const colorCounts: Record<string, number> = {};
  const fillerRoleCounts = new Map<FillerRole, number>();

  for (const stat of stats) {
    for (const [blockName, count] of Object.entries(stat.blockCounts)) {
      blockCounts[blockName] = mode === "sum"
        ? (blockCounts[blockName] || 0) + count
        : Math.max(blockCounts[blockName] || 0, count);
    }
    for (const [colorKey, count] of Object.entries(stat.colorCounts)) {
      colorCounts[colorKey] = mode === "sum"
        ? (colorCounts[colorKey] || 0) + count
        : Math.max(colorCounts[colorKey] || 0, count);
    }
    for (const [role, count] of stat.fillerRoleCounts) {
      fillerRoleCounts.set(role, mode === "sum"
        ? (fillerRoleCounts.get(role) ?? 0) + count
        : Math.max(fillerRoleCounts.get(role) ?? 0, count),
      );
    }
  }

  return { blockCounts, colorCounts, fillerRoleCounts };
}
