/**
 * Public API:
 * - FillerNeedStats
 * - MaterialNeedStats
 * - analyzeFillerNeeds()
 * - northRowIsSingleLine()
 * - hasColorHeightVariance()
 * - analyzeMaterialNeeds()
 * - computeGeneratedShapeSignature()
 *
 * Used by:
 * - src/Index.tsx
 */
import { type ColorGrid, getColorCell, isTransparentColor } from "./colorGridTypes";
import { FillerRole, type CustomColor, type FillerAssignment } from "./conversionTypes";
import { buildFillerAssignmentMap, resolveCellAssignedRole, resolveCellFillerName } from "./fillerRules";
import { resolveShapeColorBlockName, toDisplayName } from "./materialRules";
import type { GeneratedShape } from "./shapeGeneration";
import { isShapeColorCell, isShapeFillerCell, parseShapeCoordKey, ShapePartType } from "./shapeTypes";
import { isWithinShapeBounds, shouldIncludeFragileSupportCell } from "./shapeCellRules";

export interface FillerNeedStats {
  roleCounts: Map<FillerRole, number>;
}

export interface MaterialNeedStats {
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

type HashState = [number, number, number, number];

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

    if (!shouldIncludeFragileSupportCell(part, coord, cell, options)) continue;
    if (!isWithinShapeBounds({ x, y, z }, part.bounds, options.assumeFloor)) continue;
    const assignedRole = resolveCellAssignedRole(cell, options.fillerAssignments);
    if (assignedRole) addRoleCount(fillerRoleCounts, assignedRole);
    const fillerName = resolveCellFillerName(cell, options.fillerAssignments, fillerAssignments);
    if (!fillerName) continue;
    const displayName = toDisplayName(fillerName);
    addCount(blockCounts, displayName);
  }

  return { blockCounts, baseColorCounts, visibleColorKeys, usedShadesByBase, fillerRoleCounts };
}

function createHashState(): HashState {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
}

function mixUint32(state: HashState, value: number): void {
  const v = value >>> 0;
  state[0] = Math.imul((state[0] ^ v) >>> 0, 0x01000193) >>> 0;
  state[1] = Math.imul((state[1] + v + 0x7f4a7c15) >>> 0, 0x27d4eb2d) >>> 0;
  state[2] = Math.imul((state[2] ^ ((v << 16) | (v >>> 16))) >>> 0, 0x165667b1) >>> 0;
  state[3] = Math.imul((state[3] + (v ^ 0x9e3779b9)) >>> 0, 0x85ebca77) >>> 0;
}

function mixString(state: HashState, value: string): void {
  for (let i = 0; i < value.length; ++i) mixUint32(state, value.charCodeAt(i));
  // Terminate each string so ["ab","c"] hashes differently from ["a","bc"].
  mixUint32(state, 0xff);
}

function mixShapePart(state: HashState, part: GeneratedShape["parts"][number]): void {
  mixUint32(state, part.bounds.minY);
  mixUint32(state, part.bounds.maxY);
  mixUint32(state, part.bounds.minZ);
  mixUint32(state, part.bounds.maxZ);
  mixUint32(state, part.cells.size);

  const cells = [...part.cells.entries()].sort(([a], [b]) => a - b);
  for (const [coord, cell] of cells) {
    mixUint32(state, coord);
    const [x, y, z] = parseShapeCoordKey(coord);
    mixUint32(state, x);
    mixUint32(state, y);
    mixUint32(state, z);
    if (isShapeColorCell(cell)) {
      mixUint32(state, 0xc0110);
      mixUint32(state, cell.isCustom ? 1 : 0);
      mixUint32(state, cell.id);
    } else {
      mixUint32(state, 0xf1113);
      const roles = [...cell].sort();
      mixUint32(state, roles.length);
      for (const role of roles) mixString(state, role);
    }
  }
}

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

export function computeGeneratedShapeSignature(shape: GeneratedShape): string {
  const state = createHashState();
  mixString(state, shape.partType);
  mixString(state, shape.splitExportNames?.[0] ?? "");
  mixString(state, shape.splitExportNames?.[1] ?? "");
  mixUint32(state, shape.parts.length);
  for (const part of shape.parts) mixShapePart(state, part);
  // Render the 4x32-bit hash lanes as one stable 128-bit lowercase hex signature.
  return state.map(part => part.toString(16).padStart(8, "0")).join("");
}

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
