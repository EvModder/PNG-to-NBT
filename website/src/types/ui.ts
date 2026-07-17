/**
 * Public API:
 * - SupportMode
 * - ColumnId
 * - BlockDisplayMode
 * - SortKey
 * - SortDir
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/components/ToolbarPresetSettings.tsx
 * - src/data/defaultSettings.ts
 * - src/data/i18n/en.ts
 * - src/data/i18n/es.ts
 * - src/lib/codecPreset.ts
 * - src/lib/fillerRules.ts
 * - src/lib/messages.ts
 */

// Callers:
// - src/Index.tsx
// - src/components/ToolbarPresetSettings.tsx
// - src/data/defaultSettings.ts
// - src/data/i18n/en.ts
// - src/data/i18n/es.ts
// - src/lib/codecPreset.ts
// - src/lib/fillerRules.ts
// - src/lib/messages.ts
export enum SupportMode {
  None = "none",
  All = "all",
  Steps = "steps",
  Fragile = "fragile",
  Water = "water",
}

// Callers:
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
// - src/data/defaultSettings.ts
// - src/data/i18n/en.ts
// - src/data/i18n/es.ts
// - src/lib/messages.ts
export type ColumnId = "clr" | "id" | "name" | "block" | "options" | "required";

// Callers:
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
// - src/data/defaultSettings.ts
// - src/data/i18n/en.ts
// - src/data/i18n/es.ts
// - src/lib/messages.ts
export type BlockDisplayMode = "names" | "textures";

// Callers:
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export type SortKey = "default" | "name" | "options" | "color" | "id" | "required";

// Callers:
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
export type SortDir = "asc" | "desc";
