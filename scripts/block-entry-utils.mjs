/**
 * Public API:
 * - normalizeBlockEntry()
 * - blockIdOnly()
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
