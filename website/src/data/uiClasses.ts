/**
 * Shared UI class names.
 *
 * Public API:
 * - DESTRUCTIVE_SWATCH_SIZED_ICON_BUTTON_CLASS
 * - MUTED_SQUARE_ICON_BUTTON_CLASS
 * - PRIMARY_SQUARE_ICON_BUTTON_CLASS
 * - DESTRUCTIVE_SQUARE_ICON_BUTTON_CLASS
 * - INPUT_SQUARE_ICON_BUTTON_CLASS
 * - ACCENT_SMALL_LABEL_TEXT_CLASS
 * - MUTED_INLINE_TOGGLE_CONTROL_CLASS
 * - PANEL_TITLE_TEXT_CLASS
 *
 * Callers:
 * - src/components/ToolbarPresetSettings.tsx
 * - src/components/ToolbarBuildSettings.tsx
 * - src/components/PanelImagePreview.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/components/SecretsSettingsDialog.tsx
 * - src/components/PresetFallbackDialog.tsx
 * - src/components/ToolbarFillerSettings.tsx
 * - src/components/PanelCredits.tsx
 * - src/components/PanelColorBlockTable.tsx
 */

const SWATCH_SIZED_ICON_BUTTON_BASE_CLASS =
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border";

// Callers:
// - src/components/PanelCustomColors.tsx
// - src/components/PanelImagePreview.tsx
export const DESTRUCTIVE_SWATCH_SIZED_ICON_BUTTON_CLASS =
  `${SWATCH_SIZED_ICON_BUTTON_BASE_CLASS} border-destructive text-destructive hover:bg-destructive/20`;

const SQUARE_ICON_BUTTON_BASE_CLASS =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border";

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/SecretsSettingsDialog.tsx
// - src/components/PresetFallbackDialog.tsx
export const MUTED_SQUARE_ICON_BUTTON_CLASS =
  `${SQUARE_ICON_BUTTON_BASE_CLASS} border-border text-muted-foreground hover:text-foreground hover:border-primary/60`;

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/PanelCustomColors.tsx
export const PRIMARY_SQUARE_ICON_BUTTON_CLASS =
  `${SQUARE_ICON_BUTTON_BASE_CLASS} border-primary text-primary hover:bg-primary/20`;

// Callers:
// - src/components/ToolbarPresetSettings.tsx
export const DESTRUCTIVE_SQUARE_ICON_BUTTON_CLASS =
  `${SQUARE_ICON_BUTTON_BASE_CLASS} border-destructive text-destructive hover:bg-destructive/20`;

// Callers:
// - src/components/ToolbarBuildSettings.tsx
export const INPUT_SQUARE_ICON_BUTTON_CLASS =
  `${SQUARE_ICON_BUTTON_BASE_CLASS} border-border bg-input text-foreground hover:border-primary/60`;

const SMALL_LABEL_TEXT_CLASS = "text-xs font-semibold leading-none whitespace-nowrap";

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/ToolbarBuildSettings.tsx
// - src/components/ToolbarFillerSettings.tsx
// - src/components/PanelCredits.tsx
export const ACCENT_SMALL_LABEL_TEXT_CLASS = `${SMALL_LABEL_TEXT_CLASS} text-accent`;

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelImagePreview.tsx
export const MUTED_INLINE_TOGGLE_CONTROL_CLASS =
  "inline-flex h-3.5 items-center gap-1 text-[11px] leading-none text-muted-foreground cursor-pointer select-none whitespace-nowrap";

// Callers:
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelImagePreview.tsx
// - src/components/PanelCustomColors.tsx
// - src/components/SecretsSettingsDialog.tsx
// - src/components/PresetFallbackDialog.tsx
export const PANEL_TITLE_TEXT_CLASS = "text-sm font-semibold leading-none text-accent";
