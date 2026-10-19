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
import { getBuildModeDownloadSuffix } from "@/utils/conversion";
import { BuildMode, FillerRole, SuppressStepDirection, type FillerAssignment } from "@/types/conversion";
import { requiresTwoLayerLateShading, type WaterDrops } from "@/lib/colorGridAnalysis";
import { convertToCrubTechLayerSplitNbtEntries, convertToNbt } from "@/lib/nbtExport";
import { createFillerAssignments, getSupportModeFillerRoles } from "@/lib/fillerRules";
import { buildSuppressLoadSpotMarkers } from "@/lib/suppressLoadMarkers";
import { buildSuppressStepPhases, buildTwoLayerLoadPhases } from "@/lib/suppressSteps";
import { generateShapeMap } from "@/lib/shapeGeneration";
import { analyzeMaterialNeeds } from "@/lib/shapeAnalysis";
import { parseShapeCoordKey, toShapeCoordKey } from "@/lib/shapeModel";
import { Shade, type ColorGrid, type ShadedColorRef } from "@/types/color";
import { ShapePartType, type GeneratedShape, type ShapeCell } from "@/types/shape";
import { SupportMode } from "@/types/ui";
import { createZip } from "@/utils/zip";

const VS_FILLER_LOAD_SPOT_ORTHOGONAL_REACH = 14;
const CRUBTECH_WATER_COLOR_BLOCK = "glass_pane[east=true,north=true,south=true,west=true,waterlogged=true]";
const CRUBTECH_EXPORT_GLASS_PANE = "minecraft:glass_pane[east=true,north=true,south=true,west=true]";
const CRUBTECH_EXPORT_WATERLOGGED_GLASS_PANE = "minecraft:glass_pane[east=true,north=true,south=true,west=true,waterlogged=true]";
const CRUBTECH_EXPORT_CATCHER_CHAIN = "minecraft:iron_chain[axis=z]";
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
        if (tagName === (dataVersion >= 5006 ? "id" : "Name") && tagType === 8) blockName = readString();
        else if (tagName === (dataVersion >= 5006 ? "properties" : "Properties") && tagType === 10) {
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
  const dataVersion = readInt();
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

async function assertSharedSupportMaterialCounts(): Promise<void> {
  const grid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR));
  const cells: TestExportCell[] = [
    { x: 0, y: 1, z: 0, cell: { id: 11, isCustom: false } },
    { x: 0, y: 0, z: 0, cell: [FillerRole.SupportFragile, FillerRole.SupportWaterSides, FillerRole.SupportWaterSidesCovered] },
  ];
  for (const block of ["stone", "resin_clump[down=true]", "poppy"]) for (const support of ["glass", "cobblestone", "none"]) {
    const selectedBlocks = { 11: block };
    const fillerAssignments = [
      { role: FillerRole.SupportFragile, block: support },
      { role: FillerRole.SupportWaterSides, block: support },
      { role: FillerRole.SupportWaterSidesCovered, block: "glass" },
    ];
    const exported = parseStructureBlocks(await exportTestStructureNbt(cells, selectedBlocks, fillerAssignments, true));
    const counts = analyzeMaterialNeeds(grid, buildTestShape(cells), {
      selectedBlocks, selectedBlocksCustom: {}, customColors: [], fillerAssignments, applySupportFloorYs: false,
    }).blockCounts;
    const expected: Record<string, number> = {};
    for (const cell of exported) {
      const id = cell.blockName.replace("minecraft:", "").split("[")[0];
      expected[id] = (expected[id] ?? 0) + 1;
    }
    for (const id of new Set([...Object.keys(counts), ...Object.keys(expected)])) {
      if (counts[id] !== expected[id]) throw new Error(`Shared support count mismatch for ${block}/${support}: ${id} ${counts[id]} != ${expected[id]}`);
    }
  }

  let seed = 123456789;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const waterGrid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => ({
    id: random() % 100 < 15 ? WATER_BASE_INDEX : 11, isCustom: false, shade: random() % 3 as Shade,
  })));
  for (const mode of [BuildMode.StaircaseValley, BuildMode.StaircaseClassic, BuildMode.StaircaseNorthline]) {
    const shape = generateShapeMap(waterGrid, undefined, true, false, false, {
      layerGap: 5, selectedMode: mode, selectedStepDirection: SuppressStepDirection.EastToWest,
      waterSetting: { kind: "top-aligned" }, enableWaterConvenience: true,
    })[mode]!;
    for (const support of ["glass", "cobblestone"]) {
      const options = {
        selectedBlocks: { 11: "stone", [WATER_BASE_INDEX]: "water" }, selectedBlocksCustom: {}, customColors: [],
        fillerAssignments: createFillerAssignments(support, "resin_block", "moss_block", "resin_block", "slime_block", "slime_block", "resin_block", SupportMode.Fragile, false, true, false),
        applySupportFloorYs: false, buildMode: mode, baseName: "materials",
        suppressStepDirection: SuppressStepDirection.EastToWest, markSuppressLoadSpotsInSchematic: false,
      };
      const result = await convertToNbt(shape, options);
      const exported = parseStructureBlocks(new Uint8Array(gunzipSync(result.data)));
      const expected = exported.filter(cell => cell.blockName === `minecraft:${support}`).length;
      const actual = analyzeMaterialNeeds(waterGrid, shape, options).blockCounts[support] ?? 0;
      if (actual !== expected) throw new Error(`${mode}/${support}: counted ${actual} supports, exported ${expected}`);
    }
  }
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
  assertBytesDoNotContainAscii(bytes, "minecraft:iron_chain", "No-water CrubTech export should omit water catcher chains");
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

  const plainLayerSplitEntries = await convertToCrubTechLayerSplitNbtEntries(withCrubTech, {
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
  const plainLayerSplitNames = plainLayerSplitEntries.map(entry => entry.name);
  const expectedPlainLayerSplitNames = ["crubtech-noobline-test-1.nbt", "crubtech-noobline-test-2.nbt"];
  if (
    plainLayerSplitNames.length !== expectedPlainLayerSplitNames.length ||
    plainLayerSplitNames.some((name, index) => name !== expectedPlainLayerSplitNames[index])
  ) {
    throw new Error(`Unexpected plain CrubTech layer-split entries: [${plainLayerSplitNames.join(", ")}]`);
  }
  const plainLayer1Bytes = new Uint8Array(gunzipSync(plainLayerSplitEntries[0].data));
  const plainLayer2Bytes = new Uint8Array(gunzipSync(plainLayerSplitEntries[1].data));
  assertBytesContainAscii(plainLayer1Bytes, "minecraft:stone", "Layer-split section 1 should contain the dominant-layer colors");
  assertBytesContainAscii(plainLayer1Bytes, "minecraft:moss_block", "Layer-split section 1 should contain the noobline fillers");
  assertBytesDoNotContainAscii(plainLayer1Bytes, "minecraft:glass", "Layer-split section 1 should not contain platform glass");
  assertBytesDoNotContainAscii(plainLayer1Bytes, "minecraft:gold_block", "Layer-split section 1 should not contain upper-layer breakable fillers");
  assertBytesContainAscii(plainLayer2Bytes, "minecraft:glass", "Layer-split section 2 should contain the upper platform glass");
  assertBytesContainAscii(plainLayer2Bytes, "minecraft:gold_block", "Layer-split section 2 should contain upper-layer breakable fillers");
  assertBytesDoNotContainAscii(plainLayer2Bytes, "minecraft:redstone_lamp", "Plain layer-split sections should not contain signal lamps");
  const plainLayerSplitBlockCount =
    parseStructureBlocks(plainLayer1Bytes).length + parseStructureBlocks(plainLayer2Bytes).length;
  if (plainLayerSplitBlockCount !== exportedBlocks.length) {
    throw new Error(
      `Expected plain layer-split sections to cover the full export: ${plainLayerSplitBlockCount} !== ${exportedBlocks.length}`,
    );
  }

  const crubTechSupportAssignments = createFillerAssignments(
    "diamond_block",
    "stone",
    "azalea",
    "resin_block",
    "stone",
    "stone",
    "stone",
    SupportMode.All,
    true,
    false,
    false,
  );
  const standardAllSupportRoles = getSupportModeFillerRoles(SupportMode.All, false, false, false);
  const crubTechStepsSupportRoles = getSupportModeFillerRoles(SupportMode.Steps, false, false, true);
  if (
    !standardAllSupportRoles.includes(FillerRole.SupportAll) ||
    standardAllSupportRoles.includes(FillerRole.SupportBreakable) ||
    standardAllSupportRoles.includes(FillerRole.SupportPushable)
  ) {
    throw new Error("Expected Support=All to retain standard support assignments outside CrubTech");
  }
  if (crubTechStepsSupportRoles.length !== 0) {
    throw new Error("Expected CrubTech to disable Support=Steps in favor of Support=All");
  }
  const crubTechSupportAssignmentsByRole = new Map(
    crubTechSupportAssignments.map(assignment => [assignment.role, assignment.block]),
  );
  if (
    crubTechSupportAssignmentsByRole.has(FillerRole.SupportAll) ||
    crubTechSupportAssignmentsByRole.get(FillerRole.SupportBreakable) !== "azalea" ||
    crubTechSupportAssignmentsByRole.get(FillerRole.SupportPushable) !== "resin_block"
  ) {
    throw new Error("Expected CrubTech Support=All to resolve to split support assignments");
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
  assertBytesDoNotContainAscii(supportBytes, "minecraft:diamond_block", "CrubTech Support=All should ignore the normal support block");
  const supportBlocks = parseStructureBlocks(supportBytes);
  for (const y of expectedPlatformYs) {
    const glassCount = supportBlocks.filter(block => block.y === y && block.blockName === "minecraft:glass").length;
    if (glassCount !== MAP_SIZE * MAP_SIZE) {
      throw new Error(`Expected Support=All to preserve the full CrubTech glass platform at y=${y}, got ${glassCount} blocks`);
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

  const layerSplitEntries = await convertToCrubTechLayerSplitNbtEntries(shape, {
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
  const layerSplitNames = layerSplitEntries.map(entry => entry.name);
  const expectedLayerSplitNames = [
    "crubtech-pause-marker-test-1.nbt",
    "crubtech-pause-marker-test-2.nbt",
    "crubtech-pause-marker-test-late_pairs.nbt",
    "crubtech-pause-marker-test-water.nbt",
  ];
  if (
    layerSplitNames.length !== expectedLayerSplitNames.length ||
    layerSplitNames.some((name, index) => name !== expectedLayerSplitNames[index])
  ) {
    throw new Error(`Unexpected CrubTech layer-split entries: [${layerSplitNames.join(", ")}]`);
  }
  const [layer1Bytes, layer2Bytes, latePairBytes, waterBytes] = layerSplitEntries.map(
    entry => new Uint8Array(gunzipSync(entry.data)),
  );
  assertBytesContainAscii(layer1Bytes, "minecraft:stone", "Layer-split section 1 should contain the dominant-layer colors");
  assertBytesDoNotContainAscii(layer1Bytes, "minecraft:glass", "Layer-split section 1 should not contain platform glass");
  assertBytesContainAscii(layer2Bytes, "minecraft:glass", "Layer-split section 2 should contain the upper platform glass");
  assertBytesDoNotContainAscii(layer2Bytes, "minecraft:redstone_lamp", "Layer-split section 2 should not contain signal lamps");
  assertBytesContainAscii(latePairBytes, "minecraft:glass", "Layer-split late_pairs section should contain the late platform glass");
  assertBytesContainAscii(latePairBytes, "minecraft:redstone_lamp", "Layer-split late_pairs section should contain the signal lamps");
  assertBytesContainAscii(latePairBytes, "minecraft:resin_block", "Layer-split late_pairs section should contain late pushable fillers");
  assertBytesContainAscii(waterBytes, "minecraft:glass", "Layer-split water section should contain the bottom platform glass");
  assertBytesContainAscii(waterBytes, "minecraft:glass_pane", "Layer-split water section should contain the water shade panes");
  assertBytesContainAscii(waterBytes, "minecraft:iron_chain", "Layer-split water section should contain the catcher chains");
  assertBytesContainAscii(waterBytes, "minecraft:water", "Layer-split water section should contain the water columns");
  const layerSplitBlockCount = layerSplitEntries.reduce(
    (sum, entry) => sum + parseStructureBlocks(new Uint8Array(gunzipSync(entry.data))).length,
    0,
  );
  const singleExportBlockCount = parseStructureBlocks(new Uint8Array(gunzipSync(exportResult.data))).length;
  if (layerSplitBlockCount !== singleExportBlockCount) {
    throw new Error(
      `Expected layer-split sections to cover the full export: ${layerSplitBlockCount} !== ${singleExportBlockCount}`,
    );
  }
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

function assertMixedStepMarkerInvariants(): void {
  const grid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array(MAP_SIZE).fill(TRANSPARENT_COLOR));
  // Water-only phases borrow the northern color from another phase when mixing is enabled.
  for (const [x, z] of [[0, 1], [127, 0], [64, 63]]) {
    grid[x][z] = { id: 1, isCustom: false, shade: Shade.Light };
    grid[x][z + 1] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Light };
  }
  grid[32][20] = { id: 1, isCustom: false, shade: Shade.Dark };
  grid[32][21] = { id: WATER_BASE_INDEX, isCustom: false, shade: Shade.Dark };
  for (const mode of [BuildMode.SuppressStepPairs, BuildMode.SuppressStepChecker]) {
    const width = mode === BuildMode.SuppressStepPairs ? 1 : 2;
    const distance = width === 1 ? 126 : 124;
    for (const direction of Object.values(SuppressStepDirection)) {
      const axisX = direction === SuppressStepDirection.EastToWest || direction === SuppressStepDirection.WestToEast;
      const ascending = direction === SuppressStepDirection.WestToEast || direction === SuppressStepDirection.NorthToSouth;
      for (const mixSteps of [false, true]) for (const skipEmptySuppressSteps of [false, true]) {
        for (const belowWater of [false, true]) {
          const shape = generateShapeMap(grid, undefined, true, true, true, {
            layerGap: 1, selectedMode: mode, selectedStepDirection: direction,
            mixSteps, skipEmptySuppressSteps, collapseStaircaseModes: false,
            waterSetting: belowWater ? { kind: "below-platform", drops: [24, 14, 7] } : undefined,
          })[mode];
          if (!shape) throw new Error("Missing mixed-step test shape");
          const phaseByY = new Map<number, number>();
          let expectedPairMarkers = 0;
          for (const [index, part] of shape.parts.entries()) {
            if (belowWater && index === 0) {
              if (part.suppressStepIndex !== undefined) throw new Error("Water preview must not become a suppress step");
              continue;
            }
            if (part.suppressStepIndex === undefined) throw new Error("Missing original suppress phase index");
            if (!skipEmptySuppressSteps && part.suppressStepIndex !== index - Number(belowWater)) {
              throw new Error("Incorrect original suppress phase index");
            }
            phaseByY.set(Math.min(...part.supportFloorYs) + 1, part.suppressStepIndex);
            if ([...part.cells.values()].some(cell => !Array.isArray(cell) && cell.id !== WATER_BASE_INDEX)) {
              expectedPairMarkers += 64;
            }
          }
          const markers = buildSuppressLoadSpotMarkers(shape, mode, direction, { markSuppressLoadSpotsInSchematic: true });
          if (width === 1 && markers.length !== expectedPairMarkers) throw new Error("Missing step-pair markers");
          if (markers.length === 0) throw new Error("Expected suppress step markers");
          for (const marker of markers) {
            const phase = phaseByY.get(marker.y);
            if (phase === undefined) throw new Error("Marker has no matching phase Y");
            const line = ascending ? phase * width + width - 1 + distance : MAP_SIZE - width - phase * width - distance;
            if ((axisX ? marker.x : marker.z) !== line) throw new Error("Marker shifted to the wrong suppress phase");
          }
        }
      }
    }
  }
}

function assertTwoLayerMapPixels(): void {
  const schedules = Object.values(SuppressStepDirection).flatMap(direction => [false, true].map(centerOut => {
    const phases = buildTwoLayerLoadPhases(direction, centerOut);
    const lastUpdate = new Int16Array(MAP_SIZE * MAP_SIZE).fill(-1);
    for (const [index, phase] of phases.entries()) for (const front of phase.fronts) {
      const offsets = (front.loadLine & 1) === 0 ? [15, 41, 65, 89, 113] : [14, 40, 64, 88, 112];
      for (let x = 0; x < MAP_SIZE; ++x) for (let z = 0; z < MAP_SIZE; ++z) {
        if (offsets.some(offset => {
          const distance = phase.axis === "x" ? (front.loadLine - x) ** 2 + (offset - z) ** 2 : (offset - x) ** 2 + (front.loadLine - z) ** 2;
          return distance < 128 ** 2 && (distance <= 126 ** 2 || (x + z) % 2 === 1);
        })) lastUpdate[x * MAP_SIZE + z] = index;
      }
    }
    return { direction, centerOut, phases, lastUpdate };
  }));
  for (const water of ["none", "above", "below"]) for (const sparse of [false, true]) for (const gap of [2, 5]) {
    let seed = 987654321;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 8;
    const grid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => {
      const value = next(), shade = next() % 3 as Shade;
      return sparse && value % 4 === 0 ? TRANSPARENT_COLOR : { id: water !== "none" && value % 7 === 0 ? WATER_BASE_INDEX : 1, isCustom: false, shade };
    }));
    const drops: WaterDrops | undefined = water === "below" ? [24, 14, 7] : undefined;
    const needsLate = requiresTwoLayerLateShading(grid, drops);
    for (const mode of [BuildMode.Suppress2Layer, BuildMode.Suppress2LayerLateFillers, BuildMode.Suppress2LayerLatePairs]) {
      const lateY = gap + 2;
      const shape = generateShapeMap(grid, undefined, water !== "none", sparse, needsLate, {
        layerGap: gap, selectedMode: mode, selectedStepDirection: SuppressStepDirection.EastToWest, suppress2LayerLatePairY: lateY,
        waterSetting: drops ? { kind: "below-platform", drops } : undefined,
      })[mode];
      if (!shape) continue;
      const columns = new Map<number, { y: number; id: number; late: boolean }[]>();
      for (const [coord, cell] of shape.parts[0].cells) {
        if (Array.isArray(cell) && !cell.some(role => role.startsWith("shade_"))) continue;
        const [x, y, z] = parseShapeCoordKey(coord);
        const id = Array.isArray(cell) ? -1 : cell.id;
        const late = Array.isArray(cell) && cell.includes(FillerRole.ShadeSuppressLate) || mode === BuildMode.Suppress2LayerLatePairs && y === lateY && id !== WATER_BASE_INDEX;
        const key = x * (MAP_SIZE + 1) + z + 1;
        const column = columns.get(key) ?? [];
        column.push({ y, id, late });
        columns.set(key, column);
      }
      for (const column of columns.values()) column.sort((a, b) => b.y - a.y);
      for (const { direction, centerOut, phases, lastUpdate } of schedules) {
        const top = (x: number, z: number, phase: number) => {
          const line = phases[0].axis === "x" ? x : z;
          // The north border belongs to row 0, not the south-moving half of center-out.
          const cleared = phase >= 0 && phases[phase].fronts.some(front =>
            line >= front.clearedRange[0] && line <= front.clearedRange[1] || phases[0].axis === "z" && z === -1 && front.clearedRange[0] === 0);
          return columns.get(x * (MAP_SIZE + 1) + z + 1)?.find(block => block.late ? cleared : !cleared || block.y < gap);
        };
        for (let x = 0; x < MAP_SIZE; ++x) for (let z = 0; z < MAP_SIZE; ++z) {
          const phase = lastUpdate[x * MAP_SIZE + z];
          const block = top(x, z, phase), northY = top(x, z - 1, phase)?.y ?? -1;
          const expected = grid[x][z];
          let shade = block && (block.y > northY ? Shade.Light : block.y < northY ? Shade.Dark : Shade.Flat);
          if (block?.id === WATER_BASE_INDEX) {
            const depth = columns.get(x * (MAP_SIZE + 1) + z + 1)!.filter(cell => cell.id === WATER_BASE_INDEX && cell.y <= block.y).length;
            // Lowered-water cells are source anchors; their falling columns are added during export.
            if (drops) {
              const drop = drops.at(expected.shade);
              if (drop === undefined || block.y !== -drop) throw new Error("Changed below-platform water anchor");
              shade = expected.shade;
            } else {
              const dominant = (x + z) % 2 === 1;
              shade = depth > (dominant ? 6 : 9) ? Shade.Dark : depth > (dominant ? 2 : 4) ? Shade.Flat : Shade.Light;
            }
          }
          if (expected.id === 0 ? block !== undefined : block?.id !== expected.id || shade !== expected.shade) {
            throw new Error(`Incorrect 2-layer map pixel: ${mode}, ${direction}, center=${centerOut}, water=${water}, gap=${gap}, (${x}, ${z})`);
          }
        }
      }
    }
  }
}

async function assertTwoLayerDirectionInvariants(): Promise<void> {
  const grid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => ({
    id: 1, isCustom: false, shade: Shade.Dark,
  })));
  for (const mode of [BuildMode.Suppress2Layer, BuildMode.Suppress2LayerLateFillers, BuildMode.Suppress2LayerLatePairs]) {
    const shape = generateShapeMap(grid, undefined, false, false, mode !== BuildMode.Suppress2Layer, {
      layerGap: 5, selectedMode: mode, selectedStepDirection: SuppressStepDirection.EastToWest,
    })[mode]!;
    const materialOptions = {
      selectedBlocks: { 1: "stone" }, selectedBlocksCustom: {}, customColors: [], applySupportFloorYs: true,
      fillerAssignments: [{ role: FillerRole.ShadeSuppress, block: "resin_block" }, { role: FillerRole.ShadeNorthRow, block: "resin_block" }],
    };
    const fullCounts = analyzeMaterialNeeds(grid, shape, materialOptions).blockCounts;
    const rowCounts = analyzeMaterialNeeds(grid, shape, { ...materialOptions, zColumnRange: [0, MAP_SIZE - 1] }).blockCounts;
    if (JSON.stringify(fullCounts) !== JSON.stringify(rowCounts)) throw new Error("Full row range must retain north-border materials");
    const firstRow = analyzeMaterialNeeds(grid, shape, { ...materialOptions, zColumnRange: [0, 0] }).colorCounts;
    if (Object.values(firstRow).reduce((sum, count) => sum + count, 0) !== MAP_SIZE) throw new Error("Row range must count rows, not columns or the full tile");
    for (const direction of Object.values(SuppressStepDirection)) {
      const axisX = direction === SuppressStepDirection.EastToWest || direction === SuppressStepDirection.WestToEast;
      const ascending = direction === SuppressStepDirection.WestToEast || direction === SuppressStepDirection.NorthToSouth;
      const markers = buildSuppressLoadSpotMarkers(shape, mode, direction, { markSuppressLoadSpotsInSchematic: true });
      if (markers.length !== (axisX ? 315 : ascending ? 635 : 625)) throw new Error("Incorrect 2-layer load route length");
      for (const [index, marker] of markers.entries()) {
        const expectedLine = ascending ? MAP_SIZE + Number(axisX) + Math.floor(index / 5) * (axisX ? 2 : 1) : -2 - Math.floor(index / 5) * (axisX ? 2 : 1);
        const orientation = axisX ? ascending ? "up_west" : "up_east" : ascending ? "up_north" : "up_south";
        if ((axisX ? marker.x : marker.z) !== expectedLine || !marker.blockName.includes(orientation)) {
          throw new Error("Incorrect 2-layer load route or marker orientation");
        }
        const orthogonal = axisX ? marker.z : marker.x;
        if (orthogonal < 0 || orthogonal >= MAP_SIZE || shape.parts.some(part => part.cells.has(toShapeCoordKey(marker.x, marker.y, marker.z)))) {
          throw new Error("2-layer marker overlaps the build");
        }
      }
      const suffix = axisX ? ascending ? "_WE" : "_EW" : ascending ? "_NS" : "_SN";
      if (!getBuildModeDownloadSuffix(mode, direction).endsWith(suffix)) throw new Error("Incorrect 2-layer direction suffix");
      if (buildSuppressLoadSpotMarkers(shape, mode, direction, {}).length) throw new Error("Disabled markers must remain absent");
      const result = await convertToNbt(shape, {
        selectedBlocks: { 1: "stone" }, selectedBlocksCustom: {}, customColors: [],
        fillerAssignments: [{ role: FillerRole.ShadeSuppress, block: "resin_block" }, { role: FillerRole.ShadeNorthRow, block: "resin_block" }],
        applySupportFloorYs: true, forceXZ128: true, forceZ129: true, buildMode: mode,
        suppressStepDirection: direction, markSuppressLoadSpotsInSchematic: true, baseName: "two-layer-direction",
      });
      if (result.isZip) throw new Error("Directional 2-layer must remain one schematic");
      const exported = parseStructureBlocks(new Uint8Array(gunzipSync(result.data)));
      if (exported.filter(block => block.blockName.startsWith("minecraft:jigsaw")).length !== markers.length) throw new Error("Lost 2-layer load markers");
      if (new Set(exported.map(block => `${block.x},${block.y},${block.z}`)).size !== exported.length) throw new Error("Duplicate export coordinates");
      if (mode !== BuildMode.Suppress2LayerLateFillers) {
        const crubMarkers = buildSuppressLoadSpotMarkers(shape, mode, direction, { crubTech: true, markSuppressLoadSpotsInSchematic: true });
        if (crubMarkers.some(marker => marker.blockName.startsWith("minecraft:jigsaw"))) throw new Error("CrubTech must retain its fixed route");
      }
    }
  }
}

async function assertCenterOutInvariants(): Promise<void> {
  const grids: ColorGrid[] = [
    Array.from({ length: MAP_SIZE }, (_, x) => Array.from({ length: MAP_SIZE }, (_, z) => ({
      id: 1, isCustom: false, shade: (x * 11 + z * 13) % 3 as Shade,
    }))),
    Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR)),
  ];
  for (const [x, z] of [[0, 0], [62, 62], [63, 63], [64, 64], [65, 65], [127, 127]]) {
    grids[1][x][z] = { id: 1, isCustom: false, shade: Shade.Dark };
  }
  for (const grid of grids) for (const mode of [BuildMode.SuppressStepChecker, BuildMode.SuppressStepPairs] as const) {
    for (const direction of [SuppressStepDirection.EastToWest, SuppressStepDirection.NorthToSouth]) {
      // Center-out north/south is gated off for void shading, which must be approached from one side.
      if (grid === grids[1] && direction === SuppressStepDirection.NorthToSouth) continue;
      for (const mixSteps of [false, true]) {
        const specs = buildSuppressStepPhases(mode, direction, true);
        const expectedPhases = mode === BuildMode.SuppressStepChecker ? 33 : 65;
        if (specs.length !== expectedPhases) throw new Error("Incorrect center-out phase count");
        const visits = new Uint8Array(MAP_SIZE * MAP_SIZE);
        for (const [phase, spec] of specs.entries()) for (let x = 0; x < MAP_SIZE; ++x) for (let z = 0; z < MAP_SIZE; ++z) {
          const line = spec.axis === "x" ? x : z;
          const distanceFromCenter = line < MAP_SIZE / 2 ? MAP_SIZE / 2 - 1 - line : line - MAP_SIZE / 2;
          const expectedPhase = Math.floor(distanceFromCenter / (mode === BuildMode.SuppressStepChecker ? 2 : 1)) + Number(((x + z) & 1) === 1);
          if (spec.includeAt(x, z) !== (phase === expectedPhase)) throw new Error("Incorrect center-out recessive/dominant strip sequence");
          if (spec.includeAt(x, z)) ++visits[x * MAP_SIZE + z];
        }
        if (visits.some(count => count !== 1)) throw new Error("Center-out schedule must visit every pixel exactly once");
        const shape = generateShapeMap(grid, undefined, false, true, true, {
          layerGap: 5, selectedMode: mode, selectedStepDirection: direction,
          suppressCenterOut: true, mixSteps, skipEmptySuppressSteps: true,
        })[mode]!;
        const markers = buildSuppressLoadSpotMarkers(shape, mode, direction, {
          suppressCenterOut: true, markSuppressLoadSpotsInSchematic: true,
        });
        const recorded = new Map<number, string>();
        const finished = new Set<number>();
        for (const part of shape.parts) {
          const spec = specs[part.suppressStepIndex!];
          const floorY = Math.min(...part.supportFloorYs);
          const spots = markers.filter(marker => marker.y === floorY + 1);
          const tops = new Map<number, { y: number; id: number }>();
          for (const [key, cell] of part.cells) {
            if (Array.isArray(cell) && !cell.some(role => role === FillerRole.ShadeNorthRow || role === FillerRole.ShadeSuppress)) continue;
            const [x, y, z] = parseShapeCoordKey(key);
            const column = x * (MAP_SIZE + 1) + z + 1;
            if (y > (tops.get(column)?.y ?? -Infinity)) tops.set(column, { y, id: Array.isArray(cell) ? -1 : cell.id });
          }
          for (let x = 0; x < MAP_SIZE; ++x) for (let z = 0; z < MAP_SIZE; ++z) {
            const pixel = x * MAP_SIZE + z;
            const updated = spots.some(spot => {
              const distance = (spot.x - x) ** 2 + (spot.z - z) ** 2;
              return distance < 128 ** 2 && (distance <= 126 ** 2 || ((x + z) & 1) === 1);
            });
            if (updated && finished.has(pixel)) throw new Error("Center-out load spot overwrites a finished strip");
            if (!updated) {
              if (spec.includeAt(x, z)) throw new Error("Center-out load spots miss a phase target");
              continue;
            }
            const column = x * (MAP_SIZE + 1) + z + 1;
            const top = tops.get(column), northY = tops.get(column - 1)?.y ?? floorY;
            recorded.set(pixel, top ? `${top.id}:${top.y > northY ? Shade.Light : top.y < northY ? Shade.Dark : Shade.Flat}` : "transparent");
          }
          for (let x = 0; x < MAP_SIZE; ++x) for (let z = 0; z < MAP_SIZE; ++z) {
            if (spec.includeAt(x, z)) finished.add(x * MAP_SIZE + z);
          }
        }
        for (let x = 0; x < MAP_SIZE; ++x) for (let z = 0; z < MAP_SIZE; ++z) {
          const color = grid[x][z];
          const expected = color.id === 0 ? "transparent" : `${color.id}:${color.shade}`;
          if ((recorded.get(x * MAP_SIZE + z) ?? "transparent") !== expected) {
            throw new Error(`Incorrect center-out map pixel: ${mode}, ${direction}, mix=${mixSteps}, (${x}, ${z}): ${recorded.get(x * MAP_SIZE + z)} != ${expected}`);
          }
        }
        const result = await convertToNbt(shape, {
          selectedBlocks: { 1: "stone" }, selectedBlocksCustom: {}, customColors: [],
          fillerAssignments: [{ role: FillerRole.ShadeSuppress, block: "resin_block" }, { role: FillerRole.ShadeNorthRow, block: "resin_block" }],
          applySupportFloorYs: true, forceXZ128: true, forceZ129: true,
          buildMode: mode, suppressStepDirection: direction, suppressCenterOut: true,
          markSuppressLoadSpotsInSchematic: true, baseName: "center-out",
        });
        if (result.isZip) throw new Error("Both center-out fronts must share one schematic");
        const exportedMarkers = parseStructureBlocks(new Uint8Array(gunzipSync(result.data))).filter(block => block.blockName.startsWith("minecraft:jigsaw"));
        if (exportedMarkers.length !== markers.length) throw new Error("Center-out NBT lost load markers");
      }
    }
  }
}

