/**
 * Public API:
 * - analyzeFillerNeeds()
 * - collectFillerRolePixels()
 * - nooblineIsSingleY()
 * - hasNonWaterColorHeightVariance()
 * - hasBuildAtWorldMinYOpportunity()
 * - analyzeFragileSupportOverrideNeeds()
 * - analyzeMaterialNeeds()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/previewImageEdits.ts
 */
import { TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX } from "../data/mapColors";
import { type ColorGrid, Shade } from "@/types/color";
import type { ShapePart } from "@/types/shape";
import { MAP_SIZE, TRANSPARENT_COLOR, isTransparentColor, isWaterColor } from "@/utils/color";
import { FillerRole, type FillerAssignment } from "@/types/conversion";
import { buildFillerAssignmentMap, resolveAssignedFillerName, resolveCellAssignedRole, resolveCellFillerName } from "./fillerRules";
import { type ColorBlockSelections, resolveExportBlockName, resolveShapeColorBlockName, toDisplayName } from "./blockId";
import { addColorRefCount, getColorRefKey } from "./colorRefs";
import { ShapePartType, type GeneratedShape } from "@/types/shape";
import {
  getFragileSupportOverride,
  isShapeColorCell,
  isShapeFillerCell,
  isWithinShapeBounds,
  NO_SUPPORT_FLOORS,
  parseShapeCoordKey,
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
}

interface FragileSupportOverrideNeedStats {
  overrideCounts: Record<string, number>;
}

type MaterialAnalysisOptions = ColorBlockSelections & {
  fillerAssignments: FillerAssignment[];
  applySupportFloorYs: boolean;
  xColumnRange?: [number, number];
  phaseRange?: [number, number];
};

interface PartMaterialNeedStats {
  blockCounts: Record<string, number>;
  colorCounts: Record<string, number>;
  visibleColorKeys: Set<number>;
  fillerRoleCounts: Map<FillerRole, number>;
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

function isRealWaterBlockName(blockName: string): boolean {
  return blockName.split("[", 1)[0] === "minecraft:water";
}

function analyzePartMaterialNeeds(
  colorGrid: ColorGrid,
  part: ShapePart,
  fillerAssignments: Map<FillerRole, string>,
  options: MaterialAnalysisOptions,
  applyColumnRange: boolean,
  supportFloorYs: ReadonlySet<number>,
): PartMaterialNeedStats {
  const blockCounts: Record<string, number> = {};
  const colorCounts: Record<string, number> = {};
  const visibleColorKeys = new Set<number>();
  const fillerRoleCounts = new Map<FillerRole, number>();
  const countedVisibleWaterColumns = new Set<number>();
  const countedRealWaterColumns = new Set<number>();
  for (const [coord, cell] of part.cells) {
    const [x, y, z] = parseShapeCoordKey(coord);
    if (applyColumnRange && options.xColumnRange && (x < options.xColumnRange[0] || x > options.xColumnRange[1])) continue;

    if (isShapeColorCell(cell)) {
      const isWaterColorCell = !cell.isCustom && cell.id === WATER_BASE_INDEX;
      const waterColumnKey = isWaterColorCell ? (x * 128 + z) : -1;
      if (!isWaterColorCell || !countedVisibleWaterColumns.has(waterColumnKey)) {
        if (isWaterColorCell) countedVisibleWaterColumns.add(waterColumnKey);
        addColorRefCount(colorCounts, cell);
        const visibleKey = getVisibleColorShadeKey(colorGrid, x, z);
        if (visibleKey !== null) visibleColorKeys.add(visibleKey);
      }

      const blockName = resolveShapeColorBlockName(cell, options);
      if (!blockName) continue;
      if (isWaterColorCell && isRealWaterBlockName(blockName)) {
        if (countedRealWaterColumns.has(waterColumnKey)) continue;
        countedRealWaterColumns.add(waterColumnKey);
      }
      const displayName = toDisplayName(blockName);
      addCount(blockCounts, displayName);
      continue;
    }

    const assignedRole = resolveCellAssignedRole(cell, options.fillerAssignments);
    if (!shouldIncludeFragileSupportCell(part, coord, cell, assignedRole, options)) continue;
    if (!isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs)) continue;
    if (
      assignedRole &&
      (
        (assignedRole !== FillerRole.SupportWaterSides && assignedRole !== FillerRole.SupportWaterSidesCovered) ||
        !!resolveAssignedFillerName(fillerAssignments, assignedRole)
      )
    ) {
      addRoleCount(fillerRoleCounts, assignedRole);
    }
    const assignedSupportBlock = assignedRole ? (fillerAssignments.get(assignedRole) ?? null) : null;
    const override = getFragileSupportOverride(part, coord, assignedRole, assignedSupportBlock, options);
    const fillerName = override
      ? resolveExportBlockName(override.replacementBlockId)
      : resolveCellFillerName(cell, options.fillerAssignments, fillerAssignments);
    if (!fillerName) continue;
    const displayName = toDisplayName(fillerName);
    addCount(blockCounts, displayName);
  }

