/**
 * Public API:
 * - ColorRefKey
 * - getColorRefKey()
 * - parseColorRefKey()
 * - getColorRefCount()
 *
 * Callers:
 * - src/lib/generationPolicy.ts
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/lib/colorGridAnalysis.ts
 * - src/lib/colorGridParsingCore.ts
 * - src/lib/mixedStepHeights.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 */
import type { ColorRef } from "@/types/color";

// Encodes { id, isCustom } into a compact numeric key:
// - even keys = base colors
// - odd keys = custom colors
// The decoded id is Math.floor(key / 2).
//
// Callers:
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/mixedStepHeights.ts
// - src/lib/generationPolicy.ts
export type ColorRefKey = number;

// Callers:
// - src/Index.tsx
// - src/lib/shapeAnalysis.ts
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/generationPolicy.ts
export function getColorRefKey(color: Pick<ColorRef, "id" | "isCustom">): ColorRefKey {
  return color.id * 2 + (color.isCustom ? 1 : 0);
}

// Callers:
// - src/Index.tsx
// - src/lib/colorGridAnalysis.ts
// - src/lib/mixedStepHeights.ts
// - src/lib/previewImageEdits.ts
export function parseColorRefKey(key: ColorRefKey): ColorRef {
  return { isCustom: (key & 1) === 1, id: Math.floor(key / 2) };
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export function getColorRefCount(
  counts: Record<string, number>,
  color: Pick<ColorRef, "id" | "isCustom">,
): number {
  return counts[getColorRefKey(color)] ?? 0;
}
