#!/usr/bin/env bun
import { gunzipSync } from "node:zlib";

import {
  DEFAULT_LAYER_GAP,
  DEFAULT_SUPPRESS_2LAYER_LATE_PAIRS_GAP,
  DEFAULT_CRUBTECH_LAYER_GAP,
  DEFAULT_CRUBTECH_LATE_PAIRS_GAP,
  DEFAULT_CRUBTECH_LIGHT_WATER_DROP,
  DEFAULT_CRUBTECH_FLAT_WATER_DROP,
  DEFAULT_CRUBTECH_DARK_WATER_DROP,
} from "@/data/defaultSettings";
import { BASE_COLORS, WATER_BASE_INDEX } from "@/data/mapColors";
import { CRUBTECH_PRESET_NAME, getBuiltinPreset } from "@/data/presets";
import { MAP_SIZE, TRANSPARENT_COLOR } from "@/utils/color";
import { BuildMode, FillerRole, SuppressStepDirection, type FillerAssignment } from "@/types/conversion";
import { requiresTwoLayerLateShading, type WaterDrops } from "@/lib/colorGridAnalysis";
import { convertToNbt } from "@/lib/nbtExport";
import { createFillerAssignments, getSupportModeFillerRoles } from "@/lib/fillerRules";
import { buildSuppressLoadSpotMarkers } from "@/lib/suppressLoadMarkers";
import { generateShapeMap } from "@/lib/shapeGeneration";
import { parseShapeCoordKey, toShapeCoordKey } from "@/lib/shapeModel";
import { Shade, type ColorGrid, type ShadedColorRef } from "@/types/color";
import { ShapePartType, type GeneratedShape, type ShapeCell } from "@/types/shape";
import { SupportMode } from "@/types/ui";

const VS_FILLER_LOAD_SPOT_ORTHOGONAL_REACH = 14;
const CRUBTECH_WATER_COLOR_BLOCK = "glass_pane[east=true,north=true,south=true,west=true,waterlogged=true]";
const CRUBTECH_EXPORT_GLASS_PANE = "minecraft:glass_pane[east=true,north=true,south=true,west=true]";
const CRUBTECH_EXPORT_WATERLOGGED_GLASS_PANE = "minecraft:glass_pane[east=true,north=true,south=true,west=true,waterlogged=true]";
const CRUBTECH_EXPORT_CATCHER_CHAIN = "minecraft:chain[axis=z]";
const CRUBTECH_EXPORT_FALLING_WATER = "minecraft:water[level=8]";

