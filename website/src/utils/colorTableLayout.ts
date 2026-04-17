/**
 * Public API:
 * - APPROX_TABLE_MONO_CHAR_WIDTH_PX
 * - INITIAL_BLOCK_SELECT_HORIZONTAL_INSETS_PX
 * - ColorTableLayout
 * - COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX
 * - MIN_REQUIRED_COLUMN_WIDTH_PX
 * - INITIAL_COLOR_TABLE_LAYOUT
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PanelCustomColors.tsx
 */
import { DEFAULT_BLOCK_COLUMN_EXPANDED } from "@/data/defaultSettings";
import { BASE_COLORS } from "@/data/mapColors";

// Initial select padding+border estimate used before the real select control has been measured.
// Callers:
// - src/components/PanelColorBlockTable.tsx
export const INITIAL_BLOCK_SELECT_HORIZONTAL_INSETS_PX = 10;
const COLOR_SWATCH_BUTTON_SIZE_PX = 20; // `w-5 h-5`
const COLOR_SWATCH_COLUMN_BREATHING_PX = 4;
// Shared small-table monospace width approximation used for static/cached column sizing.
// It intentionally covers the current 10px/11px mono UI controls closely enough for a stable
// precomputed width without requiring per-load measurement.
// Callers:
// - src/components/PanelColorBlockTable.tsx
export const APPROX_TABLE_MONO_CHAR_WIDTH_PX = 6.15;
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

function getLongestDefaultAssignedBaseBlockName(): string {
  return BASE_COLORS.reduce(
    (longest, color) => ((color.blocks[0] ?? "").length > longest.length ? (color.blocks[0] ?? "") : longest),
    "",
  );
}

const MAX_BASE_COLOR_ID_TEXT = String(BASE_COLORS.length - 1);
const LONGEST_BASE_COLOR_NAME = getLongestBaseColorName();
const LONGEST_DEFAULT_ASSIGNED_BASE_BLOCK_NAME = getLongestDefaultAssignedBaseBlockName();

// Fixed column widths are intentionally static rather than measured on every page load.
// They are still derived here from the exact representative content/rules the UI is sized for:
// - `clr`: swatch button (`20px`) plus `4px` breathing room -> `24px`
// - `id`: max current base-color id text (`"61"`) plus sort-arrow/header breathing -> `24px`
// - `name`: longest current base color name (`"TERRACOTTA_LIGHT_GREEN"`) at ~`6.15px` per
//   monospace character in the current table font -> `135px`
// - `options`: header label (`"Options"`) plus sort-arrow/header breathing -> `48px`
//
// This keeps the widths static/cached while making their provenance explicit in code.
// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
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
// Its floor is still derived from the header label, sort-arrow slot, and the extra right-side
// breathing room needed by the current right-aligned header treatment:
//   "Required" -> 8 chars * 5px + 8px sort slot + 22px padding/breathing = 70px
// Callers:
// - src/components/PanelColorBlockTable.tsx
export const MIN_REQUIRED_COLUMN_WIDTH_PX = estimateHeaderColumnWidthPx("Required", 22);

// Callers:
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
export type ColorTableLayout = {
  blockWidthPx: number;
  requiredWidthPx: number;
  blockExpanded: boolean;
};

// This is an initial pre-measure fallback used before the main table reports its real measured
// block-column width upward. It is intentionally derived from the longest current default-assigned
// base block label (`"light_blue_terracotta"`) plus the table's current select inset estimate:
//   21 chars * 6.15px + 10px ~= 139px
// Rounded up to 139px by the estimate function below.
// Callers:
// - src/Index.tsx
export const INITIAL_COLOR_TABLE_LAYOUT: Readonly<ColorTableLayout> = Object.freeze({
  blockWidthPx:
    estimateApproxTableMonoTextWidthPx(LONGEST_DEFAULT_ASSIGNED_BASE_BLOCK_NAME) +
    INITIAL_BLOCK_SELECT_HORIZONTAL_INSETS_PX,
  requiredWidthPx: MIN_REQUIRED_COLUMN_WIDTH_PX,
  blockExpanded: DEFAULT_BLOCK_COLUMN_EXPANDED,
});
