/// <reference lib="WebWorker" />

/**
 * Public API:
 * - none
 *
 * Callers:
 * - src/lib/tileGeometryWorkerClient.ts
 */
import { generateShapeMap } from "@/lib/shapeGeneration";
import {
  analyzeFillerNeeds,
  hasBuildAtWorldMinYOpportunity,
  hasNonWaterColorHeightVariance,
  nooblineIsSingleY,
} from "@/lib/shapeAnalysis";
import { getShapeForBuildMode } from "@/lib/buildModeShapes";
import { FlatModeBehavior } from "@/lib/colorGridAnalysis";
import { BuildMode } from "@/types/conversion";
import { isStaircaseBuildMode } from "@/utils/conversion";
import type {
  TileBaseGeometryWorkerInput,
  TileBaseGeometryWorkerResult,
  TileFinalGeometryWorkerInput,
  TileFinalGeometryWorkerResult,
  TileGeometryWorkerRequest,
  TileGeometryWorkerResponse,
} from "@/lib/tileGeometryWorkerTypes";

function analyzeBaseGeometry(input: TileBaseGeometryWorkerInput): TileBaseGeometryWorkerResult {
  const baseShapeMap = generateShapeMap(
    input.colorGrid,
    input.allSameShade,
    input.hasWater,
    input.hasTransparency,
    input.hasTwoLayerLateVoidNeed,
    {
      layerGap: input.layerGap,
      mixSteps: input.mixSteps,
      includeTransparentBlocks: input.includeTransparentBlocks,
      paletteSeed: input.paletteSeed,
      waterSetting: input.waterSetting,
      enableWaterConvenience: input.enableWaterConvenience,
      buildAtWorldMinY: false,
      skipEmptySuppressSteps: input.skipEmptySuppressSteps,
      collapseStaircaseModes: input.collapseStaircaseModes,
      includeFlatNorthline: input.includeFlatNorthline,
      selectedMode: input.selectedBuildMode,
      selectedStepDirection: input.selectedStepDirection,
    },
  );
  const baseNorthlineShape = baseShapeMap[BuildMode.StaircaseNorthline] ?? null;
  const effectiveFlatModeBehavior = input.includeTransparentBlocks
    ? input.flatModeBehavior
    : FlatModeBehavior.None;
  const isFlatShape = !!baseNorthlineShape &&
    (!hasNonWaterColorHeightVariance(baseNorthlineShape) || effectiveFlatModeBehavior !== FlatModeBehavior.None);
  const currentSelectedShape = input.selectedBuildMode === BuildMode.Flat
    ? baseNorthlineShape
    : getShapeForBuildMode(baseShapeMap, input.selectedBuildMode, isFlatShape);
  const buildAtWorldMinYEligible =
    (
      effectiveFlatModeBehavior === FlatModeBehavior.ToggleableBuildAtWorldMinY &&
      !!baseNorthlineShape &&
      input.supportsWorldMinYGeometry &&
      hasBuildAtWorldMinYOpportunity(input.colorGrid, baseNorthlineShape, input.applySupportFloorYs)
    ) || (
      !!currentSelectedShape &&
      isStaircaseBuildMode(input.selectedBuildMode) &&
      input.supportsWorldMinYGeometry &&
      hasBuildAtWorldMinYOpportunity(input.colorGrid, currentSelectedShape, input.applySupportFloorYs)
    );

  return {
    baseShapeMap,
    baseNorthlineShape,
    isFlatShape,
    buildAtWorldMinYEligible,
  };
}

function analyzeFinalGeometry(input: TileFinalGeometryWorkerInput): TileFinalGeometryWorkerResult {
  const shapeMap = generateShapeMap(
    input.colorGrid,
    input.allSameShade,
    input.hasWater,
    input.hasTransparency,
    input.hasTwoLayerLateVoidNeed,
    {
      layerGap: input.layerGap,
      mixSteps: input.mixSteps,
      includeTransparentBlocks: input.includeTransparentBlocks,
      paletteSeed: input.paletteSeed,
      waterSetting: input.waterSetting,
      enableWaterConvenience: input.enableWaterConvenience,
      buildAtWorldMinY: input.buildAtWorldMinY,
      skipEmptySuppressSteps: input.skipEmptySuppressSteps,
      collapseStaircaseModes: input.collapseStaircaseModes,
      includeFlatNorthline: input.includeFlatNorthline,
      selectedMode: input.selectedBuildMode,
      selectedStepDirection: input.selectedStepDirection,
    },
  );
  const northlineShape = shapeMap[BuildMode.StaircaseNorthline] ?? null;
  const supportShape = input.effectiveBuildMode === BuildMode.Flat
    ? northlineShape
    : getShapeForBuildMode(shapeMap, input.effectiveBuildMode, input.isFlatShape);

  return {
    shapeMap,
    northlineShape,
    supportShape,
    fillerNeedStats: supportShape ? analyzeFillerNeeds(supportShape) : null,
    northRowSingleLine: supportShape ? nooblineIsSingleY(supportShape) : true,
  };
}

self.onmessage = (event: MessageEvent<TileGeometryWorkerRequest>) => {
  const message = event.data;
  try {
    const response: TileGeometryWorkerResponse = message.type === "base"
      ? { id: message.id, type: "base", result: analyzeBaseGeometry(message.input) }
      : { id: message.id, type: "final", result: analyzeFinalGeometry(message.input) };
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : "Tile geometry worker failed",
    } satisfies TileGeometryWorkerResponse);
  }
};

export {};
