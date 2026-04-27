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
  hasNonWaterColorHeightVariance,
  nooblineIsSingleY,
} from "@/lib/shapeAnalysis";
import { getShapeForBuildMode } from "@/lib/buildModeShapes";
import { FlatModeBehavior } from "@/lib/colorGridAnalysis";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
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
    false,
    {
      layerGap: input.layerGap,
      mixSteps: false,
      includeTransparentBlocks: input.includeTransparentBlocks,
      paletteSeed: input.paletteSeed,
      waterSetting: input.waterSetting,
      enableWaterConvenience: input.enableWaterConvenience,
      buildAtWorldMinY: false,
      skipEmptySuppressSteps: true,
      collapseStaircaseModes: true,
      includeFlatNorthline: false,
      selectedMode: null,
      selectedStepDirection: SuppressStepDirection.EastToWest,
    },
  );
  const baseNorthlineShape = baseShapeMap[BuildMode.StaircaseNorthline] ?? null;
  const isFlatShape = !!baseNorthlineShape
    && (!hasNonWaterColorHeightVariance(baseNorthlineShape) || input.flatModeBehavior !== FlatModeBehavior.None);

  return {
    baseShapeMap,
    baseNorthlineShape,
    isFlatShape,
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
      selectedMode: input.buildMode,
      selectedStepDirection: input.selectedStepDirection,
    },
  );
  const northlineShape = shapeMap[BuildMode.StaircaseNorthline] ?? null;
  const supportShape = input.buildMode === BuildMode.Flat
    ? northlineShape
    : getShapeForBuildMode(shapeMap, input.buildMode, input.isFlatShape);

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
