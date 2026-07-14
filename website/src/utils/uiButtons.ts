/**
 * Public API:
 * - SWATCH_SIZED_ICON_BUTTON_BASE_CLASS
 * - MUTED_SWATCH_SIZED_ICON_BUTTON_CLASS
 * - PRIMARY_SWATCH_SIZED_ICON_BUTTON_CLASS
 * - DESTRUCTIVE_SWATCH_SIZED_ICON_BUTTON_CLASS
 * - SQUARE_ICON_BUTTON_BASE_CLASS
 * - MUTED_SQUARE_ICON_BUTTON_CLASS
 * - PRIMARY_SQUARE_ICON_BUTTON_CLASS
 * - DESTRUCTIVE_SQUARE_ICON_BUTTON_CLASS
 * - INPUT_SQUARE_ICON_BUTTON_CLASS
 *
 * Callers:
 * - src/components/ToolbarPresetSettings.tsx
 * - src/components/ToolbarBuildSettings.tsx
 * - src/components/PanelImagePreview.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/components/SecretsSettingsDialog.tsx
 */

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/PanelCustomColors.tsx
// - src/components/PanelImagePreview.tsx
export const SWATCH_SIZED_ICON_BUTTON_BASE_CLASS =
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border";

// Callers:
// - src/components/ToolbarPresetSettings.tsx
export const MUTED_SWATCH_SIZED_ICON_BUTTON_CLASS =
  `${SWATCH_SIZED_ICON_BUTTON_BASE_CLASS} border-border text-muted-foreground hover:text-foreground hover:border-primary/60`;

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/PanelCustomColors.tsx
export const PRIMARY_SWATCH_SIZED_ICON_BUTTON_CLASS =
  `${SWATCH_SIZED_ICON_BUTTON_BASE_CLASS} border-primary text-primary hover:bg-primary/20`;

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/PanelCustomColors.tsx
// - src/components/PanelImagePreview.tsx
export const DESTRUCTIVE_SWATCH_SIZED_ICON_BUTTON_CLASS =
  `${SWATCH_SIZED_ICON_BUTTON_BASE_CLASS} border-destructive text-destructive hover:bg-destructive/20`;

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/PanelCustomColors.tsx
// - src/components/ToolbarBuildSettings.tsx
// - src/components/SecretsSettingsDialog.tsx
export const SQUARE_ICON_BUTTON_BASE_CLASS =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border";

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/SecretsSettingsDialog.tsx
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
