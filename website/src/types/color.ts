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
 * - src/data/i18n/en.ts
 * - src/data/i18n/es.ts
 * - src/data/mapColors.ts
 * - src/data/presets.ts
 * - src/lib/blockId.ts
 * - src/lib/codecColorGrid.ts
 * - src/lib/codecPreset.ts
 * - src/lib/colorGridAnalysis.ts
 * - src/lib/colorGridParsing.ts
 * - src/lib/colorGridParsingCore.ts
 * - src/lib/colorRefs.ts
 * - src/lib/generationPolicy.ts
 * - src/lib/messages.ts
 * - src/lib/mixedStepHeights.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/tileGeometry.worker.ts
 * - src/lib/tileGeometryWorkerClient.ts
 * - src/lib/tileGeometryWorkerTypes.ts
 * - src/lib/tileParsingWorkerClient.ts
 * - src/lib/tileParsingWorkerTypes.ts
 * - src/types/shape.ts
 * - src/utils/color.ts
 * - src/utils/colorGridKey.ts
 * - src/utils/customColors.ts
 */

// Index 0=dark, 1=flat, 2=light, 3=darkest (not obtainable)
// References to Darkest or 3 should not occur anywhere else in the codebase.
// Callers:
// - src/data/i18n/en.ts
// - src/data/i18n/es.ts
// - src/data/mapColors.ts
// - src/lib/codecColorGrid.ts
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/generationPolicy.ts
// - src/lib/messages.ts
// - src/lib/mixedStepHeights.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
// - src/lib/tileGeometryWorkerClient.ts
// - src/lib/tileGeometryWorkerTypes.ts
// - src/utils/color.ts
export enum Shade {
  Dark = 0,
  Flat = 1,
  Light = 2,
  Darkest = 3,
}

// Callers:
// - src/components/PanelCustomColors.tsx
// - src/lib/blockId.ts
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorRefs.ts
// - src/lib/previewImageEdits.ts
// - src/types/shape.ts
// - src/utils/color.ts
export interface ColorRef {
  id: number;
  isCustom: boolean;
}

// Callers:
// - src/lib/codecColorGrid.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/mixedStepHeights.ts
// - src/lib/shapeGeneration.ts
// - src/utils/color.ts
export interface ShadedColorRef extends ColorRef {
  shade: Shade;
}

// Callers:
// - src/Index.tsx
// - src/lib/codecColorGrid.ts
// - src/lib/colorGridAnalysis.ts
// - src/lib/colorGridParsing.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/generationPolicy.ts
// - src/lib/mixedStepHeights.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
// - src/lib/tileGeometry.worker.ts
// - src/lib/tileGeometryWorkerTypes.ts
// - src/lib/tileParsingWorkerTypes.ts
// - src/utils/color.ts
// - src/utils/colorGridKey.ts
export type ColorGrid = ShadedColorRef[][];

// Callers:
// - src/Index.tsx
// - src/components/PanelCustomColors.tsx
// - src/data/presets.ts
// - src/lib/blockId.ts
// - src/lib/codecPreset.ts
// - src/lib/colorGridParsing.ts
// - src/lib/colorGridParsingCore.ts
// - src/lib/tileParsingWorkerClient.ts
// - src/lib/tileParsingWorkerTypes.ts
// - src/utils/color.ts
// - src/utils/customColors.ts
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
