/**
 * Public API:
 * - getMinecraftCatalog()
 * - getVersionedBlockName()
 * - isBlockAvailable()
 * - isBlockCompatible()
 * - getBlockFallbackVersion()
 * - getVersionedSelections()
 * - getVersionedSupportRules()
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/lib/nbtExport.ts
 * - src/lib/codecPreset.ts
 * - src/lib/mixedStepHeights.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeModel.ts
 * - src/lib/presetFallbacks.ts
 * - src/components/PresetFallbackDialog.tsx
 */
import { DEFAULT_MINECRAFT_VERSION } from "@/data/defaultSettings";
import { FRAGILE_SUPPORT_RULES } from "@/data/fragileBlocks";
import { BASE_COLORS } from "@/data/mapColors";
import { EXCLUDED_BLOCKS } from "@/data/mapColorsExcluded";
import { BLOCK_INTRODUCTIONS, MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";

function blockId(block: string): string {
  return block.replace(/^minecraft:/, "").split("[")[0];
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/lib/nbtExport.ts
// - src/lib/presetFallbacks.ts
export function getVersionedBlockName(block: string, version: MinecraftVersion): string {
  const name = MINECRAFT_VERSIONS[version].dataVersion < 4554 ? "chain" : "iron_chain";
  return block.replace(/^(minecraft:)?(iron_chain|chain)(?=\[|$)/, (_, namespace = "") => namespace + name);
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/lib/nbtExport.ts
// - src/lib/codecPreset.ts
export function isBlockAvailable(block: string, version: MinecraftVersion | number): boolean {
  const id = blockId(block);
  if (id.includes(":")) return true; // Custom namespaces are outside the vanilla catalog.
  const dataVersion = typeof version === "number" ? version : MINECRAFT_VERSIONS[version].dataVersion;
  return BLOCK_INTRODUCTIONS.every(([pattern, introduced]) =>
    !pattern.test(id) || dataVersion >= introduced,
  );
}

function buildCatalog(version: MinecraftVersion) {
  const adapt = (rows: readonly (readonly string[])[]) => {
    const result = rows.map(row => row.filter(block => isBlockAvailable(block, version))
      .map(block => getVersionedBlockName(block, version)));
    if (version === "1.21.4") {
      const moved = result[6].filter(block => /^(pale_oak_leaves|closed_eyeblossom)$/.test(block));
      result[6] = result[6].filter(block => !moved.includes(block));
      result[49].push(...moved);
    }
    return result;
  };
  return { blocks: adapt(BASE_COLORS.map(color => color.blocks)), excluded: adapt(EXCLUDED_BLOCKS) };
}

const catalogs = new Map(Object.keys(MINECRAFT_VERSIONS).map(version =>
  [version as MinecraftVersion, buildCatalog(version as MinecraftVersion)] as const,
));

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/lib/previewImageEdits.ts
export function getMinecraftCatalog(version: MinecraftVersion = DEFAULT_MINECRAFT_VERSION) {
  return catalogs.get(version)!;
}

// Custom states/colors remain user-controlled; waterlogged leaves are deliberately color 12.
// Callers:
// - src/lib/presetFallbacks.ts
export function isBlockCompatible(block: string, id: number, version: MinecraftVersion): boolean {
  const changedColor = /^(pale_oak_leaves|closed_eyeblossom)$/.test(blockId(block))
    && !block.includes("waterlogged=true");
  return isBlockAvailable(block, version) && (!changedColor || id === (version === "1.21.4" ? 49 : 6));
}

// Callers:
// - src/components/PresetFallbackDialog.tsx
export function getBlockFallbackVersion(block: string, id: number): { operator: "<" | ">"; version: string } | undefined {
  const versions = Object.keys(MINECRAFT_VERSIONS) as MinecraftVersion[];
  const compatible = versions.filter(version => isBlockCompatible(block, id, version));
  if (!compatible.length) return undefined;
  // Historical map-color changes can require a fallback in newer versions instead.
  if (compatible.at(-1) !== versions.at(-1)) {
    return { operator: ">", version: MINECRAFT_VERSIONS[compatible.at(-1)!].label.split("–").at(-1)! };
  }
  let release: string = compatible[0];
  const previous = versions[versions.indexOf(compatible[0]) - 1];
  let cutoff = previous ? MINECRAFT_VERSIONS[previous].dataVersion : 0;
  const name = blockId(block);
  for (const [pattern, introduced, label] of BLOCK_INTRODUCTIONS) {
    if (pattern.test(name) && introduced > cutoff) {
      cutoff = introduced;
      release = label;
    }
  }
  return { operator: "<", version: release };
}

// Keep stored preferences untouched; use the first compatible choice, otherwise none.
// Callers:
// - src/Index.tsx
export function getVersionedSelections(
  selected: Record<number, string>,
  version: MinecraftVersion,
  fallbacks: Record<number, string[]> = {},
) {
  return Object.fromEntries(BASE_COLORS.map((_, id) => {
    const preferred = selected[id] ?? "";
    const block = !preferred || isBlockCompatible(preferred, id, version) ? preferred
      : fallbacks[id]?.find(candidate => isBlockCompatible(candidate, id, version)) ?? "";
    return [id, getVersionedBlockName(block, version)];
  }));
}

const legacySupportRules = new Map(FRAGILE_SUPPORT_RULES);
const dripleafRule = FRAGILE_SUPPORT_RULES.get("big_dripleaf")!;
legacySupportRules.set("big_dripleaf", {
  ...dripleafRule, validSupportBlocks: [...dripleafRule.validSupportBlocks, "pale_moss_block"],
});
const deadBushRule = FRAGILE_SUPPORT_RULES.get("dead_bush")!;
legacySupportRules.set("dead_bush", {
  ...deadBushRule, validSupportBlocks: deadBushRule.validSupportBlocks.filter(block => block !== "farmland"),
});

// Callers:
// - src/Index.tsx
// - src/lib/shapeModel.ts
// - src/lib/mixedStepHeights.ts
export function getVersionedSupportRules(version: MinecraftVersion = DEFAULT_MINECRAFT_VERSION) {
  return version === "1.21.4" ? legacySupportRules : FRAGILE_SUPPORT_RULES;
}
