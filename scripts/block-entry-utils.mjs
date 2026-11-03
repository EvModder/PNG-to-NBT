/**
 * Public API:
 * - normalizeBlockEntry()
 * - blockIdOnly()
 * - parseMapColors()
 *
 * Callers:
 * - scripts/audit-mapcolors.mjs
 * - scripts/build-block-icon-files.mjs
 * - scripts/sync-block-icons-from-mcasset.mjs
 */
// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export function normalizeBlockEntry(entry) {
  return entry.trim().replace(/^minecraft:/, "");
}

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
// - scripts/sync-block-icons-from-mcasset.mjs
export function blockIdOnly(entry) {
  return normalizeBlockEntry(entry).split("[")[0];
}

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-block-icon-files.mjs
export function parseMapColors(tsText) {
  const rows = [];
  const rowRe = /\{\s*name:\s*"([^"]+)"[\s\S]*?blocks:\s*\[([\s\S]*?)\]\s*\}/g;
  for (const m of tsText.matchAll(rowRe)) {
    const name = m[1];
    const content = m[2];
    const entries = [...content.matchAll(/"([^"]+)"/g)].map(s => normalizeBlockEntry(s[1]));
    rows.push({ name, entries });
  }
  return rows;
}
