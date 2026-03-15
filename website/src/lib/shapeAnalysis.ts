/**
 * Public API:
 * - analyzeFillerNeeds()
 * - northRowIsSingleLine()
 * - hasColorHeightVariance()
 * - analyzeMaterialNeeds()
 *
 * Callers:
 * - src/Index.tsx
 */
import { type ColorGrid, getColorCell, isTransparentColor } from "./colorGridTypes";
import { FillerRole, type CustomColor, type FillerAssignment } from "./conversionTypes";
import { buildFillerAssignmentMap, resolveAssignedFillerName, resolveCellAssignedRole, resolveCellFillerName } from "./fillerRules";
import { resolveShapeColorBlockName, toDisplayName } from "./materialRules";
import type { GeneratedShape } from "./shapeGeneration";
import { isShapeColorCell, isShapeFillerCell, parseShapeCoordKey, type ShapePart, ShapePartType } from "./shapeTypes";
import { isWithinShapeBounds, shouldIncludeFragileSupportCell } from "./shapeCellRules";

interface FillerNeedStats {
  roleCounts: Map<FillerRole, number>;
}

interface MaterialNeedStats {
  blockCounts: Record<string, number>;
  baseColorCounts: Record<number, number>;
  numUniqueColorShadesForPart: number;
  usedShadesByBase: Map<number, Set<number>>;
  fillerRoleCounts: Map<FillerRole, number>;
}

type MaterialAnalysisOptions = {
  blockMapping: Record<number, string>;
  customColors: CustomColor[];
  fillerAssignments: FillerAssignment[];
  assumeFloor: boolean;
  columnRange?: [number, number];
  stepRange?: [number, number];
};

