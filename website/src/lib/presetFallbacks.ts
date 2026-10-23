/**
 * Public API:
 * - normalizeBlockFallbacks()
 * - areBlockFallbacksEqual()
 * - updatePresetBlockSelection()
 * Callers:
 * - src/Index.tsx
 * - src/lib/codecPreset.ts
 */
import { BASE_COLORS } from "@/data/mapColors";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import type { BlockPreset } from "@/data/presets";
import { getVersionedBlockName, isBlockCompatible } from "@/lib/minecraftVersion";

type BlockFallbacks = NonNullable<BlockPreset["blockFallbacks"]>;

// Callers:
// - src/Index.tsx
// - src/lib/codecPreset.ts
export function normalizeBlockFallbacks(value: unknown, selected: Record<number, string>): BlockFallbacks | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: BlockFallbacks = {};
  for (const [key, blocks] of Object.entries(value)) {
    const id = Number(key);
    if (!Number.isInteger(id) || !BASE_COLORS[id] || !selected[id] || !Array.isArray(blocks)) continue;
    const unique = [...new Set(blocks.filter((block): block is string =>
      typeof block === "string" && block !== "" && block !== selected[id],
    ))];
    if (unique.length) result[id] = unique;
  }
  return Object.keys(result).length ? result : undefined;
}

// Callers:
// - src/Index.tsx
export function areBlockFallbacksEqual(left: BlockPreset["blockFallbacks"], right: BlockPreset["blockFallbacks"]): boolean {
  return BASE_COLORS.every((_, id) => {
    const a = left?.[id] ?? [], b = right?.[id] ?? [];
    return a.length === b.length && a.every((block, index) => block === b[index]);
  });
}

// Returns null when replacing an unavailable preference needs user confirmation.
// Callers:
// - src/Index.tsx
export function updatePresetBlockSelection(
  preset: BlockPreset, id: number, block: string, version: MinecraftVersion,
  choice?: "replace" | "fallback",
): Pick<BlockPreset, "selectedBlocks" | "blockFallbacks"> | null {
  const dataVersion = MINECRAFT_VERSIONS[version].dataVersion;
  const preferred = preset.selectedBlocks[id] ?? "";
  if (!choice && preferred && block && isBlockCompatible(block, id, dataVersion)
    && !isBlockCompatible(preferred, id, dataVersion)) return null;
  const selectedBlocks = { ...preset.selectedBlocks, [id]: choice === "fallback" ? preferred : block };
  let choices: string[] = [];
  if (choice === "fallback") {
    // The new choice supersedes every alternative selectable in this version.
    choices = (preset.blockFallbacks?.[id] ?? []).filter(candidate => !isBlockCompatible(candidate, id, dataVersion));
    choices.push(block);
  }
  // Renames such as chain/iron_chain are one preference, not separate fallbacks.
  const seen = new Set([getVersionedBlockName(selectedBlocks[id], dataVersion)]);
  choices = choices.filter(candidate => {
    const name = getVersionedBlockName(candidate, dataVersion);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  const blockFallbacks = normalizeBlockFallbacks({ ...preset.blockFallbacks, [id]: choices }, selectedBlocks);
  return { selectedBlocks, blockFallbacks };
}
