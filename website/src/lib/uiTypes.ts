/**
 * Public API:
 * - SupportMode
 * - ColumnId
 * - BlockDisplayMode
 *
 * Callers:
 * - src/data/i18n/*
 * - src/Index.tsx
 * - src/lib/messages.ts
 */

// Callers:
// - src/data/i18n/*
// - src/Index.tsx
// - src/lib/messages.ts
export enum SupportMode {
  None = "none",
  Steps = "steps",
  All = "all",
  Fragile = "fragile",
  Water = "water",
}

// Callers:
// - src/data/i18n/*
// - src/Index.tsx
// - src/lib/messages.ts
export type ColumnId = "clr" | "id" | "name" | "block" | "options" | "required";

// Callers:
// - src/data/i18n/*
// - src/Index.tsx
// - src/lib/messages.ts
export type BlockDisplayMode = "names" | "textures";