interface PartMaterialNeedStats {
  blockCounts: Record<string, number>;
  baseColorCounts: Record<number, number>;
  visibleColorKeys: Set<string>;
  usedShadesByBase: Map<number, Set<number>>;
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

function addUsedShade(usedShadesByBase: Map<number, Set<number>>, baseIndex: number, shade: number): void {
  let shades = usedShadesByBase.get(baseIndex);
  if (!shades) {
    shades = new Set<number>();
    usedShadesByBase.set(baseIndex, shades);
  }
  shades.add(shade);
}

function maximizeRoleCounts(into: Map<FillerRole, number>, from: Map<FillerRole, number>): void {
  for (const [role, count] of from) {
    into.set(role, Math.max(into.get(role) ?? 0, count));
  }
}

function addRoleCount(map: Map<FillerRole, number>, role: FillerRole, amount = 1): void {
  map.set(role, (map.get(role) ?? 0) + amount);
}

function getVisibleColorShadeKey(colorGrid: ColorGrid, x: number, z: number): string | null {
  const color = getColorCell(colorGrid, x, z);
  if (isTransparentColor(color)) return null;
  return `${color.isCustom ? 1 : 0}:${color.id}:${color.shade}`;
}

function analyzePartMaterialNeeds(
  colorGrid: ColorGrid,
  part: ShapePart,
  fillerAssignments: Map<FillerRole, string>,
  options: MaterialAnalysisOptions,
  applyColumnRange: boolean,
): PartMaterialNeedStats {
  const blockCounts: Record<string, number> = {};
  const baseColorCounts: Record<number, number> = {};
  const visibleColorKeys = new Set<string>();
  const usedShadesByBase = new Map<number, Set<number>>();
  const fillerRoleCounts = new Map<FillerRole, number>();
  for (const [coord, cell] of part.cells) {
    const [x, y, z] = parseShapeCoordKey(coord);
    if (applyColumnRange && options.columnRange && (x < options.columnRange[0] || x > options.columnRange[1])) continue;

    if (isShapeColorCell(cell)) {
      if (!cell.isCustom && cell.id === 0) continue;
      const blockName = resolveShapeColorBlockName(cell, options);
      if (!blockName) continue;
      const displayName = toDisplayName(blockName);
      addCount(blockCounts, displayName);
      if (!cell.isCustom && cell.id !== 0) {
        baseColorCounts[cell.id] = (baseColorCounts[cell.id] || 0) + 1;
      }
      const visibleKey = getVisibleColorShadeKey(colorGrid, x, z);
      if (visibleKey !== null) visibleColorKeys.add(visibleKey);
      if (!cell.isCustom) addUsedShade(usedShadesByBase, cell.id, getColorCell(colorGrid, x, z).shade);
      continue;
    }

    const assignedRole = resolveCellAssignedRole(cell, options.fillerAssignments);
    if (!shouldIncludeFragileSupportCell(part, coord, cell, assignedRole, options)) continue;
    if (!isWithinShapeBounds({ x, y, z }, part.bounds, options.assumeFloor)) continue;
    if (
      assignedRole &&
      (
        (assignedRole !== FillerRole.SupportWaterSides && assignedRole !== FillerRole.SupportWaterSidesCovered) ||
        !!resolveAssignedFillerName(fillerAssignments, assignedRole)
      )
    ) {
      addRoleCount(fillerRoleCounts, assignedRole);
    }
    const fillerName = resolveCellFillerName(cell, options.fillerAssignments, fillerAssignments);
    if (!fillerName) continue;
    const displayName = toDisplayName(fillerName);
    addCount(blockCounts, displayName);
  }

  return { blockCounts, baseColorCounts, visibleColorKeys, usedShadesByBase, fillerRoleCounts };
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
export function northRowIsSingleLine(shape: GeneratedShape): boolean {
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
export function hasColorHeightVariance(shape: GeneratedShape): boolean {
  let firstY: number | undefined;
  for (const part of shape.parts) {
    for (const [coord, cell] of part.cells) {
      if (!isShapeColorCell(cell)) continue;
      const [, y] = parseShapeCoordKey(coord);
      if (firstY === undefined) firstY = y;
      else if (firstY !== y) return true;
    }
  }
  return false;
}

// Callers:
// - src/Index.tsx
export function analyzeMaterialNeeds(
  colorGrid: ColorGrid,
  shape: GeneratedShape,
  options: MaterialAnalysisOptions,
): MaterialNeedStats {
  const fillerAssignments = buildFillerAssignmentMap(options.fillerAssignments);

  if (shape.partType === ShapePartType.SuppressStepColumns) {
    const [start, end] = options.stepRange ?? [0, shape.parts.length - 1];
    const blockCounts: Record<string, number> = {};
    const baseColorCounts: Record<number, number> = {};
    const visibleColorKeys = new Set<string>();
    const usedShadesByBase = new Map<number, Set<number>>();
    const fillerRoleCounts = new Map<FillerRole, number>();

    for (let i = start; i <= end && i < shape.parts.length; ++i) {
      const step = analyzePartMaterialNeeds(colorGrid, shape.parts[i], fillerAssignments, options, false);
      maximizeCounts(blockCounts, step.blockCounts);
      for (const [key, count] of Object.entries(step.baseColorCounts)) {
        baseColorCounts[Number(key)] = Math.max(baseColorCounts[Number(key)] || 0, count);
      }
      for (const key of step.visibleColorKeys) visibleColorKeys.add(key);
      for (const [baseIndex, shades] of step.usedShadesByBase) {
        for (const shade of shades) addUsedShade(usedShadesByBase, baseIndex, shade);
      }
      maximizeRoleCounts(fillerRoleCounts, step.fillerRoleCounts);
    }

    return {
      blockCounts,
      baseColorCounts,
      numUniqueColorShadesForPart: visibleColorKeys.size,
      usedShadesByBase,
      fillerRoleCounts,
    };
  }

  const blockCounts: Record<string, number> = {};
  const baseColorCounts: Record<number, number> = {};
  const visibleColorKeys = new Set<string>();
  const usedShadesByBase = new Map<number, Set<number>>();
  const fillerRoleCounts = new Map<FillerRole, number>();

  for (const part of shape.parts) {
    const stats = analyzePartMaterialNeeds(colorGrid, part, fillerAssignments, options, true);
    for (const [key, count] of Object.entries(stats.blockCounts)) addCount(blockCounts, key, count);
    for (const [key, count] of Object.entries(stats.baseColorCounts)) {
      baseColorCounts[Number(key)] = (baseColorCounts[Number(key)] || 0) + count;
    }
    for (const key of stats.visibleColorKeys) visibleColorKeys.add(key);
    for (const [baseIndex, shades] of stats.usedShadesByBase) {
      for (const shade of shades) addUsedShade(usedShadesByBase, baseIndex, shade);
    }
    for (const [role, count] of stats.fillerRoleCounts) addRoleCount(fillerRoleCounts, role, count);
  }

  return {
    blockCounts,
    baseColorCounts,
    numUniqueColorShadesForPart: visibleColorKeys.size,
    usedShadesByBase,
    fillerRoleCounts,
  };
}
