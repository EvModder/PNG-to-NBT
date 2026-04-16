/**
 * Public API:
 * - Shade
 * - ColorRef
 * - ShadedColorRef
 * - ColorGrid
 * - ColorRgb
 * - ColorRgbBase
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/data/i18n/*
 * - src/data/mapColors.ts
 * - src/utils/color.ts
 * - src/utils/colorGridKey.ts
 * - src/lib/blockId.ts
 * - src/lib/colorGridAnalysis.ts
 * - src/lib/colorGridParsingCore.ts
 * - src/lib/colorGridParsing.ts
 * - src/lib/codecColorGrid.ts
 * - src/lib/messages.ts
 * - src/lib/codecPreset.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeModel.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/nbtExport.ts
 * - src/lib/tileGeometryWorkerTypes.ts
 * - src/lib/tileParsingWorkerClient.ts
 * - src/lib/tileParsingWorkerTypes.ts
 * - tests/run.mts
 */

// Index 0=dark, 1=flat, 2=light, 3=darkest (not obtainable)
// References to Darkest or 3 should not occur anywhere else in the codebase.
// Callers:
// - src/data/i18n/*
// - src/data/mapColors.ts
// - src/utils/color.ts
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsing.ts
// - src/lib/codecColorGrid.ts
// - src/lib/messages.ts
// - src/lib/shapeGeneration.ts
// - src/Index.tsx
// - tests/run.mts
export enum Shade {
  Dark = 0,
  Flat = 1,
  Light = 2,
  Darkest = 3,
}

// Callers:
// - src/utils/color.ts
// - src/lib/colorGridAnalysis.ts
// - src/lib/blockId.ts
// - src/lib/shapeModel.ts
// - src/lib/shapeGeneration.ts
// - src/lib/nbtExport.ts
// - src/types/shape.ts
export interface ColorRef {
  id: number;
  isCustom: boolean;
}

// Callers:
// - src/utils/color.ts
// - src/lib/colorGridParsing.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/codecColorGrid.ts
// - src/lib/shapeGeneration.ts
export interface ShadedColorRef extends ColorRef {
  shade: Shade;
}

// Callers:
// - src/utils/color.ts
// - src/utils/colorGridKey.ts
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsing.ts
// - src/lib/codecColorGrid.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
// - src/lib/tileGeometryWorkerTypes.ts
// - src/lib/tileParsingWorkerTypes.ts
export type ColorGrid = ShadedColorRef[][];

// Callers:
// - src/Index.tsx
// - src/components/PanelCustomColors.tsx
// - src/utils/color.ts
// - src/lib/blockId.ts
// - src/lib/codecPreset.ts
// - src/lib/colorGridParsing.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/codecColorGrid.ts
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeModel.ts
// - src/lib/tileParsingWorkerClient.ts
// - src/lib/tileParsingWorkerTypes.ts
// - tests/run.mts
export interface ColorRgb {
  r: number;
  g: number;
  b: number;
  blocks: string[];
}

// Callers:
// - src/data/mapColors.ts
export interface ColorRgbBase extends ColorRgb {
  name: string;
}
