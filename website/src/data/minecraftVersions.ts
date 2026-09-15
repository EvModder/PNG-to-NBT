/**
 * Public API:
 * - MINECRAFT_VERSIONS
 * - MinecraftVersion
 * - BLOCK_INTRODUCTIONS
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/SecretsSettingsDialog.tsx
 * - src/lib/blockId.ts
 * - src/lib/codecPreset.ts
 * - src/lib/minecraftVersion.ts
 * - src/lib/nbtExport.ts
 * - src/lib/previewImageEdits.ts
 */
// Breakpoints reflect default-visible blocks only. Each range targets its newest release.
// Keep ranges chronological: preset decoding locates the range for a stored DataVersion.
// Local registry/state/support audit: work_files/version-audit/minecraft-versions.md.
// Callers:
// - src/Index.tsx
// - src/components/SecretsSettingsDialog.tsx
// - src/lib/minecraftVersion.ts
// - src/lib/nbtExport.ts
// - src/lib/previewImageEdits.ts
export const MINECRAFT_VERSIONS = {
  "1.21.4": { label: "1.21.4", dataVersion: 4189 },
  "1.21.5": { label: "1.21.5–1.21.8", dataVersion: 4440 },
  "1.21.9": { label: "1.21.9–26.1.2", dataVersion: 4790 },
  "26.2": { label: "26.2", dataVersion: 4903 },
} as const;

// Callers:
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/SecretsSettingsDialog.tsx
// - src/lib/blockId.ts
// - src/lib/codecPreset.ts
// - src/lib/minecraftVersion.ts
// - src/lib/nbtExport.ts
// - src/lib/previewImageEdits.ts
export type MinecraftVersion = keyof typeof MINECRAFT_VERSIONS;

// Only post-1.21.4 additions need entries; patterns also cover hidden catalog blocks.
// These exact cutoffs also protect preset URL indices: register new blocks before
// inserting them into either catalog list. Do not round cutoffs to UI ranges.
// Callers:
// - src/lib/minecraftVersion.ts
export const BLOCK_INTRODUCTIONS: readonly (readonly [RegExp, number])[] = [
  [/^(bush|cactus_flower|firefly_bush|leaf_litter|short_dry_grass|tall_dry_grass|wildflowers|test_block|test_instance_block)$/, 4325],
  [/^dried_ghast$/, 4435],
  [/copper_(bars|chain|chest|golem_statue|lantern)$/, 4554],
  [/^(copper_torch|copper_wall_torch)$/, 4554],
  [/_(lightning_rod|shelf)$/, 4554],
  [/^(potted_)?golden_dandelion$/, 4786],
  [/(^|_)(cinnabar|sulfur)(_|$)/, 4903],
];
