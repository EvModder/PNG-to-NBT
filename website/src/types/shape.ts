/**
 * Public API:
 * - ShapePartType
 * - GeneratedShape
 * - ShapeCell
 * - ShapeColorRef
 * - ShapeCoordKey
 * - ShapePart
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/blockId.ts
 * - src/lib/buildModeShapes.ts
 * - src/lib/mixedStepHeights.ts
 * - src/lib/nbtExport.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeAnalysisCache.ts
 * - src/lib/shapeGeneration.ts
 * - src/lib/shapeModel.ts
 * - src/lib/suppressClearance.ts
 * - src/lib/suppressLoadMarkers.ts
 * - src/lib/tileGeometryWorkerTypes.ts
 */
import type { ColorRef } from "./color";
import type { BuildMode, FillerRole, SuppressStepDirection } from "./conversion";

// Callers:
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeGeneration.ts
// - src/lib/suppressClearance.ts
// - src/lib/suppressLoadMarkers.ts
export enum ShapePartType {
  SingleColumn = "single_column",
  SuppressStepPhases = "suppress_step_phases",
}

// Callers:
// - src/Index.tsx
// - src/lib/buildModeShapes.ts
// - src/lib/nbtExport.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeAnalysisCache.ts
// - src/lib/shapeGeneration.ts
// - src/lib/suppressClearance.ts
// - src/lib/suppressLoadMarkers.ts
// - src/lib/tileGeometryWorkerTypes.ts
export interface GeneratedShape {
  parts: ShapePart[];
  partType: ShapePartType;
  // Keep clearing schedules tied to their geometry while UI settings change.
  suppressStepLayout?: {
    buildMode: BuildMode.SuppressStepPairs | BuildMode.SuppressStepChecker;
    direction: SuppressStepDirection;
    centerOut: boolean;
  };
  splitExportNames: [string, string] | null;
  suppressedTransparentVsCollisionCount: number;
}

// Callers:
// - src/lib/shapeModel.ts
// - src/lib/shapeGeneration.ts
export type ShapeCell = ShapeColorRef | FillerRole[];

// Callers:
// - src/lib/blockId.ts
// - src/lib/mixedStepHeights.ts
// - src/lib/nbtExport.ts
// - src/lib/shapeGeneration.ts
// - src/lib/shapeModel.ts
// Keep pixel identity when a configured filler supplies its color.
export type ShapeColorRef = ColorRef & { fillerRole?: FillerRole };

// Callers:
// - src/lib/shapeModel.ts
// - src/lib/shapeGeneration.ts
export type ShapeCoordKey = number;

// Callers:
// - src/lib/suppressLoadMarkers.ts
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeModel.ts
// - src/lib/shapeGeneration.ts
// - src/lib/nbtExport.ts
export interface ShapePart {
  // Original phase index, unaffected by skipped empty steps or a water-preview part.
  suppressStepIndex?: number;
  cells: Map<ShapeCoordKey, ShapeCell>;
  bounds: {
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
  supportFloorYs: ReadonlySet<number>;
}
