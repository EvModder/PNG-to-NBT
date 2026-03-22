/**
 * Public API:
 * - stripBlockNamespace()
 * - normalizeBlockId()
 * - canonicalizeBlockEntry()
 * - sanitizeUserBlockEntry()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/fillerRules.ts
 * - src/lib/nbtWriter.ts
 * - src/data/presets.ts
 * - src/lib/presetCodec.ts
 * - src/lib/shapeCellRules.ts
 * - tests/run.mts
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
// - src/lib/presetCodec.ts
// - tests/run.mts
export function sanitizeUserBlockEntry(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const bracketIdx = trimmed.indexOf("[");
  if (bracketIdx < 0 || !trimmed.endsWith("]")) return stripBlockNamespace(trimmed).toLowerCase();

  const name = stripBlockNamespace(trimmed.slice(0, bracketIdx)).toLowerCase();
  const props = trimmed
    .slice(bracketIdx + 1, -1)
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);

  if (!normalizeBlockId(name).endsWith("_log")) {
    return props.length > 0 ? `${name}[${props.join(",")}]` : name;
  }

  // User-entered `*_log[axis=y]` is equivalent to the default-state block id.
  const filteredProps = props
    .filter(part => part.toLowerCase() !== "axis=y");

  return filteredProps.length > 0 ? `${name}[${filteredProps.join(",")}]` : name;
}

// Backward-compatible alias for non-input paths that still use the older name.
export function canonicalizeBlockEntry(raw: string): string {
  return sanitizeUserBlockEntry(raw);
}
