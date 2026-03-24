/**
 * Public API:
 * - createFillerAssignments()
 * - getSupportModeFillerRoles()
 * - isFillerDisabled()
 * - isShadeFillerDisabled()
 * - isWaterSideSupportFillerValid()
 * - buildFillerAssignmentMap()
 * - resolveAssignedFillerName()
 * - resolveCellAssignedRole()
 * - resolveCellFillerName()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/shapeAnalysis.ts
 * - src/lib/nbtExport.ts
 */
import { BASE_COLORS, TRANSPARENCY_BASE_INDEX } from "../data/mapColors";
import { normalizeBlockId } from "@/utils/blockId";
import { FillerRole, type FillerAssignment } from "@/types/conversion";
import { resolveBlockName } from "./materialRules";
import { SupportMode } from "@/types/ui";

const TRANSPARENT_FILLER_BLOCKS = new Set<string>(BASE_COLORS[TRANSPARENCY_BASE_INDEX].blocks.map(normalizeBlockId));
const DISABLED_FILLER_ALIASES = new Set<string>(["air", "none", "n/a", "na"]);

function isShadeCriticalFillerRole(role: FillerRole): boolean {
  switch (role) {
    case FillerRole.ShadeNorthRow:
    case FillerRole.ShadeSuppress:
    case FillerRole.ShadeSuppressLate:
    case FillerRole.ShadeVoidDominant:
    case FillerRole.ShadeVoidRecessive:
      return true;
    default:
      return false;
  }
}

// Callers:
// - src/Index.tsx
export function getSupportModeFillerRoles(
  supportMode: SupportMode,
  usesDirectWaterBlock: boolean,
  usesIceWaterBlock: boolean,
): FillerRole[] {
  const roles: FillerRole[] = [];
  const shouldIncludeWaterPath = supportMode !== SupportMode.None;
  const shouldIncludeDirectWaterSupport = supportMode !== SupportMode.None && usesDirectWaterBlock;

  switch (supportMode) {
    case SupportMode.Steps:
      roles.push(FillerRole.StairStep);
      break;
    case SupportMode.All:
      roles.push(FillerRole.SupportAll);
      break;
    case SupportMode.Fragile:
      roles.push(FillerRole.SupportFragile);
      break;
    case SupportMode.Water:
      if (!usesDirectWaterBlock) {
        roles.push(FillerRole.SupportWaterBase);
      }
      break;
    case SupportMode.None:
      break;
  }

  if (shouldIncludeWaterPath && !roles.includes(FillerRole.WaterPath)) {
    roles.push(FillerRole.WaterPath);
  }

  if (shouldIncludeDirectWaterSupport) {
    if (!roles.includes(FillerRole.SupportWaterBase)) roles.push(FillerRole.SupportWaterBase);
    if (!roles.includes(FillerRole.SupportWaterSides)) roles.push(FillerRole.SupportWaterSides);
    if (!roles.includes(FillerRole.SupportWaterSidesCovered)) roles.push(FillerRole.SupportWaterSidesCovered);
  }

  if (
    supportMode !== SupportMode.None &&
    usesIceWaterBlock &&
    !roles.includes(FillerRole.SupportWaterBase)
  ) {
    roles.push(FillerRole.SupportWaterBase);
  }

  return roles;
}

// Callers:
// - src/Index.tsx
export function createFillerAssignments(
  supportFillerBlock: string,
  shadeFillerBlock: string,
  dominateVoidFillerBlock: string,
  recessiveVoidFillerBlock: string,
  suppress2LayerLateFillerBlock: string,
  supportMode: SupportMode,
  usesDirectWaterBlock: boolean,
  usesIceWaterBlock: boolean,
): FillerAssignment[] {
  const assignments: FillerAssignment[] = [
    { role: FillerRole.ShadeSuppress, block: shadeFillerBlock },
    { role: FillerRole.ShadeNorthRow, block: shadeFillerBlock },
    { role: FillerRole.ShadeVoidDominant, block: dominateVoidFillerBlock || shadeFillerBlock },
    { role: FillerRole.ShadeVoidRecessive, block: recessiveVoidFillerBlock || shadeFillerBlock },
    { role: FillerRole.ShadeSuppressLate, block: suppress2LayerLateFillerBlock || shadeFillerBlock },
  ];
  for (const role of getSupportModeFillerRoles(supportMode, usesDirectWaterBlock, usesIceWaterBlock)) {
    assignments.push({ role, block: supportFillerBlock });
  }
  return assignments;
}

// Callers:
// - src/Index.tsx
export function isFillerDisabled(fillerBlock: string): boolean {
  const normalized = normalizeBlockId(fillerBlock);
  return normalized ? DISABLED_FILLER_ALIASES.has(normalized) : false;
}

// Callers:
// - src/Index.tsx
export function isShadeFillerDisabled(fillerBlock: string): boolean {
  const normalized = normalizeBlockId(fillerBlock);
  if (!normalized) return false;
  return DISABLED_FILLER_ALIASES.has(normalized) || TRANSPARENT_FILLER_BLOCKS.has(normalized);
}

function isTransparentMapColorBlock(fillerBlock: string): boolean {
  const normalized = normalizeBlockId(fillerBlock);
  return normalized ? TRANSPARENT_FILLER_BLOCKS.has(normalized) : false;
}

// Callers:
// - src/Index.tsx
export function isWaterSideSupportFillerValid(fillerBlock: string): boolean {
  return !isFillerDisabled(fillerBlock) && isTransparentMapColorBlock(fillerBlock);
}

// Callers:
// - src/lib/shapeAnalysis.ts
// - src/lib/nbtExport.ts
export function buildFillerAssignmentMap(assignments: readonly FillerAssignment[]): Map<FillerRole, string> {
  const byRole = new Map<FillerRole, string>();
  for (const assignment of assignments) {
    if (!byRole.has(assignment.role)) byRole.set(assignment.role, assignment.block.trim());
  }
  return byRole;
}

// Callers:
// - src/lib/shapeAnalysis.ts
// - src/lib/nbtExport.ts
export function resolveAssignedFillerName(assignments: Map<FillerRole, string>, role: FillerRole): string | null {
  const block = assignments.get(role) ?? "";
  if (!block) return null;
  if (role === FillerRole.SupportWaterSides && !isWaterSideSupportFillerValid(block)) return null;
  if (isShadeCriticalFillerRole(role) ? isShadeFillerDisabled(block) : isFillerDisabled(block)) return null;
  return resolveBlockName(block);
}

// Callers:
// - src/lib/shapeAnalysis.ts
export function resolveCellAssignedRole(
  cellRoles: readonly FillerRole[],
  assignments: readonly FillerAssignment[],
): FillerRole | null {
  for (const assignment of assignments) {
    if (cellRoles.includes(assignment.role)) return assignment.role;
  }
  return null;
}

// Callers:
// - src/lib/shapeAnalysis.ts
export function resolveCellFillerName(
  cellRoles: readonly FillerRole[],
  assignments: readonly FillerAssignment[],
  byRole: Map<FillerRole, string>,
): string | null {
  for (const assignment of assignments) {
    if (!cellRoles.includes(assignment.role)) continue;
    const fillerName = resolveAssignedFillerName(byRole, assignment.role);
    if (fillerName) return fillerName;
  }
  return null;
}
