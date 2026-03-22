/**
 * Public API:
 * - PreviewPixelReplacement
 * - collectVsFillerPreviewReplacements()
 * - useVsFillerPreviewReplacements()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/previewImageStore.ts
 */
import { useMemo } from "react";
import { BASE_COLORS, TRANSPARENCY_BASE_INDEX } from "@/data/mapColors";
import { EXCLUDED_BLOCKS } from "@/data/mapColorsExcluded";
import { normalizeBlockId } from "@/utils/blockId";
import { FillerRole } from "@/types/conversion";
import type { GeneratedShape } from "@/types/shape";
import { isShadeFillerDisabled } from "@/lib/fillerRules";
import { collectFillerRolePixels } from "@/lib/shapeAnalysis";

// Callers:
// - src/lib/previewImageStore.ts
export interface PreviewPixelReplacement {
  x: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

const BLOCK_BASE_COLOR_INDEX = new Map<string, number>(
  [...BASE_COLORS.entries()].flatMap(([baseIndex, baseColor]) =>
    [
      ...baseColor.blocks,
      ...(EXCLUDED_BLOCKS[baseIndex] ?? []),
    ].map(block => [normalizeBlockId(block), baseIndex] as const),
  ),
);

function getBlockLightShadeReplacement(block: string): readonly [number, number, number] | null {
  const baseIndex = BLOCK_BASE_COLOR_INDEX.get(normalizeBlockId(block));
  if (baseIndex === undefined || baseIndex === TRANSPARENCY_BASE_INDEX) return null;
  const { r, g, b } = BASE_COLORS[baseIndex];
  return [r, g, b];
}

type CollectVsFillerPreviewReplacementOptions = {
  shape: GeneratedShape | null;
  shadeFillerBlock: string;
  dominateVoidFillerBlock: string;
  recessiveVoidFillerBlock: string;
  xColumnRange?: [number, number];
};

// Callers:
// - src/lib/previewImageStore.ts
export function collectVsFillerPreviewReplacements(
  {
    shape,
    shadeFillerBlock,
    dominateVoidFillerBlock,
    recessiveVoidFillerBlock,
    xColumnRange,
  }: CollectVsFillerPreviewReplacementOptions,
): PreviewPixelReplacement[] {
  if (!shape) return [];

  const dominantBlock = dominateVoidFillerBlock || shadeFillerBlock;
  const recessiveBlock = recessiveVoidFillerBlock || shadeFillerBlock;
  const dominantRgb = isShadeFillerDisabled(dominantBlock) ? null : getBlockLightShadeReplacement(dominantBlock);
  const recessiveRgb = isShadeFillerDisabled(recessiveBlock) ? null : getBlockLightShadeReplacement(recessiveBlock);

  const roles = [
    ...(dominantRgb ? [FillerRole.ShadeVoidDominant] : []),
    ...(recessiveRgb ? [FillerRole.ShadeVoidRecessive] : []),
  ];
  if (roles.length === 0) return [];

  return collectFillerRolePixels(shape, roles, xColumnRange).flatMap(({ x, z, role }) => {
    const rgb = role === FillerRole.ShadeVoidDominant ? dominantRgb : recessiveRgb;
    if (!rgb) return [];
    const [r, g, b] = rgb;
    return [{ x, z, r, g, b }];
  });
}

// Callers:
// - src/Index.tsx
export function useVsFillerPreviewReplacements(
  options: CollectVsFillerPreviewReplacementOptions,
): PreviewPixelReplacement[] {
  return useMemo(
    () => collectVsFillerPreviewReplacements(options),
    [
      options.shape,
      options.shadeFillerBlock,
      options.dominateVoidFillerBlock,
      options.recessiveVoidFillerBlock,
      options.xColumnRange?.[0],
      options.xColumnRange?.[1],
    ],
  );
}
