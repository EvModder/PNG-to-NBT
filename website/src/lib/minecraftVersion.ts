/**
 * Public API:
 * - getMinecraftCatalog()
 * - getVersionedBlockName()
 * - isBlockAvailable()
 * - isBlockCompatible()
 * - getBlockFallbackVersion()
 * - getVersionedSelections()
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/lib/nbtExport.ts
 * - src/lib/codecPreset.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/presetFallbacks.ts
 * - src/components/PresetFallbackDialog.tsx
 */
import { DEFAULT_MINECRAFT_VERSION } from "@/data/defaultSettings";
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
export function getVersionedBlockName(block: string, dataVersion: number): string {
  const name = dataVersion < 4554 ? "chain" : "iron_chain";
  return block.replace(/^(minecraft:)?(iron_chain|chain)(?=\[|$)/, (_, namespace = "") => namespace + name);
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/lib/nbtExport.ts
export function isBlockAvailable(block: string, dataVersion: number): boolean {
  const id = blockId(block);
  if (id.includes(":")) return true; // Custom namespaces are outside the vanilla catalog.
  return BLOCK_INTRODUCTIONS.every(([pattern, introduced]) =>
    !pattern.test(id) || dataVersion >= introduced,
  );
}

const PRE_1_21_5_COLORS: Readonly<Record<string, number>> = {
  pale_oak_leaves: 49,
  closed_eyeblossom: 49,
  pale_oak_sapling: 14,
};

function buildCatalog(dataVersion: number): { blocks: readonly (readonly string[])[]; excluded: readonly (readonly string[])[] } {
  const adapt = (rows: readonly (readonly string[])[]) => {
    const result = rows.map(row => row.filter(block => isBlockAvailable(block, dataVersion))
      .map(block => getVersionedBlockName(block, dataVersion)));
    if (dataVersion < 4325) {
      const moved = result[6].filter(block => PRE_1_21_5_COLORS[block] !== undefined);
      result[6] = result[6].filter(block => !moved.includes(block));
      for (const block of moved) result[PRE_1_21_5_COLORS[block]].push(block);
    }
    return result;
  };
  return { blocks: adapt(BASE_COLORS.map(color => color.blocks)), excluded: adapt(EXCLUDED_BLOCKS) };
}

const catalogs = new Map<number, ReturnType<typeof buildCatalog>>(Object.values(MINECRAFT_VERSIONS).map(({ dataVersion }) =>
  [dataVersion, buildCatalog(dataVersion)] as const,
));

// Shared URLs can refer to versions no longer in the dropdown.
// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/lib/previewImageEdits.ts
// - src/lib/codecPreset.ts
export function getMinecraftCatalog(dataVersion: number = MINECRAFT_VERSIONS[DEFAULT_MINECRAFT_VERSION].dataVersion) {
  return catalogs.get(dataVersion) ?? buildCatalog(dataVersion);
}

// Custom states/colors remain user-controlled; waterlogged leaves are deliberately color 12.
// Callers:
// - src/lib/presetFallbacks.ts
export function isBlockCompatible(block: string, id: number, dataVersion: number): boolean {
  const previousColor = PRE_1_21_5_COLORS[blockId(block)];
  const changedColor = previousColor !== undefined && !block.includes("waterlogged=true");
  return isBlockAvailable(block, dataVersion) && (!changedColor || id === (dataVersion < 4325 ? previousColor : 6));
}

// Callers:
// - src/components/PresetFallbackDialog.tsx
export function getBlockFallbackVersion(block: string, id: number): { operator: "<" | ">"; version: string } | undefined {
  const versions = Object.keys(MINECRAFT_VERSIONS) as MinecraftVersion[];
  const compatible = versions.filter(version => isBlockCompatible(block, id, MINECRAFT_VERSIONS[version].dataVersion));
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
  const dataVersion = MINECRAFT_VERSIONS[version].dataVersion;
  return Object.fromEntries(BASE_COLORS.map((_, id) => {
    const preferred = selected[id] ?? "";
    const block = !preferred || isBlockCompatible(preferred, id, dataVersion) ? preferred
      : fallbacks[id]?.find(candidate => isBlockCompatible(candidate, id, dataVersion)) ?? "";
    return [id, getVersionedBlockName(block, dataVersion)];
  }));
}
