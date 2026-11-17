/**
 * Public API:
 * - measureNoWrapSectionWidth()
 * - measureToolbarWidths()
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
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

const FIT_INPUT_SELECTOR = "input[data-fit-value]";
const FIT_WIDTH_PROPERTY = "--filler-input-width";

// Width that shows the committed value (or the placeholder) with even side padding.
function measureFitWidth(input: HTMLInputElement, context: CanvasRenderingContext2D): number {
  const style = getComputedStyle(input);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const frame = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
    .reduce((sum, value) => sum + parseFloat(value), 0);
  return Math.ceil(context.measureText(input.dataset.fitValue || input.placeholder).width + frame);
}

// Splits free space so smaller needs are met in full and larger ones share the rest equally.
function shareFreeWidth(needs: readonly number[], free: number): number[] {
  const extra = needs.map(() => 0);
  let left = free;
  [...needs.keys()].sort((a, b) => needs[a] - needs[b]).forEach((index, rank) => {
    extra[index] = Math.min(needs[index], Math.floor(left / (needs.length - rank)));
    left -= extra[index];
  });
  return extra;
}

function fitInputsToValues(fillerEl: HTMLElement, compactWidth: number, availableWidth: number): void {
  const inputs = [...fillerEl.querySelectorAll<HTMLInputElement>(FIT_INPUT_SELECTOR)];
  const context = document.createElement("canvas").getContext("2d");
  if (!inputs.length || !context) return;
  const baseWidths = inputs.map(input => input.getBoundingClientRect().width);
  const needs = inputs.map((input, index) => Math.max(0, measureFitWidth(input, context) - baseWidths[index]));
  const apply = (free: number) => shareFreeWidth(needs, free).forEach((extra, index) => {
    if (extra > 0) inputs[index].style.setProperty(FIT_WIDTH_PROPERTY, `${baseWidths[index] + extra}px`);
    else inputs[index].style.removeProperty(FIT_WIDTH_PROPERTY);
  });
  apply(availableWidth - compactWidth);
  // Sub-pixel layout can round past the free space; give back the overshoot once.
  const overshoot = measureNoWrapSectionWidth(fillerEl) - availableWidth;
  if (overshoot > 0) apply(availableWidth - compactWidth - overshoot);
}

export function measureToolbarWidths(
  presetEl: HTMLElement | null,
  fillerEl: HTMLElement | null,
): { presetWidth: number; fillerWidth: number } {
  const presetWidth = presetEl ? measureNoWrapSectionWidth(presetEl) : 0;
  if (!fillerEl) return { presetWidth, fillerWidth: 0 };

  // Keep the compact width as the layout threshold, regardless of input expansion.
  for (const input of fillerEl.querySelectorAll<HTMLInputElement>(FIT_INPUT_SELECTOR)) input.style.removeProperty(FIT_WIDTH_PROPERTY);
  const fillerWidth = measureNoWrapSectionWidth(fillerEl);
  // Expand into actual free space, not the other sections' minimum widths.
  const availableWidth = fillerEl.getBoundingClientRect().width;
  if (fillerWidth < availableWidth) fitInputsToValues(fillerEl, fillerWidth, availableWidth);
  return { presetWidth, fillerWidth };
}