async function assertCenterOutTwoLayerInvariants(): Promise<void> {
  const grid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => ({
    id: 1, isCustom: false, shade: Shade.Dark,
  })));
  for (const mode of [BuildMode.Suppress2Layer, BuildMode.Suppress2LayerLateFillers, BuildMode.Suppress2LayerLatePairs]) for (const direction of Object.values(SuppressStepDirection)) {
    const axisX = direction === SuppressStepDirection.EastToWest || direction === SuppressStepDirection.WestToEast;
    const markerCount = axisX ? 320 : 640;
    const options = { layerGap: 5, selectedMode: mode, selectedStepDirection: direction };
    const shape = generateShapeMap(grid, undefined, false, false, mode !== BuildMode.Suppress2Layer, options)[mode]!;
    const centered = generateShapeMap(grid, undefined, false, false, mode !== BuildMode.Suppress2Layer, { ...options, suppressCenterOut: true })[mode];
    if (shape !== centered) throw new Error("Center-out must reuse the existing 2-layer geometry");
    const markerOptions = { suppressCenterOut: true, markSuppressLoadSpotsInSchematic: true };
    const markers = buildSuppressLoadSpotMarkers(shape, mode, options.selectedStepDirection, markerOptions);
    if (markers.length !== markerCount || !markers.some(marker => (axisX ? marker.x : marker.z) < 0) || !markers.some(marker => (axisX ? marker.x : marker.z) >= MAP_SIZE)) {
      throw new Error("2-layer center-out requires both complete load routes");
    }
    if (mode !== BuildMode.Suppress2LayerLateFillers) {
      const crubMarkers = buildSuppressLoadSpotMarkers(shape, mode, options.selectedStepDirection, { ...markerOptions, crubTech: true });
      const oldCrubMarkers = buildSuppressLoadSpotMarkers(shape, mode, options.selectedStepDirection, { ...markerOptions, suppressCenterOut: false, crubTech: true });
      if (JSON.stringify(crubMarkers) !== JSON.stringify(oldCrubMarkers)) throw new Error("Center-out must not affect CrubTech markers");
    }
    const result = await convertToNbt(shape, {
      selectedBlocks: { 1: "stone" }, selectedBlocksCustom: {}, customColors: [],
      fillerAssignments: [{ role: FillerRole.ShadeSuppress, block: "resin_block" }, { role: FillerRole.ShadeNorthRow, block: "resin_block" }],
      applySupportFloorYs: true, forceXZ128: true, forceZ129: true, buildMode: mode,
      suppressStepDirection: options.selectedStepDirection, ...markerOptions, baseName: "center-out-2layer",
    });
    if (result.isZip) throw new Error("Center-out 2-layer must remain one schematic");
    const exported = parseStructureBlocks(new Uint8Array(gunzipSync(result.data)));
    if (exported.filter(block => block.blockName.startsWith("minecraft:jigsaw")).length !== markerCount) throw new Error("Missing 2-layer load markers");
  }
}

