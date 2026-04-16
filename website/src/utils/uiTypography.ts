/**
 * Public API:
 * - SMALL_LABEL_TEXT_CLASS
 * - ACCENT_SMALL_LABEL_TEXT_CLASS
 * - INLINE_SMALL_LABEL_CONTROL_CLASS
 * - MUTED_INLINE_TOGGLE_CONTROL_CLASS
 * - PANEL_TITLE_TEXT_CLASS
 *
 * Callers:
 * - src/components/ToolbarPresetSettings.tsx
 * - src/components/ToolbarBuildSettings.tsx
 * - src/components/ToolbarFillerSettings.tsx
 * - src/components/PanelCredits.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PanelImagePreview.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/components/SecretsSettingsDialog.tsx
 */

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/ToolbarBuildSettings.tsx
// - src/components/ToolbarFillerSettings.tsx
// - src/components/PanelCredits.tsx
// - src/components/PanelColorBlockTable.tsx
export const SMALL_LABEL_TEXT_CLASS = "text-xs font-semibold leading-none whitespace-nowrap";

// Callers:
// - src/components/ToolbarPresetSettings.tsx
// - src/components/ToolbarBuildSettings.tsx
// - src/components/ToolbarFillerSettings.tsx
// - src/components/PanelCredits.tsx
// - src/components/PanelColorBlockTable.tsx
export const ACCENT_SMALL_LABEL_TEXT_CLASS = `${SMALL_LABEL_TEXT_CLASS} text-accent`;

// Callers:
// - src/components/PanelColorBlockTable.tsx
export const INLINE_SMALL_LABEL_CONTROL_CLASS =
  "flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap";

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
export const PANEL_TITLE_TEXT_CLASS = "text-sm font-semibold leading-none text-accent";
