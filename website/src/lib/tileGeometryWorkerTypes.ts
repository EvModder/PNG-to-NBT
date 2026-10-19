/**
 * Public API:
 * - TileWaterSetting
 * - TileBaseGeometryWorkerInput
 * - TileBaseGeometryWorkerResult
 * - TileFinalGeometryWorkerInput
 * - TileFinalGeometryWorkerResult
 * - TileGeometryWorkerRequest
 * - TileGeometryWorkerResponse
 *
 * Callers:
 * - src/lib/tileGeometry.ts
 * - src/lib/generationPolicy.ts
 * - src/Index.tsx
 * - src/lib/tileGeometry.worker.ts
 * - src/lib/tileGeometryWorkerClient.ts
 */
import type { ColorGrid, Shade } from "@/types/color";
import type { GeneratedShape } from "@/types/shape";
import { BuildMode, FillerRole, SuppressStepDirection, type MixedStepPalette } from "@/types/conversion";
import { FlatModeBehavior, type WaterDrops } from "@/lib/colorGridAnalysis";

// Callers:
// - src/Index.tsx
// - src/lib/tileGeometryWorkerClient.ts
// - src/lib/generationPolicy.ts
export type TileWaterSetting =
  | { kind: "below-platform"; drops: WaterDrops }
  | { kind: "top-aligned" }
  | undefined;

// Callers:
// - src/lib/tileGeometryWorkerClient.ts
// - src/lib/tileGeometry.ts
export type TileBaseGeometryWorkerInput = {
  colorGrid: ColorGrid;
  allSameShade?: Shade;
  hasWater: boolean;
  hasTransparency: boolean;
  includeTransparentBlocks: boolean;
  waterSetting: TileWaterSetting;
  flatModeBehavior: FlatModeBehavior;
  layerGap: number;
  paletteSeed: number;
  enableWaterConvenience: boolean;
};

// Callers:
// - src/lib/tileGeometryWorkerClient.ts
// - src/lib/generationPolicy.ts
// - src/lib/tileGeometry.ts
export type TileBaseGeometryWorkerResult = {
  baseShapeMap: Partial<Record<BuildMode, GeneratedShape>>;
  baseNorthlineShape: GeneratedShape | null;
  isFlatShape: boolean;
};

// Callers:
// - src/lib/tileGeometryWorkerClient.ts
// - src/lib/tileGeometry.ts
export type TileFinalGeometryWorkerInput = {
  colorGrid: ColorGrid;
  allSameShade?: Shade;
  hasWater: boolean;
  hasTransparency: boolean;
  requiresTwoLayerLateShading: boolean;
  includeTransparentBlocks: boolean;
  waterSetting: TileWaterSetting;
  buildAtWorldMinY: boolean;
  buildMode: BuildMode;
  isFlatShape: boolean;
  layerGap: number;
  suppress2LayerLatePairY: number;
  useCrubTech: boolean;
  mixSteps: boolean;
  mixedStepMaxHeight: number;
  mixedStepPalette?: MixedStepPalette;
  paletteSeed: number;
  enableWaterConvenience: boolean;
  skipEmptySuppressSteps: boolean;
  minSuppressStepOffset: number;
  uniformSuppressStepSpacing: boolean;
  keepSuppressExtras: boolean;
  collapseStaircaseModes: boolean;
  includeFlatNorthline: boolean;
  selectedStepDirection: SuppressStepDirection;
  suppressCenterOut: boolean;
};

// Callers:
// - src/lib/tileGeometryWorkerClient.ts
// - src/lib/tileGeometry.ts
export type TileFinalGeometryWorkerResult = {
  shapeMap: Partial<Record<BuildMode, GeneratedShape>>;
  northlineShape: GeneratedShape | null;
  supportShape: GeneratedShape | null;
  fillerNeedStats: { roleCounts: Map<FillerRole, number> } | null;
  northRowSingleLine: boolean;
};

// Callers:
// - src/lib/tileGeometry.worker.ts
// - src/lib/tileGeometryWorkerClient.ts
export type TileGeometryWorkerRequest =
  | { id: number; type: "base"; input: TileBaseGeometryWorkerInput }
  | { id: number; type: "final"; input: TileFinalGeometryWorkerInput };

// Callers:
// - src/lib/tileGeometry.worker.ts
// - src/lib/tileGeometryWorkerClient.ts
export type TileGeometryWorkerResponse =
  | { id: number; type: "base"; result: TileBaseGeometryWorkerResult }
  | { id: number; type: "final"; result: TileFinalGeometryWorkerResult }
  | { id: number; error: string };