function assertZipMetadata(): void {
  const name = "caf\u00e9-\u5730\u56fe.nbt";
  const data = new Uint8Array([1, 2, 3]);
  const before = new Date();
  const archive = createZip([{ name, data }]);
  const after = new Date();
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const nameSize = new TextEncoder().encode(name).length;
  const central = 30 + nameSize + data.length;
  for (const [offset, flags, date, filename] of [[0, 6, 12, 30], [central, 8, 14, 46]]) {
    if (view.getUint16(offset + flags, true) !== 0x800) throw new Error("ZIP filenames must be marked UTF-8 in both headers");
    if (![before, after].some(now =>
      view.getUint16(offset + date, true) === ((now.getFullYear() - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate()) &&
      view.getUint16(offset + date - 2, true) === (now.getHours() << 11 | now.getMinutes() << 5 | now.getSeconds() >> 1),
    )) throw new Error("ZIP timestamp must reflect generation time");
    if (new TextDecoder().decode(archive.subarray(offset + filename, offset + filename + nameSize)) !== name) throw new Error("ZIP filename changed");
  }
  assertBytesEqual(archive.subarray(30 + nameSize, central), data, "ZIP payload unchanged");
}

async function main(): Promise<number> {
  assertZipMetadata();
  await assertSharedSupportMaterialCounts();
  assertVsSparseMarkerInvariants();
  assertMixedStepMarkerInvariants();
  await assertCenterOutInvariants();
  await assertCenterOutTwoLayerInvariants();
  assertCrubTechPresetInvariant();
  assertTwoLayerLatePairEligibilityInvariants();
  await assertTwoLayerDirectionInvariants();
  assertTwoLayerMapPixels();
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
