/**
 * Public API:
 * - stripBlockNamespace()
 * - normalizeBlockId()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/fillerRules.ts
 * - src/lib/shapeCellRules.ts
 */
// Callers:
// - src/Index.tsx
export function stripBlockNamespace(raw: string): string {
  return raw.trim().replace(/^minecraft:/i, "");
}

// Callers:
// - src/Index.tsx
// - src/lib/fillerRules.ts
// - src/lib/shapeCellRules.ts
export function normalizeBlockId(raw: string): string {
  return stripBlockNamespace(raw).toLowerCase().split("[")[0];
}