function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label}: byte lengths differ (${actual.length} !== ${expected.length})`);
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(`${label}: first byte mismatch at offset ${index}`);
    }
  }
}

function assertBytesDiffer(left: Uint8Array, right: Uint8Array, label: string): void {
  if (left.length !== right.length) return;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return;
  }
  throw new Error(`${label}: expected differing bytes`);
}

function assertBytesContainAscii(bytes: Uint8Array, expected: string, label: string): void {
  const needle = new TextEncoder().encode(expected);
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    if (needle.every((byte, offset) => bytes[index + offset] === byte)) return;
  }
  throw new Error(`${label}: expected bytes to contain ${expected}`);
}

function assertBytesDoNotContainAscii(bytes: Uint8Array, expected: string, label: string): void {
  const needle = new TextEncoder().encode(expected);
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    if (needle.every((byte, offset) => bytes[index + offset] === byte)) {
      throw new Error(`${label}: expected bytes not to contain ${expected}`);
    }
  }
}

type TestExportCell = {
  x: number;
  y: number;
  z: number;
  cell: ShapeCell;
};

type ParsedStructureBlock = { x: number; y: number; z: number; blockName: string };

function parseStructureBlocks(bytes: Uint8Array): ParsedStructureBlock[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const readByte = () => view.getUint8(offset++);
  const readShort = () => {
    const value = view.getUint16(offset, false);
    offset += 2;
    return value;
  };
  const readInt = () => {
    const value = view.getInt32(offset, false);
    offset += 4;
    return value;
  };
  const readString = () => {
    const length = readShort();
    const value = new TextDecoder().decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  };
  const readTag = () => {
    const type = readByte();
    return { type, name: type === 0 ? "" : readString() };
  };
  const expectTag = (expectedName: string, expectedType: number) => {
    const tag = readTag();
    if (tag.type !== expectedType || tag.name !== expectedName) {
      throw new Error(`Expected NBT tag ${expectedName}:${expectedType}, got ${tag.name}:${tag.type}`);
    }
  };
  const readIntList = (): number[] => {
    const elementType = readByte();
    const count = readInt();
    if (elementType !== 3) throw new Error(`Expected int list, got element tag ${elementType}`);
    return Array.from({ length: count }, () => readInt());
  };
  const readPalette = (): string[] => {
    const elementType = readByte();
    const count = readInt();
    if (elementType !== 10) throw new Error(`Expected palette compound list, got element tag ${elementType}`);
    return Array.from({ length: count }, () => {
      let blockName = "";
      const properties: [string, string][] = [];
      while (true) {
        const tagType = readByte();
        if (tagType === 0) {
          if (properties.length === 0) return blockName;
          return `${blockName}[${properties.map(([name, value]) => `${name}=${value}`).join(",")}]`;
        }
        const tagName = readString();
        if (tagName === "Name" && tagType === 8) blockName = readString();
        else if (tagName === "Properties" && tagType === 10) {
          while (true) {
            const propertyType = readByte();
            if (propertyType === 0) break;
            if (propertyType !== 8) throw new Error(`Unexpected palette property tag type ${propertyType}`);
            const propertyName = readString();
            properties.push([propertyName, readString()]);
          }
        } else {
          throw new Error(`Unexpected palette tag ${tagName}:${tagType}`);
        }
      }
    });
  };
  const readBlockStates = (): { x: number; y: number; z: number; state: number }[] => {
    const elementType = readByte();
    const count = readInt();
    if (elementType !== 10) throw new Error(`Expected block compound list, got element tag ${elementType}`);
    return Array.from({ length: count }, () => {
      let pos = [0, 0, 0];
      let state = 0;
      while (true) {
        const tagType = readByte();
        if (tagType === 0) return { x: pos[0], y: pos[1], z: pos[2], state };
        const tagName = readString();
        if (tagName === "pos" && tagType === 9) pos = readIntList();
        else if (tagName === "state" && tagType === 3) state = readInt();
        else throw new Error(`Unexpected block tag ${tagName}:${tagType}`);
      }
    });
  };

  if (readByte() !== 10) throw new Error("Expected root compound NBT tag");
  readString();
  expectTag("DataVersion", 3);
  readInt();
  expectTag("size", 9);
  readIntList();
  let nextTag = readTag();
  if (nextTag.name === "author" && nextTag.type === 8) {
    readString();
    nextTag = readTag();
  }
  if (nextTag.name !== "palette" || nextTag.type !== 9) {
    throw new Error(`Expected palette tag, got ${nextTag.name}:${nextTag.type}`);
  }
  const palette = readPalette();
  expectTag("blocks", 9);
  const blocks = readBlockStates();
  const endTag = readTag();
  if (endTag.name !== "entities" || endTag.type !== 9) {
    throw new Error(`Expected entities tag, got ${endTag.name}:${endTag.type}`);
  }

  return blocks.map(block => ({
    x: block.x,
    y: block.y,
    z: block.z,
    blockName: palette[block.state] ?? "",
  }));
}

function buildTestShape(cells: readonly TestExportCell[]): GeneratedShape {
  const partCells = new Map<number, ShapeCell>();
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const { x, y, z, cell } of cells) {
    partCells.set(toShapeCoordKey(x, y, z), cell);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  return {
    parts: [{
      cells: partCells,
      bounds: { minY, maxY, minZ, maxZ },
      supportFloorYs: new Set<number>(),
    }],
    partType: ShapePartType.SingleColumn,
    splitExportNames: null,
    suppressedTransparentVsCollisionCount: 0,
  };
}

async function exportTestStructureNbt(
  cells: readonly TestExportCell[],
  selectedBlocks: Record<number, string>,
  fillerAssignments: readonly FillerAssignment[],
  collapseDuplicatePaletteStates: boolean,
): Promise<Uint8Array> {
  const shape = buildTestShape(cells);
  const { data, isZip } = await convertToNbt(shape, {
    selectedBlocks,
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [...fillerAssignments],
    applySupportFloorYs: false,
    collapseDuplicatePaletteStates,
    forceXZ128: false,
    forceZ129: false,
    baseName: "test",
    buildMode: BuildMode.StaircaseClassic,
    suppressStepDirection: SuppressStepDirection.EastToWest,
    markSuppressLoadSpotsInSchematic: false,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (isZip) throw new Error("Expected single NBT export in palette-collapse invariant test");
  return new Uint8Array(gunzipSync(data));
}

function assertVsSparseMarkerCoverage(
  z: number,
  role: FillerRole,
  expectedMarkerXs: readonly number[],
): void {
  const cells = new Map<number, FillerRole[]>();
  const targetZ = role === FillerRole.ShadeVoidDominant ? z : z + 1;
  for (let x = 0; x < MAP_SIZE; ++x) {
    if (((x + targetZ) & 1) !== 1) continue;
    cells.set(toShapeCoordKey(x, 64, z), [role]);
  }
  const shape: GeneratedShape = {
    parts: [{
      cells,
      bounds: {
        minY: 64,
        maxY: 64,
        minZ: z,
        maxZ: z,
      },
      supportFloorYs: new Set<number>([63]),
    }],
    partType: ShapePartType.SingleColumn,
    splitExportNames: null,
    suppressedTransparentVsCollisionCount: 0,
  };
  const markers = buildSuppressLoadSpotMarkers(
    shape,
    BuildMode.StaircaseClassic,
    SuppressStepDirection.NorthToSouth,
    {
      markSuppressLoadSpotsInSchematic: true,
      suppressLoadSpotMarkerBlock: "jigsaw",
    },
  );
  const markerXs = markers.map(marker => marker.x).sort((a, b) => a - b);
  const expectedXs = [...expectedMarkerXs];

  if (markerXs.length !== expectedXs.length || markerXs.some((x, index) => x !== expectedXs[index])) {
    throw new Error(`Unexpected VS sparse marker Xs for z=${z}: got [${markerXs.join(", ")}], expected [${expectedXs.join(", ")}]`);
  }

  for (let x = 0; x < MAP_SIZE; ++x) {
    if (((x + targetZ) & 1) !== 1) continue;
    if (!markerXs.some(markerX => Math.abs(markerX - x) <= VS_FILLER_LOAD_SPOT_ORTHOGONAL_REACH)) {
      throw new Error(`VS sparse marker coverage gap for z=${z}, role=${role} at x=${x}`);
    }
  }
}

function assertVsSparseMarkerInvariants(): void {
  assertVsSparseMarkerCoverage(0, FillerRole.ShadeVoidRecessive, [14, 40, 64, 88, 112]);
  assertVsSparseMarkerCoverage(1, FillerRole.ShadeVoidRecessive, [15, 41, 65, 89, 113]);
}

async function assertPaletteCollapseModeInvariants(): Promise<void> {
  const noDuplicateCells: TestExportCell[] = [
    { x: 0, y: 2, z: 0, cell: { id: 1, isCustom: false } },
    { x: 0, y: 1, z: 1, cell: { id: 2, isCustom: false } },
    { x: 1, y: 1, z: 0, cell: [FillerRole.ShadeNorthRow] },
    { x: 1, y: 2, z: 1, cell: [FillerRole.ShadeVoidDominant] },
    { x: 1, y: 0, z: 1, cell: [FillerRole.SupportAll] },
  ];
  const noDuplicateAssignments: FillerAssignment[] = [
    { role: FillerRole.ShadeNorthRow, block: "glass" },
    { role: FillerRole.ShadeVoidDominant, block: "slime_block" },
    { role: FillerRole.SupportAll, block: "bedrock" },
  ];
  const noDuplicateCollapsed = await exportTestStructureNbt(
    noDuplicateCells,
    { 1: "stone", 2: "dirt" },
    noDuplicateAssignments,
    true,
  );
  const noDuplicateExpanded = await exportTestStructureNbt(
    noDuplicateCells,
    { 1: "stone", 2: "dirt" },
    noDuplicateAssignments,
    false,
  );
  assertBytesEqual(
    noDuplicateCollapsed,
    noDuplicateExpanded,
    "collapseDuplicatePaletteStates should not affect no-duplicate exports",
  );

  const duplicateCells: TestExportCell[] = [
    { x: 0, y: 2, z: 0, cell: { id: 1, isCustom: false } },
    { x: 0, y: 1, z: 1, cell: [FillerRole.ShadeNorthRow] },
    { x: 1, y: 0, z: 1, cell: [FillerRole.SupportAll] },
  ];
  const duplicateAssignments: FillerAssignment[] = [
    { role: FillerRole.ShadeNorthRow, block: "stone" },
    { role: FillerRole.SupportAll, block: "stone" },
  ];
  const duplicateCollapsed = await exportTestStructureNbt(duplicateCells, { 1: "stone" }, duplicateAssignments, true);
  const duplicateExpanded = await exportTestStructureNbt(duplicateCells, { 1: "stone" }, duplicateAssignments, false);
  assertBytesDiffer(
    duplicateCollapsed,
    duplicateExpanded,
    "collapseDuplicatePaletteStates should split duplicated support/shading states",
  );

  const convenienceCells: TestExportCell[] = [
    { x: 0, y: 2, z: 0, cell: { id: 1, isCustom: false } },
    { x: 0, y: 1, z: 1, cell: [FillerRole.StairStep] },
  ];
  const convenienceAssignments: FillerAssignment[] = [
    { role: FillerRole.StairStep, block: "stone" },
  ];
  const convenienceCollapsed = await exportTestStructureNbt(
    convenienceCells,
    { 1: "stone" },
    convenienceAssignments,
    true,
  );
  const convenienceExpanded = await exportTestStructureNbt(
    convenienceCells,
    { 1: "stone" },
    convenienceAssignments,
    false,
  );
  assertBytesDiffer(
    convenienceCollapsed,
    convenienceExpanded,
    "collapseDuplicatePaletteStates should split visible/convenience duplicates",
  );

  const vsFillerCells: TestExportCell[] = [
    { x: 0, y: 2, z: 0, cell: { id: 1, isCustom: false } },
    { x: 0, y: 1, z: 1, cell: [FillerRole.ShadeVoidDominant] },
  ];
  const vsFillerAssignments: FillerAssignment[] = [
    { role: FillerRole.ShadeVoidDominant, block: "stone" },
  ];
  const vsFillerCollapsed = await exportTestStructureNbt(
    vsFillerCells,
    { 1: "stone" },
    vsFillerAssignments,
    true,
  );
  const vsFillerExpanded = await exportTestStructureNbt(
    vsFillerCells,
    { 1: "stone" },
    vsFillerAssignments,
    false,
  );
  assertBytesDiffer(
    vsFillerCollapsed,
    vsFillerExpanded,
    "collapseDuplicatePaletteStates should split visible/vs_filler duplicates",
  );
}

async function assertWestEastSlopeExportInvariant(): Promise<void> {
  const slopedShape = buildTestShape([0, 1, 2, 3].map(x => ({
    x,
    y: 0,
    z: 0,
    cell: { id: 1, isCustom: false },
  })));
  const slopedResult = await convertToNbt(slopedShape, {
    selectedBlocks: { 1: "stone" },
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [],
    applySupportFloorYs: false,
    collapseDuplicatePaletteStates: true,
    forceXZ128: false,
    forceZ129: false,
    baseName: "west-east-slope-test",
    buildMode: BuildMode.StaircaseClassic,
    suppressStepDirection: SuppressStepDirection.EastToWest,
    westEastSlope: { run: 2, rise: 3 },
    markSuppressLoadSpotsInSchematic: false,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (slopedResult.isZip) throw new Error("Expected single NBT export in W-E slope invariant test");
  const stoneBlocks = parseStructureBlocks(new Uint8Array(gunzipSync(slopedResult.data)))
    .filter(block => block.blockName === "minecraft:stone");
  const expectedYByX = new Map([[0, 0], [1, 0], [2, 3], [3, 3]]);
  for (const [x, expectedY] of expectedYByX) {
    const actualY = stoneBlocks.find(block => block.x === x)?.y;
    if (actualY !== expectedY) {
      throw new Error(`Expected W-E slope stone at x=${x} to export y=${expectedY}, got ${actualY}`);
    }
  }

  const zeroRunResult = await convertToNbt(slopedShape, {
    selectedBlocks: { 1: "stone" },
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [],
    applySupportFloorYs: false,
    collapseDuplicatePaletteStates: true,
    forceXZ128: false,
    forceZ129: false,
    baseName: "west-east-zero-run-slope-test",
    buildMode: BuildMode.StaircaseClassic,
    suppressStepDirection: SuppressStepDirection.EastToWest,
    westEastSlope: { run: 0, rise: 2 },
    markSuppressLoadSpotsInSchematic: false,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (zeroRunResult.isZip) throw new Error("Expected single NBT export in W-E zero-run slope invariant test");
  const zeroRunStoneBlocks = parseStructureBlocks(new Uint8Array(gunzipSync(zeroRunResult.data)))
    .filter(block => block.blockName === "minecraft:stone");
  for (const x of [0, 1, 2, 3]) {
    const actualY = zeroRunStoneBlocks.find(block => block.x === x)?.y;
    if (actualY !== x * 2) {
      throw new Error(`Expected W-E run=0 slope stone at x=${x} to export y=${x * 2}, got ${actualY}`);
    }
  }

  const negativeRiseResult = await convertToNbt(slopedShape, {
    selectedBlocks: { 1: "stone" },
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [],
    applySupportFloorYs: false,
    collapseDuplicatePaletteStates: true,
    forceXZ128: false,
    forceZ129: false,
    baseName: "west-east-negative-rise-slope-test",
    buildMode: BuildMode.StaircaseClassic,
    suppressStepDirection: SuppressStepDirection.EastToWest,
    westEastSlope: { run: 2, rise: -3 },
    markSuppressLoadSpotsInSchematic: false,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (negativeRiseResult.isZip) throw new Error("Expected single NBT export in W-E negative-rise slope invariant test");
  const negativeRiseStoneBlocks = parseStructureBlocks(new Uint8Array(gunzipSync(negativeRiseResult.data)))
    .filter(block => block.blockName === "minecraft:stone");
  const expectedNegativeRiseYByX = new Map([[0, 3], [1, 3], [2, 0], [3, 0]]);
  for (const [x, expectedY] of expectedNegativeRiseYByX) {
    const actualY = negativeRiseStoneBlocks.find(block => block.x === x)?.y;
    if (actualY !== expectedY) {
      throw new Error(`Expected W-E negative-rise stone at x=${x} to export y=${expectedY}, got ${actualY}`);
    }
  }

  const markerShape: GeneratedShape = {
    parts: [{
      cells: new Map<number, ShapeCell>([
        [toShapeCoordKey(0, 0, 0), { id: 1, isCustom: false }],
        [toShapeCoordKey(5, 1, 0), [FillerRole.ShadeVoidDominant]],
      ]),
      bounds: { minY: 0, maxY: 1, minZ: 0, maxZ: 0 },
      supportFloorYs: new Set<number>([0]),
    }],
    partType: ShapePartType.SingleColumn,
    splitExportNames: null,
    suppressedTransparentVsCollisionCount: 0,
  };
  const markerResult = await convertToNbt(markerShape, {
    selectedBlocks: { 1: "stone" },
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [{ role: FillerRole.ShadeVoidDominant, block: "slime_block" }],
    applySupportFloorYs: false,
    collapseDuplicatePaletteStates: true,
    forceXZ128: false,
    forceZ129: false,
    baseName: "west-east-slope-marker-test",
    buildMode: BuildMode.StaircaseClassic,
    suppressStepDirection: SuppressStepDirection.NorthToSouth,
    westEastSlope: { run: 2, rise: 3 },
    markSuppressLoadSpotsInSchematic: true,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (markerResult.isZip) throw new Error("Expected single NBT export in W-E slope marker invariant test");
  const markerBlocks = parseStructureBlocks(new Uint8Array(gunzipSync(markerResult.data)));
  const markerBlock = markerBlocks.find(block => block.blockName.startsWith("minecraft:jigsaw"));
  if (!markerBlock) throw new Error("Expected W-E slope marker invariant test to export a jigsaw marker");
  if (markerBlock.y !== 1) {
    throw new Error(`Expected W-E slope to leave marker y=1, got ${markerBlock.y}`);
  }
}

function assertCrubTechPresetInvariant(): void {
  const preset = getBuiltinPreset(CRUBTECH_PRESET_NAME);
  if (!preset) throw new Error("Expected built-in CrubTech preset");

  const intentionallyBlankColorIndexes = new Set([0]);
  for (let baseIndex = 0; baseIndex < BASE_COLORS.length; baseIndex += 1) {
    const block = preset.selectedBlocks[baseIndex] ?? "";
    if (intentionallyBlankColorIndexes.has(baseIndex)) {
      if (block !== "") throw new Error(`Expected CrubTech preset color ${baseIndex}:${BASE_COLORS[baseIndex].name} to be blank`);
      continue;
    }
    if (baseIndex === WATER_BASE_INDEX) {
      if (block !== CRUBTECH_WATER_COLOR_BLOCK) throw new Error(`Expected CrubTech preset WATER color to use ${CRUBTECH_WATER_COLOR_BLOCK}`);
      continue;
    }
    if (!BASE_COLORS[baseIndex].blocks.includes(block)) {
      throw new Error(`Invalid CrubTech preset block for ${baseIndex}:${BASE_COLORS[baseIndex].name}: ${block}`);
    }
  }

  if (preset.selectedBlocks[7] !== "bamboo_block[axis=x]") {
    throw new Error("Expected CrubTech preset PLANT color to use bamboo_block[axis=x]");
  }
  if (preset.selectedBlocks[9] !== "clay") throw new Error("Expected CrubTech preset CLAY color to use clay");
  if (preset.selectedBlocks[25] !== "blue_concrete") throw new Error("Expected CrubTech preset COLOR_BLUE color to use blue_concrete");
}

async function assertCrubTechInvariants(): Promise<void> {
  const layerGap = 5;
  const colorGrid: ColorGrid = Array.from(
    { length: MAP_SIZE },
    () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR),
  );
  // Exercise north-row, paired upper-layer, isolated upper-layer, and lower-layer fillers.
  colorGrid[0][0] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[1][0] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[2][2] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[3][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[4][4] = { id: 1, isCustom: false, shade: Shade.Dark };
  colorGrid[6][4] = { id: 1, isCustom: false, shade: Shade.Dark };
  colorGrid[7][3] = { id: 1, isCustom: false, shade: Shade.Light };
  colorGrid[8][3] = { id: 1, isCustom: false, shade: Shade.Dark };

  const withoutCrubTech = generateShapeMap(
    colorGrid,
    undefined,
    false,
    true,
    false,
    {
      layerGap,
      mixSteps: false,
      paletteSeed: 0,
      buildAtWorldMinY: false,
      skipEmptySuppressSteps: true,
      useCrubTech: false,
      includeTransparentBlocks: false,
      collapseStaircaseModes: true,
      includeFlatNorthline: false,
      selectedMode: BuildMode.Suppress2Layer,
      selectedStepDirection: SuppressStepDirection.EastToWest,
    },
  )[BuildMode.Suppress2Layer];

  const withCrubTech = generateShapeMap(
    colorGrid,
    undefined,
    false,
    true,
    false,
    {
      layerGap,
      mixSteps: false,
      paletteSeed: 0,
      buildAtWorldMinY: false,
      skipEmptySuppressSteps: true,
      useCrubTech: true,
      includeTransparentBlocks: false,
      collapseStaircaseModes: true,
      includeFlatNorthline: false,
      selectedMode: BuildMode.Suppress2Layer,
      selectedStepDirection: SuppressStepDirection.EastToWest,
    },
  )[BuildMode.Suppress2Layer];

  if (!withoutCrubTech || !withCrubTech) throw new Error("Expected suppress 2-layer shape in CrubTech invariant test");

  let legacyNorthRowCount = 0;
  let legacySuppressCount = 0;
  for (const part of withoutCrubTech.parts) {
    for (const [, cell] of part.cells) {
      if (!Array.isArray(cell)) continue;
      if (cell.includes(FillerRole.ShadeNorthRow)) legacyNorthRowCount += 1;
      if (cell.includes(FillerRole.ShadeSuppress)) legacySuppressCount += 1;
    }
  }
  if (legacyNorthRowCount === 0 || legacySuppressCount === 0) {
    throw new Error(
      `Expected legacy north-row and suppress shade fillers without CrubTech, got north_row=${legacyNorthRowCount}, suppress=${legacySuppressCount}`,
    );
  }

  let northRowBreakableCount = 0;
  let northRowPushableCount = 0;
  let breakableCount = 0;
  let pushableCount = 0;
  let supportBreakableBottomCount = 0;
  let supportPushableBottomCount = 0;
  let supportBreakableTopCount = 0;
  let supportPushableTopCount = 0;
  let legacyNorthRowWithCrubTechCount = 0;
  let legacyWithCrubTechCount = 0;
  for (const part of withCrubTech.parts) {
    for (const [coord, cell] of part.cells) {
      if (!Array.isArray(cell)) continue;
      if (cell.includes(FillerRole.ShadeNorthRowBreakable)) northRowBreakableCount += 1;
      if (cell.includes(FillerRole.ShadeNorthRowPushable)) northRowPushableCount += 1;
      if (cell.includes(FillerRole.ShadeSuppressBreakable)) breakableCount += 1;
      if (cell.includes(FillerRole.ShadeSuppressPushable)) pushableCount += 1;
      if (cell.includes(FillerRole.ShadeNorthRow)) legacyNorthRowWithCrubTechCount += 1;
      if (cell.includes(FillerRole.ShadeSuppress)) legacyWithCrubTechCount += 1;
      if (cell.includes(FillerRole.SupportBreakable)) {
        if (parseShapeCoordKey(coord)[1] < layerGap - 1) supportBreakableBottomCount += 1;
        else supportBreakableTopCount += 1;
      }
      if (cell.includes(FillerRole.SupportPushable)) {
        if (parseShapeCoordKey(coord)[1] < layerGap - 1) supportPushableBottomCount += 1;
        else supportPushableTopCount += 1;
      }
      const hasSuppressBreakable = cell.includes(FillerRole.ShadeSuppressBreakable);
      const hasSuppressPushable = cell.includes(FillerRole.ShadeSuppressPushable);
      if (!hasSuppressBreakable && !hasSuppressPushable) continue;
      const [x, y, z] = parseShapeCoordKey(coord);
      if (y < layerGap) {
        if (!hasSuppressPushable || hasSuppressBreakable) {
          throw new Error(`Expected CrubTech bottom-layer suppress filler at (${x}, ${y}, ${z}) to use pushable/resin role`);
        }
        continue;
      }
      if (y === layerGap + 1) {
        if (!hasSuppressBreakable || hasSuppressPushable) {
          throw new Error(`Expected raised CrubTech upper-layer suppress filler at (${x}, ${y}, ${z}) to use breakable/moss role`);
        }
        continue;
      }
      const pairX = (x & 1) === 0 ? x + 1 : x - 1;
      const pairCoord = toShapeCoordKey(pairX, y, z);
      const shouldBePushable = !part.cells.has(pairCoord);
      if (shouldBePushable !== hasSuppressPushable || hasSuppressBreakable === hasSuppressPushable) {
        throw new Error(
          `Expected CrubTech suppress filler at (${x}, ${y}, ${z}) to match gmask-like paired occupancy; pair=${part.cells.has(pairCoord)}, breakable=${hasSuppressBreakable}, pushable=${hasSuppressPushable}`,
        );
      }
    }
  }
  if (
    northRowBreakableCount === 0 ||
    breakableCount === 0 ||
    pushableCount === 0
  ) {
    throw new Error(
      `Expected CrubTech shade roles, got north_row_breakable=${northRowBreakableCount}, breakable=${breakableCount}, pushable=${pushableCount}`,
    );
  }
  if (northRowPushableCount !== 0) {
    throw new Error(`Expected CrubTech noobline fillers to avoid pushable roles, got ${northRowPushableCount}`);
  }
  if (legacyNorthRowWithCrubTechCount !== 0 || legacyWithCrubTechCount !== 0) {
    throw new Error(
      `Expected no legacy shade fillers with CrubTech, got north_row=${legacyNorthRowWithCrubTechCount}, suppress=${legacyWithCrubTechCount}`,
    );
  }
  if (supportBreakableBottomCount === 0 || supportPushableBottomCount !== 0) {
    throw new Error(
      `Expected CrubTech bottom support to be breakable-only, got breakable=${supportBreakableBottomCount}, pushable=${supportPushableBottomCount}`,
    );
  }
  if (supportBreakableTopCount === 0 || supportPushableTopCount === 0) {
    throw new Error(
      `Expected CrubTech upper support to split by paired occupancy, got breakable=${supportBreakableTopCount}, pushable=${supportPushableTopCount}`,
    );
  }
  const supportRoleCases = [
    [4, layerGap, 3, FillerRole.SupportPushable],
    [6, layerGap, 3, FillerRole.SupportBreakable],
    [8, 0, 2, FillerRole.SupportBreakable],
  ] as const;
  for (const [x, y, z, role] of supportRoleCases) {
    const cell = withCrubTech.parts[0].cells.get(toShapeCoordKey(x, y, z));
    if (!Array.isArray(cell) || !cell.includes(role)) {
      throw new Error(`Expected CrubTech support at (${x}, ${y}, ${z}) to use ${role}`);
    }
  }
  const plainSignals = buildSuppressLoadSpotMarkers(
    withCrubTech,
    BuildMode.Suppress2Layer,
    SuppressStepDirection.EastToWest,
    {
      crubTech: true,
      suppressLoadSpotMarkerBlock: "jigsaw",
    },
  ).filter(marker => marker.blockName.startsWith("minecraft:redstone_lamp"));
  if (plainSignals.length !== 0) {
    throw new Error(`Expected no plain CrubTech signal lamps, got ${plainSignals.length}`);
  }

  const bottomLayerGrid: ColorGrid = Array.from(
    { length: MAP_SIZE },
    () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR),
  );
  bottomLayerGrid[0][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  bottomLayerGrid[1][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  bottomLayerGrid[1][2] = { id: 1, isCustom: false, shade: Shade.Flat };
  const bottomLayerCrubTech = generateShapeMap(
    bottomLayerGrid,
    undefined,
    false,
    true,
    false,
    {
      layerGap,
      mixSteps: false,
      paletteSeed: 0,
      buildAtWorldMinY: false,
      skipEmptySuppressSteps: true,
      useCrubTech: true,
      includeTransparentBlocks: false,
      collapseStaircaseModes: true,
      includeFlatNorthline: false,
      selectedMode: BuildMode.Suppress2Layer,
      selectedStepDirection: SuppressStepDirection.EastToWest,
    },
  )[BuildMode.Suppress2Layer];
  if (!bottomLayerCrubTech) throw new Error("Expected suppress 2-layer shape in CrubTech bottom-layer invariant test");

  let bottomLayerPushableCount = 0;
  let bottomLayerBreakableCount = 0;
  for (const part of bottomLayerCrubTech.parts) {
    for (const [coord, cell] of part.cells) {
      if (!Array.isArray(cell)) continue;
      const [, y] = parseShapeCoordKey(coord);
      if (y >= layerGap) continue;
      if (cell.includes(FillerRole.ShadeSuppressPushable)) bottomLayerPushableCount += 1;
      if (cell.includes(FillerRole.ShadeSuppressBreakable)) bottomLayerBreakableCount += 1;
    }
  }
  if (bottomLayerPushableCount === 0 || bottomLayerBreakableCount !== 0) {
    throw new Error(
      `Expected CrubTech bottom-layer suppress fillers to be pushable-only, got pushable=${bottomLayerPushableCount}, breakable=${bottomLayerBreakableCount}`,
    );
  }

  const exportResult = await convertToNbt(withCrubTech, {
    selectedBlocks: { 1: "stone" },
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [
      { role: FillerRole.ShadeNorthRowBreakable, block: "diamond_block" },
      { role: FillerRole.ShadeNorthRowPushable, block: "diamond_block" },
      { role: FillerRole.ShadeSuppressBreakable, block: "gold_block" },
      { role: FillerRole.ShadeSuppressPushable, block: "emerald_block" },
    ],
    applySupportFloorYs: false,
    collapseDuplicatePaletteStates: true,
    forceXZ128: true,
    forceZ129: false,
    baseName: "crubtech-noobline-test",
    buildMode: BuildMode.Suppress2Layer,
    suppressStepDirection: SuppressStepDirection.EastToWest,
    crubTech: true,
    markSuppressLoadSpotsInSchematic: false,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (exportResult.isZip) throw new Error("Expected single NBT export in CrubTech noobline invariant test");
  const bytes = new Uint8Array(gunzipSync(exportResult.data));
  assertBytesContainAscii(bytes, "minecraft:moss_block", "CrubTech noobline export should force moss");
  assertBytesDoNotContainAscii(bytes, "minecraft:diamond_block", "CrubTech noobline export should ignore caller-provided north-row blocks");
  assertBytesContainAscii(bytes, "minecraft:glass", "Plain CrubTech export should include prebuilt platform glass");
  assertBytesDoNotContainAscii(bytes, "minecraft:redstone_lamp", "Plain CrubTech export should omit signal lamps");
  assertBytesDoNotContainAscii(bytes, "minecraft:glass_pane", "No-water CrubTech export should omit water platform panes");
  assertBytesDoNotContainAscii(bytes, "minecraft:chain", "No-water CrubTech export should omit water catcher chains");
  assertBytesDoNotContainAscii(bytes, "minecraft:water", "No-water CrubTech export should omit falling water columns");
  const exportedBlocks = parseStructureBlocks(bytes);
  const glassCountsByY = new Map<number, number>();
  for (const block of exportedBlocks) {
    if (block.blockName !== "minecraft:glass") continue;
    glassCountsByY.set(block.y, (glassCountsByY.get(block.y) ?? 0) + 1);
  }
  const omittedBottomPlatformCount = glassCountsByY.get(0) ?? 0;
  if (omittedBottomPlatformCount !== 0) {
    throw new Error(`Expected no CrubTech bottom glass platform without water colors, got ${omittedBottomPlatformCount} blocks`);
  }
  const expectedPlatformYs = [layerGap - 1];
  for (const y of expectedPlatformYs) {
    const count = glassCountsByY.get(y) ?? 0;
    if (count !== MAP_SIZE * MAP_SIZE) {
      throw new Error(`Expected full CrubTech glass platform at exported y=${y}, got ${count} blocks`);
    }
  }
  const omittedLatePlatformCount = glassCountsByY.get(layerGap - 1 + DEFAULT_CRUBTECH_LATE_PAIRS_GAP) ?? 0;
  if (omittedLatePlatformCount !== 0) {
    throw new Error(`Expected no plain CrubTech late-pair glass platform, got ${omittedLatePlatformCount} blocks`);
  }

  const crubTechSupportAssignments = createFillerAssignments(
    "diamond_block",
    "stone",
    "azalea",
    "resin_block",
    "stone",
    "stone",
    "stone",
    SupportMode.Steps,
    true,
    false,
    false,
  );
  const standardAllSupportRoles = getSupportModeFillerRoles(SupportMode.All, false, false, false);
  const crubTechAllSupportRoles = getSupportModeFillerRoles(SupportMode.All, false, false, true);
  if (
    !standardAllSupportRoles.includes(FillerRole.SupportAll) ||
    standardAllSupportRoles.includes(FillerRole.SupportBreakable) ||
    standardAllSupportRoles.includes(FillerRole.SupportPushable)
  ) {
    throw new Error("Expected Support=All to retain standard support assignments outside CrubTech");
  }
  if (crubTechAllSupportRoles.length !== 0) {
    throw new Error("Expected CrubTech to disable Support=All in favor of Support=Steps");
  }
  const crubTechSupportAssignmentsByRole = new Map(
    crubTechSupportAssignments.map(assignment => [assignment.role, assignment.block]),
  );
  if (
    crubTechSupportAssignmentsByRole.has(FillerRole.SupportAll) ||
    crubTechSupportAssignmentsByRole.get(FillerRole.SupportBreakable) !== "azalea" ||
    crubTechSupportAssignmentsByRole.get(FillerRole.SupportPushable) !== "resin_block"
  ) {
    throw new Error("Expected CrubTech Support=Steps to resolve to split support assignments");
  }

  const supportExportResult = await convertToNbt(withCrubTech, {
    selectedBlocks: { 1: "stone" },
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: crubTechSupportAssignments,
    applySupportFloorYs: true,
    collapseDuplicatePaletteStates: true,
    forceXZ128: true,
    forceZ129: false,
    baseName: "crubtech-support-test",
    buildMode: BuildMode.Suppress2Layer,
    suppressStepDirection: SuppressStepDirection.EastToWest,
    crubTech: true,
    markSuppressLoadSpotsInSchematic: false,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (supportExportResult.isZip) throw new Error("Expected single NBT export in CrubTech support invariant test");
  const supportBytes = new Uint8Array(gunzipSync(supportExportResult.data));
  assertBytesContainAscii(supportBytes, "minecraft:azalea", "CrubTech support export should include breakable support");
  assertBytesContainAscii(supportBytes, "minecraft:resin_block", "CrubTech support export should include pushable support");
  assertBytesDoNotContainAscii(supportBytes, "minecraft:diamond_block", "CrubTech Support=Steps should ignore the normal support block");
  const supportBlocks = parseStructureBlocks(supportBytes);
  for (const y of expectedPlatformYs) {
    const glassCount = supportBlocks.filter(block => block.y === y && block.blockName === "minecraft:glass").length;
    if (glassCount !== MAP_SIZE * MAP_SIZE) {
      throw new Error(`Expected Support=Steps to preserve the full CrubTech glass platform at y=${y}, got ${glassCount} blocks`);
    }
  }
}

async function assertCrubTechWaterPlatformInvariant(): Promise<void> {
  const colorGrid: ColorGrid = Array.from(
    { length: MAP_SIZE },
    () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR),
  );
  colorGrid[0][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[10][10] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Light };
  colorGrid[11][10] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Flat };
  colorGrid[12][10] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Dark };

  const shape = generateShapeMap(
    colorGrid,
    undefined,
    true,
    true,
    false,
    {
      layerGap: DEFAULT_CRUBTECH_LAYER_GAP,
      waterSetting: {
        kind: "below-platform",
        drops: [
          DEFAULT_CRUBTECH_DARK_WATER_DROP + 1,
          DEFAULT_CRUBTECH_FLAT_WATER_DROP + 1,
          DEFAULT_CRUBTECH_LIGHT_WATER_DROP + 1,
        ],
      },
      mixSteps: false,
      paletteSeed: 0,
      buildAtWorldMinY: false,
      skipEmptySuppressSteps: true,
      useCrubTech: true,
      includeTransparentBlocks: false,
      collapseStaircaseModes: true,
      includeFlatNorthline: false,
      selectedMode: BuildMode.Suppress2Layer,
      selectedStepDirection: SuppressStepDirection.EastToWest,
    },
  )[BuildMode.Suppress2Layer];
  if (!shape) throw new Error("Expected suppress 2-layer shape in CrubTech water platform invariant test");

  const exportResult = await convertToNbt(shape, {
    selectedBlocks: {
      1: "stone",
      [WATER_BASE_INDEX]: CRUBTECH_WATER_COLOR_BLOCK,
    },
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [],
    applySupportFloorYs: false,
    collapseDuplicatePaletteStates: true,
    forceXZ128: true,
    forceZ129: true,
    baseName: "crubtech-water-platform-test",
    buildMode: BuildMode.Suppress2Layer,
    suppressStepDirection: SuppressStepDirection.EastToWest,
    crubTech: true,
    markSuppressLoadSpotsInSchematic: false,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (exportResult.isZip) throw new Error("Expected single NBT export in CrubTech water platform invariant test");

  const countsByBlockAndY = new Map<string, number>();
  for (const block of parseStructureBlocks(new Uint8Array(gunzipSync(exportResult.data)))) {
    const key = `${block.blockName}|${block.y}`;
    countsByBlockAndY.set(key, (countsByBlockAndY.get(key) ?? 0) + 1);
  }
  const countBlocks = (blockName: string, y: number) => countsByBlockAndY.get(`${blockName}|${y}`) ?? 0;
  const minOriginalY = -1 - DEFAULT_CRUBTECH_DARK_WATER_DROP;
  const normalizeY = (originalY: number) => originalY - minOriginalY;
  const lightWaterY = -1 - DEFAULT_CRUBTECH_LIGHT_WATER_DROP;
  const flatWaterY = -1 - DEFAULT_CRUBTECH_FLAT_WATER_DROP;
  const darkWaterY = -1 - DEFAULT_CRUBTECH_DARK_WATER_DROP;
  const fullLayerCount = MAP_SIZE * MAP_SIZE;

  for (const y of [lightWaterY, flatWaterY, darkWaterY]) {
    const regularCount = countBlocks(CRUBTECH_EXPORT_GLASS_PANE, normalizeY(y));
    const waterloggedCount = countBlocks(CRUBTECH_EXPORT_WATERLOGGED_GLASS_PANE, normalizeY(y));
    if (regularCount !== fullLayerCount - 1 || waterloggedCount !== 1) {
      throw new Error(
        `Expected CrubTech water shade layer at y=${normalizeY(y)} to have 1 waterlogged pane and ${fullLayerCount - 1} regular panes, got ${waterloggedCount}/${regularCount}`,
      );
    }
  }

  const lightCatcherPaneY = lightWaterY - 2;
  const flatCatcherPaneY = flatWaterY - 5;
  for (const y of [lightCatcherPaneY, flatCatcherPaneY]) {
    const waterloggedCount = countBlocks(CRUBTECH_EXPORT_WATERLOGGED_GLASS_PANE, normalizeY(y));
    const chainCount = countBlocks(CRUBTECH_EXPORT_CATCHER_CHAIN, normalizeY(y - 1));
    if (waterloggedCount !== fullLayerCount || chainCount !== fullLayerCount) {
      throw new Error(
        `Expected full CrubTech catcher pane/chain layers near y=${normalizeY(y)}, got waterlogged=${waterloggedCount}, chain=${chainCount}`,
      );
    }
  }

  const fallingWaterYs = [
    lightWaterY - 1,
    flatWaterY - 1,
    flatWaterY - 2,
    flatWaterY - 3,
    flatWaterY - 4,
  ].map(normalizeY);
  for (const y of fallingWaterYs) {
    const count = countBlocks(CRUBTECH_EXPORT_FALLING_WATER, y);
    if (count !== 1) throw new Error(`Expected one CrubTech falling water column block at y=${y}, got ${count}`);
  }
}

function assertTwoLayerLatePairEligibilityInvariants(): void {
  const transparent = TRANSPARENT_COLOR;
  const solid = { id: 1, isCustom: false, shade: Shade.Flat } satisfies ShadedColorRef;
  const water = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Flat } satisfies ShadedColorRef;
  const flat = { id: 2, isCustom: false, shade: Shade.Flat } satisfies ShadedColorRef;
  const dark = { ...flat, shade: Shade.Dark } satisfies ShadedColorRef;
  const light = { ...flat, shade: Shade.Light } satisfies ShadedColorRef;
  const droppedWater = [8, 4, 2] as const;
  const levelWater = [0, 0, 0] as const;
  const cases: readonly [string, number, ShadedColorRef, ShadedColorRef, WaterDrops | undefined, boolean][] = [
    ["dominant flat south of transparency", 0, transparent, flat, undefined, true],
    ["dominant dark south of transparency", 0, transparent, dark, undefined, true],
    ["dominant light south of transparency", 0, transparent, light, undefined, false],
    ["recessive flat south of transparency", 1, transparent, flat, undefined, false],
    ["dominant flat south of solid", 0, solid, flat, droppedWater, false],
    ["dominant dark south of solid", 0, solid, dark, droppedWater, false],
    ["dominant flat south of dropped water", 0, water, flat, droppedWater, true],
    ["dominant dark south of dropped water", 0, water, dark, droppedWater, true],
    ["dominant light south of dropped water", 0, water, light, droppedWater, false],
    ["recessive flat south of dropped water", 1, water, flat, droppedWater, false],
    ["dominant flat south of level water", 0, water, flat, levelWater, false],
    ["dominant dark south of level water", 0, water, dark, levelWater, true],
    ["dark water south of transparency", 0, transparent, { ...water, shade: Shade.Dark }, droppedWater, false],
    ["flat water south of water", 0, water, water, droppedWater, false],
  ];

  for (const [label, x, north, color, waterDrops, expected] of cases) {
    const colorGrid: ColorGrid = Array.from(
      { length: MAP_SIZE },
      () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR),
    );
    colorGrid[x][0] = north;
    colorGrid[x][1] = color;
    const actual = requiresTwoLayerLateShading(colorGrid, waterDrops);
    if (actual !== expected) throw new Error(`Unexpected late-pair eligibility for ${label}: ${actual}`);
  }
}

async function assertCrubTechLatePairPauseMarkerInvariants(): Promise<void> {
  const colorGrid: ColorGrid = Array.from(
    { length: MAP_SIZE },
    () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR),
  );
  const waterDrops = [
    DEFAULT_CRUBTECH_DARK_WATER_DROP + 1,
    DEFAULT_CRUBTECH_FLAT_WATER_DROP + 1,
    DEFAULT_CRUBTECH_LIGHT_WATER_DROP + 1,
  ] as const;
  colorGrid[4][0] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Flat };
  colorGrid[4][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[6][0] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Flat };
  colorGrid[6][1] = { id: 1, isCustom: false, shade: Shade.Dark };
  colorGrid[9][0] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Flat };
  colorGrid[9][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[12][0] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Flat };
  colorGrid[12][1] = { id: 1, isCustom: false, shade: Shade.Light };
  colorGrid[14][1] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Flat };
  if (requiresTwoLayerLateShading(colorGrid)) {
    throw new Error("Expected top-aligned water not to require 2-layer late pairs");
  }
  if (!requiresTwoLayerLateShading(colorGrid, waterDrops)) {
    throw new Error("Expected dropped water south-neighbor shading to require 2-layer late pairs");
  }
  colorGrid[0][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[1][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[3][2] = { id: 1, isCustom: false, shade: Shade.Flat };

  const layerGap = DEFAULT_CRUBTECH_LAYER_GAP;
  const latePairY = layerGap + DEFAULT_CRUBTECH_LATE_PAIRS_GAP;
  const shape = generateShapeMap(
    colorGrid,
    undefined,
    true,
    true,
    true,
    {
      layerGap,
      suppress2LayerLatePairY: latePairY,
      waterSetting: { kind: "below-platform", drops: waterDrops },
      mixSteps: false,
      paletteSeed: 0,
      buildAtWorldMinY: false,
      skipEmptySuppressSteps: true,
      useCrubTech: true,
      includeTransparentBlocks: false,
      collapseStaircaseModes: true,
      includeFlatNorthline: false,
      selectedMode: BuildMode.Suppress2LayerLatePairs,
      selectedStepDirection: SuppressStepDirection.EastToWest,
    },
  )[BuildMode.Suppress2LayerLatePairs];
  if (!shape) throw new Error("Expected suppress 2-layer late-pairs shape in CrubTech pause-marker invariant test");
  const cells = shape.parts[0]?.cells;
  if (!cells || shape.parts.length !== 1) throw new Error("Expected one CrubTech late-pairs shape part");
  const flatColor = cells.get(toShapeCoordKey(4, latePairY, 1));
  const flatFiller = cells.get(toShapeCoordKey(4, latePairY, 0));
  if (
    !flatColor ||
    Array.isArray(flatColor) ||
    flatColor.id !== 1 ||
    !Array.isArray(flatFiller) ||
    !flatFiller.includes(FillerRole.ShadeSuppressPushable)
  ) {
    throw new Error("Expected dropped-water flat color and filler together on the late-pairs layer");
  }
  const darkColor = cells.get(toShapeCoordKey(6, 0, 1));
  const darkFiller = cells.get(toShapeCoordKey(6, latePairY, 0));
  if (
    !darkColor ||
    Array.isArray(darkColor) ||
    darkColor.id !== 1 ||
    !Array.isArray(darkFiller) ||
    !darkFiller.includes(FillerRole.ShadeSuppressPushable)
  ) {
    throw new Error("Expected dropped-water dark color prebuilt below and only its filler on the late-pairs layer");
  }
  if (
    cells.has(toShapeCoordKey(4, 0, 1)) ||
    cells.has(toShapeCoordKey(4, 0, 0)) ||
    cells.has(toShapeCoordKey(6, 1, 0)) ||
    cells.has(toShapeCoordKey(9, latePairY, 0)) ||
    cells.has(toShapeCoordKey(9, latePairY, 1))
  ) {
    throw new Error("Expected no lower misplaced or recessive dropped-water late-pair cells");
  }
  for (const x of [12, 14]) {
    if (cells.has(toShapeCoordKey(x, latePairY, 0)) || cells.has(toShapeCoordKey(x, latePairY, 1))) {
      throw new Error(`Expected no late-pair cells for light/water target at x=${x}`);
    }
  }

  const expectedStepStartXs = new Set<number>();
  let lateLayerPushableCount = 0;
  let lateLayerBreakableCount = 0;
  for (const part of shape.parts) {
    for (const [coord, cell] of part.cells) {
      const [x, y, z] = parseShapeCoordKey(coord);
      if (y !== latePairY || x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) continue;
      expectedStepStartXs.add(Math.min(MAP_SIZE - 1, x | 1));
      if (!Array.isArray(cell)) continue;
      if (cell.includes(FillerRole.ShadeSuppressPushable)) lateLayerPushableCount += 1;
      if (cell.includes(FillerRole.ShadeSuppressBreakable)) lateLayerBreakableCount += 1;
    }
  }
  if (expectedStepStartXs.size === 0) throw new Error("Expected late-pair cells for CrubTech pause-marker invariant test");
  if (lateLayerPushableCount === 0 || lateLayerBreakableCount !== 0) {
    throw new Error(
      `Expected CrubTech late-layer suppress fillers to be pushable-only, got pushable=${lateLayerPushableCount}, breakable=${lateLayerBreakableCount}`,
    );
  }
  const maxSupportFloorY = Math.max(...shape.parts.flatMap(part => [...part.supportFloorYs]));
  const expectedLampY = maxSupportFloorY + 4;

  const markers = buildSuppressLoadSpotMarkers(
    shape,
    BuildMode.Suppress2LayerLatePairs,
    SuppressStepDirection.WestToEast,
    {
      crubTech: true,
      suppress2LayerLatePairY: latePairY,
      suppressLoadSpotMarkerBlock: "jigsaw",
    },
  );
  const markerStepStartXs = new Set(
    markers
      .filter(marker => marker.z === MAP_SIZE && marker.blockName === "minecraft:redstone_lamp[lit=true]")
      .map(marker => marker.x),
  );
  if ([9, 13, 15].some(x => markerStepStartXs.has(x))) {
    throw new Error("Expected recessive, light, and water-target CrubTech lamps to remain off");
  }
  const expectedXs = [...expectedStepStartXs].sort((a, b) => a - b);
  const actualXs = [...markerStepStartXs].sort((a, b) => a - b);
  if (actualXs.length !== expectedXs.length || actualXs.some((x, index) => x !== expectedXs[index])) {
    throw new Error(`Unexpected CrubTech pause marker x positions: got [${actualXs.join(", ")}], expected [${expectedXs.join(", ")}]`);
  }
  const signalLamps = markers.filter(marker => marker.z === MAP_SIZE && marker.blockName.startsWith("minecraft:redstone_lamp"));
  if (signalLamps.length !== MAP_SIZE / 2) {
    throw new Error(`Expected ${MAP_SIZE / 2} CrubTech signal lamps, got ${signalLamps.length}`);
  }
  const plainModeMarkers = buildSuppressLoadSpotMarkers(
    shape,
    BuildMode.Suppress2Layer,
    SuppressStepDirection.WestToEast,
    {
      crubTech: true,
      suppress2LayerLatePairY: latePairY,
      suppressLoadSpotMarkerBlock: "jigsaw",
    },
  );
  const plainModeSignalLamps = plainModeMarkers.filter(marker => marker.blockName.startsWith("minecraft:redstone_lamp"));
  if (plainModeSignalLamps.length !== 0) {
    throw new Error(`Expected no plain-mode CrubTech signal lamps, got ${plainModeSignalLamps.length}`);
  }
  const misplacedLamp = signalLamps.find(marker => marker.y !== expectedLampY);
  if (misplacedLamp) {
    throw new Error(`Expected CrubTech signal lamps at y=${expectedLampY}, got y=${misplacedLamp.y}`);
  }
  const expectedSignalXs = Array.from({ length: MAP_SIZE / 2 }, (_, index) => index * 2 + 1);
  const actualSignalXs = signalLamps.map(marker => marker.x).sort((a, b) => a - b);
  if (actualSignalXs.some((x, index) => x !== expectedSignalXs[index])) {
    throw new Error(`Unexpected CrubTech signal lamp Xs: got [${actualSignalXs.join(", ")}]`);
  }
  for (const marker of signalLamps) {
    const expectedBlock = expectedStepStartXs.has(marker.x)
      ? "minecraft:redstone_lamp[lit=true]"
      : "minecraft:redstone_lamp[lit=false]";
    if (marker.blockName !== expectedBlock) {
      throw new Error(`Unexpected CrubTech signal lamp at x=${marker.x}: got ${marker.blockName}, expected ${expectedBlock}`);
    }
  }

  const exportResult = await convertToNbt(shape, {
    selectedBlocks: { 1: "stone" },
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [
      { role: FillerRole.ShadeSuppressBreakable, block: "moss_block" },
      { role: FillerRole.ShadeSuppressPushable, block: "resin_block" },
    ],
    applySupportFloorYs: false,
    collapseDuplicatePaletteStates: true,
    forceXZ128: true,
    forceZ129: false,
    baseName: "crubtech-pause-marker-test",
    buildMode: BuildMode.Suppress2LayerLatePairs,
    suppressStepDirection: SuppressStepDirection.WestToEast,
    suppress2LayerLatePairY: latePairY,
    crubTech: true,
    markSuppressLoadSpotsInSchematic: false,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (exportResult.isZip) throw new Error("Expected single NBT export in CrubTech pause-marker invariant test");
  assertBytesContainAscii(
    new Uint8Array(gunzipSync(exportResult.data)),
    "minecraft:glass",
    "CrubTech export should include prebuilt platform glass",
  );
  assertBytesContainAscii(
    new Uint8Array(gunzipSync(exportResult.data)),
    "minecraft:redstone_lamp",
    "CrubTech export should include pause/continue signal lamps",
  );
}

function assertDefaultLatePairYInvariant(): void {
  const layerGap = DEFAULT_LAYER_GAP;
  const expectedLatePairY = layerGap + DEFAULT_SUPPRESS_2LAYER_LATE_PAIRS_GAP;
  const colorGrid: ColorGrid = Array.from(
    { length: MAP_SIZE },
    () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR),
  );
  colorGrid[0][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[1][1] = { id: 1, isCustom: false, shade: Shade.Flat };

  const shape = generateShapeMap(
    colorGrid,
    undefined,
    false,
    true,
    true,
    {
      layerGap,
      mixSteps: false,
      paletteSeed: 0,
      buildAtWorldMinY: false,
      skipEmptySuppressSteps: true,
      useCrubTech: false,
      includeTransparentBlocks: false,
      collapseStaircaseModes: true,
      includeFlatNorthline: false,
      selectedMode: BuildMode.Suppress2LayerLatePairs,
      selectedStepDirection: SuppressStepDirection.EastToWest,
    },
  )[BuildMode.Suppress2LayerLatePairs];
  if (!shape) throw new Error("Expected suppress 2-layer late-pairs shape in default late-pair invariant test");

  let expectedYCount = 0;
  let tooHighCount = 0;
  for (const part of shape.parts) {
    for (const [coord] of part.cells) {
      const [x, y, z] = parseShapeCoordKey(coord);
      if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) continue;
      if (y === expectedLatePairY) expectedYCount++;
      if (y > expectedLatePairY) tooHighCount++;
    }
  }
  if (expectedYCount === 0) throw new Error("Expected default late-pair cells at layer gap + 1");
  if (tooHighCount > 0) throw new Error("Default late-pair cells were placed above layer gap + 1");
}

async function main(): Promise<number> {
  assertVsSparseMarkerInvariants();
  assertCrubTechPresetInvariant();
  assertTwoLayerLatePairEligibilityInvariants();
  await assertCrubTechInvariants();
  await assertCrubTechWaterPlatformInvariant();
  await assertCrubTechLatePairPauseMarkerInvariants();
  assertDefaultLatePairYInvariant();
  await assertPaletteCollapseModeInvariants();
  await assertWestEastSlopeExportInvariant();
  console.log("Inline invariants passed.");
  return 0;
}

process.exit(await main());
