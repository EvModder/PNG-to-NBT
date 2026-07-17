/**
 * Public API:
 * - createFillerAssignments()
 * - CRUBTECH_NOOBLINE_FILLER_BLOCK
 * - getSupportModeFillerRoles()
 * - isFillerDisabled()
 * - isShadeFillerDisabled()
 * - isCrubTechBreakableValid()
 * - isCrubTechPushableValid()
 * - isWaterSideSupportFillerValid()
 * - buildFillerAssignmentMap()
 * - resolveAssignedFillerName()
 * - resolveCellAssignedRole()
 * - resolveCellFillerName()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/nbtExport.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 */
import { BASE_COLORS, TRANSPARENCY_BASE_INDEX } from "../data/mapColors";
import { normalizeBlockId, resolveExportBlockName } from "@/lib/blockId";
import { FillerRole, type FillerAssignment } from "@/types/conversion";
import { SupportMode } from "@/types/ui";

const TRANSPARENT_FILLER_BLOCKS = new Set<string>(BASE_COLORS[TRANSPARENCY_BASE_INDEX].blocks.map(normalizeBlockId));
const DISABLED_FILLER_ALIASES = new Set<string>(["air", "none", "n/a", "na"]);

function isShadeCriticalFillerRole(role: FillerRole): boolean {
  switch (role) {
    case FillerRole.ShadeNorthRow:
    case FillerRole.ShadeSuppress:
    case FillerRole.ShadeNorthRowBreakable:
    case FillerRole.ShadeNorthRowPushable:
    case FillerRole.ShadeSuppressBreakable:
    case FillerRole.ShadeSuppressPushable:
    case FillerRole.ShadeSuppressLate:
    case FillerRole.ShadeVoidDominant:
    case FillerRole.ShadeVoidRecessive:
    case FillerRole.SupportBreakable:
    case FillerRole.SupportPushable:
      return true;
    default:
      return false;
  }
}

const CRUBTECH_BREAKABLE_FILLER_BLOCKS = new Set<string>([
  "moss_block",
]);

// Callers:
// - src/lib/nbtExport.ts
export const CRUBTECH_NOOBLINE_FILLER_BLOCK = "moss_block";

// Conservative denylist for obvious piston/slime-incompatible choices.
// This is only used for warnings; unknown normal blocks are treated as pushable.
const CRUBTECH_NON_PUSHABLE_FILLER_BLOCKS = new Set<string>([
  "bedrock",
  "barrier",
  "obsidian",
  "crying_obsidian",
  "respawn_anchor",
  "reinforced_deepslate",
  "command_block",
  "chain_command_block",
  "repeating_command_block",
  "end_portal_frame",
  "end_portal",
  "end_gateway",
  "moving_piston",
  "piston_head",
  "spawner",
]);

// Callers:
// - src/Index.tsx
export function getSupportModeFillerRoles(
  supportMode: SupportMode,
  usesDirectWaterBlock: boolean,
  usesIceWaterBlock: boolean,
  useCrubTechSupport: boolean,
): FillerRole[] {
  if (useCrubTechSupport) {
    return supportMode === SupportMode.Steps
      ? [FillerRole.SupportBreakable, FillerRole.SupportPushable]
      : [];
  }

  const roles: FillerRole[] = [];
  const shouldIncludeWaterPath = supportMode !== SupportMode.None;
  const shouldIncludeDirectWaterSupport = shouldIncludeWaterPath && usesDirectWaterBlock;

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
    shouldIncludeWaterPath &&
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
  crubTechBreakableFillerBlock: string,
  crubTechPushableFillerBlock: string,
  suppress2LayerLateFillerBlock: string,
  dominateVoidFillerBlock: string,
  recessiveVoidFillerBlock: string,
  supportMode: SupportMode,
  useCrubTechSupport: boolean,
  usesDirectWaterBlock: boolean,
  usesIceWaterBlock: boolean,
): FillerAssignment[] {
  const assignments: FillerAssignment[] = [
    { role: FillerRole.ShadeSuppress, block: shadeFillerBlock },
    { role: FillerRole.ShadeNorthRow, block: shadeFillerBlock },
    { role: FillerRole.ShadeSuppressBreakable, block: crubTechBreakableFillerBlock },
    { role: FillerRole.ShadeNorthRowBreakable, block: CRUBTECH_NOOBLINE_FILLER_BLOCK },
    { role: FillerRole.ShadeSuppressPushable, block: crubTechPushableFillerBlock },
    { role: FillerRole.ShadeNorthRowPushable, block: CRUBTECH_NOOBLINE_FILLER_BLOCK },
    { role: FillerRole.ShadeVoidDominant, block: dominateVoidFillerBlock || shadeFillerBlock },
    { role: FillerRole.ShadeVoidRecessive, block: recessiveVoidFillerBlock || shadeFillerBlock },
    { role: FillerRole.ShadeSuppressLate, block: suppress2LayerLateFillerBlock || shadeFillerBlock },
  ];
  for (const role of getSupportModeFillerRoles(supportMode, usesDirectWaterBlock, usesIceWaterBlock, useCrubTechSupport)) {
    const block = role === FillerRole.SupportBreakable
      ? crubTechBreakableFillerBlock
      : role === FillerRole.SupportPushable
        ? crubTechPushableFillerBlock
        : supportFillerBlock;
    assignments.push({ role, block });
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
// - src/lib/previewImageEdits.ts
export function isShadeFillerDisabled(fillerBlock: string): boolean {
  const normalized = normalizeBlockId(fillerBlock);
  if (!normalized) return false;
  return DISABLED_FILLER_ALIASES.has(normalized) || TRANSPARENT_FILLER_BLOCKS.has(normalized);
}

// Callers:
// - src/Index.tsx
export function isCrubTechBreakableValid(fillerBlock: string): boolean {
  const normalized = normalizeBlockId(fillerBlock);
  return !!normalized && !isShadeFillerDisabled(fillerBlock) && CRUBTECH_BREAKABLE_FILLER_BLOCKS.has(normalized);
}

// Callers:
// - src/Index.tsx
export function isCrubTechPushableValid(fillerBlock: string): boolean {
  const normalized = normalizeBlockId(fillerBlock);
  return !!normalized && !isShadeFillerDisabled(fillerBlock) && !CRUBTECH_NON_PUSHABLE_FILLER_BLOCKS.has(normalized);
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
  return resolveExportBlockName(block);
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
