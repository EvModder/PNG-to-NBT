/**
 * Public API:
 * - SupportMode
 * - ColumnId
 * - BlockDisplayMode
 * - SortKey
 * - SortDir
 *
 * Callers:
 * - src/data/i18n/*
 * - src/data/defaultSettings.ts
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/components/ToolbarPresetSettings.tsx
 * - src/lib/fillerRules.ts
 * - src/lib/messages.ts
 * - src/lib/codecPreset.ts
 * - tests/run.mts
 */

// Callers:
// - src/data/i18n/*
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/components/ToolbarPresetSettings.tsx
// - src/lib/fillerRules.ts
// - src/lib/messages.ts
// - src/lib/codecPreset.ts
// - tests/run.mts
export enum SupportMode {
  None = "none",
  All = "all",
  Steps = "steps",
  Fragile = "fragile",
  Water = "water",
}

// Callers:
// - src/data/i18n/*
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
// - src/lib/messages.ts
export type ColumnId = "clr" | "id" | "name" | "block" | "options" | "required";

// Callers:
// - src/data/i18n/*
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCustomColors.tsx
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
