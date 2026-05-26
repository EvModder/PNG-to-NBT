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
 * - src/Index.tsx
 * - src/lib/tileGeometry.worker.ts
 * - src/lib/tileGeometryWorkerClient.ts
 */
import type { ColorGrid, Shade } from "@/types/color";
import type { GeneratedShape } from "@/types/shape";
import { BuildMode, FillerRole, SuppressStepDirection } from "@/types/conversion";
import { FlatModeBehavior, type WaterDrops } from "@/lib/colorGridAnalysis";

// Callers:
// - src/Index.tsx
// - src/lib/tileGeometry.worker.ts
// - src/lib/tileGeometryWorkerClient.ts
export type TileWaterSetting =
  | { kind: "below-platform"; drops: WaterDrops }
  | { kind: "top-aligned" }
  | undefined;

// Callers:
// - src/lib/tileGeometry.worker.ts
// - src/lib/tileGeometryWorkerClient.ts
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
// - src/lib/tileGeometry.worker.ts
// - src/lib/tileGeometryWorkerClient.ts
export type TileBaseGeometryWorkerResult = {
  baseShapeMap: Partial<Record<BuildMode, GeneratedShape>>;
  baseNorthlineShape: GeneratedShape | null;
  isFlatShape: boolean;
};

// Callers:
// - src/lib/tileGeometry.worker.ts
// - src/lib/tileGeometryWorkerClient.ts
export type TileFinalGeometryWorkerInput = {
  colorGrid: ColorGrid;
  allSameShade?: Shade;
  hasWater: boolean;
  hasTransparency: boolean;
  hasTwoLayerLateVoidNeed: boolean;
  includeTransparentBlocks: boolean;
  waterSetting: TileWaterSetting;
  flatModeBehavior: FlatModeBehavior;
  buildAtWorldMinY: boolean;
  buildMode: BuildMode;
  isFlatShape: boolean;
  layerGap: number;
  useCrubTechSlimeBar: boolean;
  mixSteps: boolean;
  paletteSeed: number;
  enableWaterConvenience: boolean;
  skipEmptySuppressSteps: boolean;
  collapseStaircaseModes: boolean;
  includeFlatNorthline: boolean;
  selectedStepDirection: SuppressStepDirection;
};

// Callers:
// - src/lib/tileGeometry.worker.ts
// - src/lib/tileGeometryWorkerClient.ts
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
