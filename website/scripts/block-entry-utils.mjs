/**
 * Public API:
 * - normalizeBlockEntry()
 * - blockIdOnly()
 * - mapLegacyBlockId()
 *
 * Callers:
 * - scripts/audit-mapcolors.mjs
 * - scripts/build-precomputed-block-icons.mjs
 * - scripts/sync-block-icons-from-mcasset.mjs
 */
// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-precomputed-block-icons.mjs
export function normalizeBlockEntry(entry) {
  return entry.trim().replace(/^minecraft:/, "");
}

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/build-precomputed-block-icons.mjs
// - scripts/sync-block-icons-from-mcasset.mjs
export function blockIdOnly(entry) {
  return normalizeBlockEntry(entry).split("[")[0];
}

const BLOCK_ID_ALIASES = {
  chain: "iron_chain",
  jigsaw_block: "jigsaw",
  vines: "vine",
  lapis_lazuli_ore: "lapis_ore",
};

// Callers:
// - scripts/audit-mapcolors.mjs
// - scripts/sync-block-icons-from-mcasset.mjs
export function mapLegacyBlockId(blockId) {
  if (BLOCK_ID_ALIASES[blockId]) return BLOCK_ID_ALIASES[blockId];
  if (blockId.endsWith("_stripped_log")) {
    const prefix = blockId.slice(0, -"_stripped_log".length);
    return `stripped_${prefix}_log`;
  }
  if (blockId.endsWith("_stripped_wood")) {
    const prefix = blockId.slice(0, -"_stripped_wood".length);
    return `stripped_${prefix}_wood`;
  }
  return blockId;
}
