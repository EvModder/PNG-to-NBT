/**
 * Public API:
 * - measureToolbarWidths()
 *
 * Callers:
 * - src/Index.tsx
 */
function measureNoWrapSectionWidth(el: HTMLElement): number {
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
  colorTableWidth: number,
): { presetWidth: number; fillerWidth: number } {
  const presetWidth = presetEl ? measureNoWrapSectionWidth(presetEl) : 0;
  if (!fillerEl) return { presetWidth, fillerWidth: 0 };

  // Keep the compact width as the layout threshold, regardless of input expansion.
  fillerEl.style.removeProperty("--filler-input-width");
  const fillerWidth = measureNoWrapSectionWidth(fillerEl);
  const availableWidth = Math.min(Math.max(presetWidth, colorTableWidth), fillerEl.getBoundingClientRect().width);
  if (fillerWidth < availableWidth) {
    fillerEl.style.setProperty("--filler-input-width", "181px");
    if (measureNoWrapSectionWidth(fillerEl) > availableWidth) {
      fillerEl.style.removeProperty("--filler-input-width");
    }
  }
  return { presetWidth, fillerWidth };
}
