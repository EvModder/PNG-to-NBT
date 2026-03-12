/**
 * Public API:
 * - isFillerDisabled()
 * - isShadeFillerDisabled()
 * - buildFillerAssignmentMap()
 * - resolveAssignedFillerName()
 * - resolveCellAssignedRole()
 * - resolveCellFillerName()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeSubstitution.ts
 */
import { BASE_COLORS } from "../data/mapColors";
import { FillerRole, type FillerAssignment } from "./conversionTypes";
import { resolveBlockName } from "./materialRules";

function normalizeBlockId(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const base = lower.split("[")[0];
  return base.startsWith("minecraft:") ? base.slice("minecraft:".length) : base;
}

const TRANSPARENT_FILLER_BLOCKS = new Set<string>(BASE_COLORS[0].blocks.map(normalizeBlockId));
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

// Callers:
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeSubstitution.ts
export function buildFillerAssignmentMap(assignments: readonly FillerAssignment[]): Map<FillerRole, string> {
  const byRole = new Map<FillerRole, string>();
  for (const assignment of assignments) {
    if (!byRole.has(assignment.role)) byRole.set(assignment.role, assignment.block.trim());
  }
  return byRole;
}

// Callers:
// - src/lib/shapeSubstitution.ts
export function resolveAssignedFillerName(assignments: Map<FillerRole, string>, role: FillerRole): string | null {
  const block = assignments.get(role) ?? "";
  if (!block) return null;
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
