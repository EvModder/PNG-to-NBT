/**
 * Public API: isGrowthCoverEnabled(), getEnvironmentalSettings(), scopeEnvironmentalPalette(), isGrowthCoverValid()
 * Callers:
 * - src/Index.tsx
 * - src/components/ToolbarFillerSettings.tsx
 * - src/lib/shapeGeneration.ts
 * - src/lib/tileGeometryWorkerTypes.ts
 */
import { isFragileBlock } from "@/data/fragileBlocks";
import { DEFAULT_GROWTH_COVER_BLOCK } from "@/data/defaultSettings";
import { normalizeBlockId, resolveAssignedColorBlock, type ColorBlockSelections } from "./blockId";
import { parseColorRefKey, type ColorRefKey } from "./colorRefs";
import { isFillerDisabled, isWaterSideSupportFillerValid } from "./fillerRules";
import { FillerRole } from "@/types/conversion";

function environmentalRole(id: string): FillerRole | undefined {
  // Bonemeal-only plants (azaleas, fungi) and potted saplings do not grow on their own.
  if ((id.endsWith("_sapling") && !id.startsWith("potted_")) || id === "mangrove_propagule" || id === "twisting_vines") return FillerRole.GrowthCover;
  if (/^(tube|brain|bubble|fire|horn)_coral(_block|_fan)?$/.test(id)) return FillerRole.CoralSupport;
}

export function isGrowthCoverEnabled(block: string): boolean {
  return !isFillerDisabled(block.trim() || "air");
}

// Classify once per used palette, not once per generated block. Names/states that
// need the same geometry share cache entries; filler validity is checked separately.
export function getEnvironmentalSettings(
  usedColors: Iterable<ColorRefKey>, selections: ColorBlockSelections, coverEnabled = isGrowthCoverEnabled(DEFAULT_GROWTH_COVER_BLOCK),
) {
  const roles: Record<number, FillerRole> = {};
  let growthCover: "required" | "optional" | undefined;
  for (const key of usedColors) {
    const id = normalizeBlockId(resolveAssignedColorBlock(parseColorRefKey(key), selections));
    const role = environmentalRole(id);
    if (role === FillerRole.GrowthCover) {
      growthCover = id === "twisting_vines" ? growthCover ?? "optional" : "required";
      if (!coverEnabled) continue;
    }
    if (role) roles[key] = role;
  }
  return { growthCover, palette: makeEnvironmentalPalette(roles) };
}

function makeEnvironmentalPalette(roles: Record<number, FillerRole>) {
  const values = Object.values(roles);
  return values.length ? { roles, key: JSON.stringify(roles), minimumLayerGap: values.includes(FillerRole.CoralSupport) ? 3 : 2 } : undefined;
}

// Keep only placements possible in this geometry job. Shared layer spacing is passed separately.
export function scopeEnvironmentalPalette(palette: ReturnType<typeof makeEnvironmentalPalette>, uses: (key: ColorRefKey) => boolean) {
  if (!palette) return undefined;
  let subset: Record<number, FillerRole> | undefined;
  for (const key in palette.roles) if (!uses(Number(key))) {
    subset ??= { ...palette.roles };
    delete subset[Number(key)];
  }
  return subset ? makeEnvironmentalPalette(subset) : palette;
}

export function isGrowthCoverValid(block: string): boolean {
  return isWaterSideSupportFillerValid(block) && !isFragileBlock(normalizeBlockId(block))
    && !/waterlogged\s*=\s*true/.test(block);
}

