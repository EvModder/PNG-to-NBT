/**
 * Public API:
 * - stripBlockNamespace()
 * - normalizeBlockId()
 * - canonicalizeBlockEntry()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/fillerRules.ts
 * - src/lib/nbtWriter.ts
 * - src/data/presets.ts
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

// Callers:
// - src/Index.tsx
// - src/data/presets.ts
// - src/lib/nbtWriter.ts
export function canonicalizeBlockEntry(raw: string): string {
  const trimmed = raw.trim();
  const bracketIdx = trimmed.indexOf("[");
  if (bracketIdx < 0) return trimmed;
  if (!trimmed.endsWith("]")) return trimmed;

  const name = trimmed.slice(0, bracketIdx);
  if (!normalizeBlockId(name).endsWith("_log")) return trimmed;

  const props = trimmed
    .slice(bracketIdx + 1, -1)
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => part.toLowerCase() !== "axis=y");

  return props.length > 0 ? `${name}[${props.join(",")}]` : name;
}
