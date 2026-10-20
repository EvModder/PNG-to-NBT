/**
 * Public API:
 * - measureNoWrapSectionWidth()
 * - measureToolbarWidths()
 *
 * Callers:
 * - src/components/PanelColorBlockTable.tsx
 * - src/Index.tsx
 */
// Callers:
// - src/components/PanelColorBlockTable.tsx
export function measureNoWrapSectionWidth(el: HTMLElement): number {
  const { width, minWidth, maxWidth, flexWrap } = el.style;
  el.style.width = "max-content";
  el.style.minWidth = "max-content";
  el.style.maxWidth = "none";
  el.style.flexWrap = "nowrap";
  const measured = Math.ceil(el.getBoundingClientRect().width);
  el.style.width = width;
  el.style.minWidth = minWidth;
  el.style.maxWidth = maxWidth;
  el.style.flexWrap = flexWrap;
  return measured;
}

export function measureToolbarWidths(
  presetEl: HTMLElement | null,
  fillerEl: HTMLElement | null,
): { presetWidth: number; fillerWidth: number } {
  const presetWidth = presetEl ? measureNoWrapSectionWidth(presetEl) : 0;
  if (!fillerEl) return { presetWidth, fillerWidth: 0 };

  // Keep the compact width as the layout threshold, regardless of input expansion.
  fillerEl.style.removeProperty("--filler-input-width");
  const fillerWidth = measureNoWrapSectionWidth(fillerEl);
  // Expand into actual free space, not the other sections' minimum widths.
  const availableWidth = fillerEl.getBoundingClientRect().width;
  if (fillerWidth < availableWidth) {
    fillerEl.style.setProperty("--filler-input-width", "160px");
    if (measureNoWrapSectionWidth(fillerEl) > availableWidth) {
      fillerEl.style.removeProperty("--filler-input-width");
    }
  }
  return { presetWidth, fillerWidth };
}
