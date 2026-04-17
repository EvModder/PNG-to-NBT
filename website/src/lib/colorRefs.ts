/**
 * Public API:
 * - ColorRefKey
 * - getColorRefKey()
 * - parseColorRefKey()
 * - addColorRefCount()
 * - getColorRefCount()
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/lib/colorGridAnalysis.ts
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
export type ColorRefKey = number;

// Callers:
// - src/Index.tsx
// - src/lib/shapeAnalysis.ts
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
// - src/lib/colorGridAnalysis.ts
export function getColorRefKey(color: Pick<ColorRef, "id" | "isCustom">): ColorRefKey {
  return color.id * 2 + (color.isCustom ? 1 : 0);
}

// Callers:
// - src/Index.tsx
export function parseColorRefKey(key: ColorRefKey): ColorRef {
  return { isCustom: (key & 1) === 1, id: Math.floor(key / 2) };
}

// Callers:
// - src/lib/shapeAnalysis.ts
export function addColorRefCount(
  counts: Record<string, number>,
  color: Pick<ColorRef, "id" | "isCustom">,
  amount = 1,
): void {
  const key = getColorRefKey(color);
  counts[key] = (counts[key] ?? 0) + amount;
}

// Callers:
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export function getColorRefCount(
  counts: Record<string, number>,
  color: Pick<ColorRef, "id" | "isCustom">,
): number {
  return counts[getColorRefKey(color)] ?? 0;
}