  return { blockCounts, colorCounts, visibleColorKeys, fillerRoleCounts };
}

// Callers:
// - src/Index.tsx
export function analyzeFillerNeeds(shape: GeneratedShape): FillerNeedStats {
  const roleCounts = new Map<FillerRole, number>();

  for (const part of shape.parts) {
    for (const [, cell] of part.cells) {
      if (!isShapeFillerCell(cell)) continue;
      for (const role of cell) {
        roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
      }
    }
  }

  return { roleCounts };
}

// Callers:
// - src/Index.tsx
// - src/lib/previewImageEdits.ts
export function collectFillerRolePixels(
  shape: GeneratedShape,
  roles: readonly FillerRole[],
  xColumnRange?: [number, number],
): FillerRolePixel[] {
  const roleSet = new Set<FillerRole>(roles);
  const pixels = new Map<string, FillerRole>();

  for (const part of shape.parts) {
    for (const [coord, cell] of part.cells) {
      if (!isShapeFillerCell(cell)) continue;
      const role = cell.find(entry => roleSet.has(entry));
      if (!role) continue;

      const [x, , z] = parseShapeCoordKey(coord);
      if (xColumnRange && (x < xColumnRange[0] || x > xColumnRange[1])) continue;
      if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) continue;

      pixels.set(`${x},${z}`, role);
    }
  }

  return Array.from(pixels.entries(), ([key, role]) => {
    const [x, z] = key.split(",").map(Number);
    return { x, z, role };
  });
}

// Callers:
// - src/Index.tsx
export function nooblineIsSingleY(shape: GeneratedShape): boolean {
  let northY: number | undefined;
  for (const part of shape.parts) {
    for (const [coord, cell] of part.cells) {
      if (!isShapeFillerCell(cell) || !cell.includes(FillerRole.ShadeNorthRow)) continue;
      const [, y] = parseShapeCoordKey(coord);
      if (northY === undefined) northY = y;
      else if (northY !== y) return false;
    }
  }
  return true;
}

// Callers:
// - src/Index.tsx
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
// - src/Index.tsx
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
export function analyzeFragileSupportOverrideNeeds(
  shape: GeneratedShape,
  options: MaterialAnalysisOptions,
): FragileSupportOverrideNeedStats {
  const overrideCounts: Record<string, number> = {};
  const fillerAssignments = buildFillerAssignmentMap(options.fillerAssignments);

  const analyzePart = (part: ShapePart, applyColumnRange: boolean) => {
    const supportFloorYs = options.applySupportFloorYs ? part.supportFloorYs : NO_SUPPORT_FLOORS;
    for (const [coord, cell] of part.cells) {
      if (!isShapeFillerCell(cell)) continue;
      const [x, y, z] = parseShapeCoordKey(coord);
      if (applyColumnRange && options.xColumnRange && (x < options.xColumnRange[0] || x > options.xColumnRange[1])) continue;
      const assignedRole = resolveCellAssignedRole(cell, options.fillerAssignments);
      if (!assignedRole) continue;
      if (!shouldIncludeFragileSupportCell(part, coord, cell, assignedRole, options)) continue;
      if (!isWithinShapeBounds({ x, y, z }, part.bounds, supportFloorYs)) continue;
      const assignedSupportBlock = fillerAssignments.get(assignedRole) ?? null;
      const override = getFragileSupportOverride(part, coord, assignedRole, assignedSupportBlock, options);
      if (!override) continue;
      addCount(overrideCounts, override.blockId);
    }
  };

  if (shape.partType === ShapePartType.SuppressStepPhases) {
    const [start, end] = options.phaseRange ?? [0, shape.parts.length - 1];
    for (let i = start; i <= end && i < shape.parts.length; ++i) analyzePart(shape.parts[i], false);
    return { overrideCounts };
  }

  for (const part of shape.parts) analyzePart(part, true);
  return { overrideCounts };
}

// Callers:
// - src/Index.tsx
export function analyzeMaterialNeeds(
  colorGrid: ColorGrid,
  shape: GeneratedShape,
  options: MaterialAnalysisOptions,
): MaterialNeedStats {
  const fillerAssignments = buildFillerAssignmentMap(options.fillerAssignments);

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
    }

    return {
      blockCounts,
      colorCounts,
      numUniqueColorShadesForPart: visibleColorKeys.size,
      fillerRoleCounts,
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
  }

  return {
    blockCounts,
    colorCounts,
    numUniqueColorShadesForPart: visibleColorKeys.size,
    fillerRoleCounts,
  };
}
