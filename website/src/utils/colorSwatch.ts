/**
 * Public API:
 * - DEFAULT_SWATCH_SHADES
 * - SWATCH_TOOLTIP_OFFSET_PX
 * - formatSwatchHex()
 * - getOrderedSwatchShades()
 * - getMultiShadeSwatchStyle()
 * - getShadeAtPointer()
 * - getSwatchRequiredAccentText()
 *
 * Callers:
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PanelCustomColors.tsx
 */
import type { CSSProperties } from "react";
import { Shade } from "@/data/mapColors";

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export const DEFAULT_SWATCH_SHADES: readonly Shade[] = [Shade.Dark, Shade.Flat, Shade.Light];

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export const SWATCH_TOOLTIP_OFFSET_PX = 12;

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export function formatSwatchHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export function getOrderedSwatchShades(imageValid: boolean, usedShades?: ReadonlySet<Shade>): readonly Shade[] {
  if (!imageValid || !usedShades || usedShades.size === 0) return DEFAULT_SWATCH_SHADES;
  return [...usedShades].sort((a, b) => a - b);
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export function getMultiShadeSwatchStyle(colors: readonly [number, number, number][]): CSSProperties {
  if (colors.length <= 1) {
    const [r, g, b] = colors[0] ?? [0, 0, 0];
    return { backgroundColor: `rgb(${r},${g},${b})` };
  }

  const stops: string[] = [];
  for (let index = 0; index < colors.length; ++index) {
    const [r, g, b] = colors[index];
    const color = `rgb(${r},${g},${b})`;
    const start = (index * 100) / colors.length;
    const end = ((index + 1) * 100) / colors.length;
    stops.push(`${color} ${start}%`, `${color} ${end}%`);
  }
  return { backgroundImage: `linear-gradient(to bottom, ${stops.join(", ")})` };
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export function getShadeAtPointer(
  clientY: number,
  rect: Pick<DOMRect, "top" | "height">,
  swatchShades: readonly Shade[],
): Shade {
  const y = Math.min(rect.height - 0.001, Math.max(0, clientY - rect.top));
  const bandHeight = rect.height / swatchShades.length;
  const bandIndex = Math.min(swatchShades.length - 1, Math.max(0, Math.floor(y / bandHeight)));
  return swatchShades[bandIndex] ?? swatchShades[0] ?? Shade.Dark;
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export function getSwatchRequiredAccentText(
  imageValid: boolean,
  hasRequiredCol: boolean,
  shadeCount: number,
  formatRequiredCount: (count: number) => string | number,
): string | undefined {
  return imageValid && hasRequiredCol && shadeCount > 0 ? ` | R: ${formatRequiredCount(shadeCount)}` : undefined;
}
