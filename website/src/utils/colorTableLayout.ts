/**
 * Public API:
 * - APPROX_TABLE_MONO_CHAR_WIDTH_PX
 * - INITIAL_BLOCK_SELECT_HORIZONTAL_INSETS_PX
 * - COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX
 * - MIN_REQUIRED_COLUMN_WIDTH_PX
 * - COLOR_TABLE_GRID_GAP_PX
 * - COLOR_TABLE_SECTION_HORIZONTAL_INSETS_PX
 *
 * Callers:
 * - src/components/PanelColorBlockTable.tsx
 */
import { BASE_COLORS } from "@/data/mapColors";

// Initial select padding+border estimate used before the real select control has been measured.
// Callers:
// - src/components/PanelColorBlockTable.tsx
export const INITIAL_BLOCK_SELECT_HORIZONTAL_INSETS_PX = 10;

// Shared small-table monospace width approximation used for static/cached column sizing.
// Callers:
// - src/components/PanelColorBlockTable.tsx
export const APPROX_TABLE_MONO_CHAR_WIDTH_PX = 6.15;

// `gap-1` in the row grid.
// Callers:
// - src/components/PanelColorBlockTable.tsx
export const COLOR_TABLE_GRID_GAP_PX = 4;

// Horizontal `p-2` plus the 1px left/right border of the table container.
// Callers:
// - src/components/PanelColorBlockTable.tsx
export const COLOR_TABLE_SECTION_HORIZONTAL_INSETS_PX = 8 * 2 + 1 * 2;

const COLOR_SWATCH_BUTTON_SIZE_PX = 20; // `w-5 h-5`
const COLOR_SWATCH_COLUMN_BREATHING_PX = 4;
const TABLE_HEADER_10PX_CHAR_WIDTH_PX = 5;
const TABLE_HEADER_SORT_ARROW_SLOT_PX = 8;

function estimateHeaderColumnWidthPx(label: string, extraInlinePx = 0): number {
  return Math.round(label.length * TABLE_HEADER_10PX_CHAR_WIDTH_PX + TABLE_HEADER_SORT_ARROW_SLOT_PX + extraInlinePx);
}

function estimateApproxTableMonoTextWidthPx(text: string): number {
  return Math.round(text.length * APPROX_TABLE_MONO_CHAR_WIDTH_PX);
}

function getLongestBaseColorName(): string {
  return BASE_COLORS.reduce(
    (longest, color) => (color.name.length > longest.length ? color.name : longest),
    "",
  );
}

const MAX_BASE_COLOR_ID_TEXT = String(BASE_COLORS.length - 1);
const LONGEST_BASE_COLOR_NAME = getLongestBaseColorName();

// Fixed column widths are intentionally static rather than measured on every page load.
// They are still derived here from the representative content/rules the UI is sized for.
// Callers:
// - src/components/PanelColorBlockTable.tsx
export const COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX = Object.freeze({
  clr: COLOR_SWATCH_BUTTON_SIZE_PX + COLOR_SWATCH_COLUMN_BREATHING_PX,
  id: Math.max(
    estimateApproxTableMonoTextWidthPx(MAX_BASE_COLOR_ID_TEXT),
    estimateHeaderColumnWidthPx("ID", 6),
  ),
  name: estimateApproxTableMonoTextWidthPx(LONGEST_BASE_COLOR_NAME),
  options: estimateHeaderColumnWidthPx("Options", 5),
});

// Required is the only column that still grows dynamically with row values.
// Its floor remains derived from the header label, sort-arrow slot, and right-side breathing room.
// Callers:
// - src/components/PanelColorBlockTable.tsx
export const MIN_REQUIRED_COLUMN_WIDTH_PX = estimateHeaderColumnWidthPx("Required", 22);
