/**
 * Public API:
 * - SupportMode
 * - ColumnId
 * - BlockDisplayMode
 *
 * Callers:
 * - src/data/i18n/*
 * - src/data/defaultSettings.ts
 * - src/Index.tsx
 * - src/lib/fillerRules.ts
 * - src/lib/messages.ts
 * - src/lib/presetCodec.ts
 */

// Callers:
// - src/data/i18n/*
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/lib/fillerRules.ts
// - src/lib/messages.ts
// - src/lib/presetCodec.ts
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
// - src/lib/messages.ts
export type ColumnId = "clr" | "id" | "name" | "block" | "options" | "required";

// Callers:
// - src/data/i18n/*
// - src/data/defaultSettings.ts
// - src/Index.tsx
// - src/lib/messages.ts
export type BlockDisplayMode = "names" | "textures";
