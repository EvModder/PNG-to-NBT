#!/usr/bin/env bun
import { gunzipSync } from "node:zlib";

import {
  DEFAULT_CRUBTECH_DARK_WATER_DROP,
  DEFAULT_CRUBTECH_FLAT_WATER_DROP,
  DEFAULT_CRUBTECH_LAYER_GAP,
  DEFAULT_CRUBTECH_LATE_PAIRS_GAP,
  DEFAULT_CRUBTECH_LIGHT_WATER_DROP,
  DEFAULT_LAYER_GAP,
  DEFAULT_SUPPRESS_2LAYER_LATE_PAIRS_GAP,
} from "@/data/defaultSettings";
import { BASE_COLORS, WATER_BASE_INDEX } from "@/data/mapColors";
import { CRUBTECH_PRESET_NAME, getBuiltinPreset } from "@/data/presets";
import { MAP_SIZE, TRANSPARENT_COLOR } from "@/utils/color";
import { BuildMode, FillerRole, SuppressStepDirection, type FillerAssignment } from "@/types/conversion";
import { convertToNbt } from "@/lib/nbtExport";
import { buildSuppressLoadSpotMarkers } from "@/lib/suppressLoadMarkers";
import { generateShapeMap } from "@/lib/shapeGeneration";
import { parseShapeCoordKey, toShapeCoordKey } from "@/lib/shapeModel";
import { Shade, type ColorGrid } from "@/types/color";
import { ShapePartType, type GeneratedShape, type ShapeCell } from "@/types/shape";

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
  // This shape deliberately produces both north-row and in-grid shade fillers
  // on both x parities, so CrubTech must split in-grid suppress roles while
  // keeping north-row/noobline roles piston-breakable.
  colorGrid[0][0] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[1][0] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[2][2] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[3][1] = { id: 1, isCustom: false, shade: Shade.Flat };

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
  const plainSignals = buildSuppressLoadSpotMarkers(
    withCrubTech,
    BuildMode.Suppress2Layer,
    SuppressStepDirection.EastToWest,
    {
      crubTech: true,
      suppressLoadSpotMarkerBlock: "jigsaw",
    },
  ).filter(marker => marker.z === MAP_SIZE && marker.blockName.startsWith("minecraft:redstone_lamp"));
  if (plainSignals.length !== MAP_SIZE / 2) {
    throw new Error(`Expected ${MAP_SIZE / 2} plain CrubTech signal lamps, got ${plainSignals.length}`);
  }
  const expectedPlainSignalY = layerGap + DEFAULT_CRUBTECH_LATE_PAIRS_GAP + 3;
  const misplacedPlainSignal = plainSignals.find(marker => marker.y !== expectedPlainSignalY);
  if (misplacedPlainSignal) {
    throw new Error(`Expected plain CrubTech signal lamps at y=${expectedPlainSignalY}, got y=${misplacedPlainSignal.y}`);
  }
  const litPlainSignal = plainSignals.find(marker => marker.blockName === "minecraft:redstone_lamp[lit=true]");
  if (litPlainSignal) {
    throw new Error(`Expected plain CrubTech signal lamps to be unlit, got lit lamp at x=${litPlainSignal.x}`);
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
  assertBytesContainAscii(bytes, "minecraft:redstone_lamp", "Plain CrubTech export should include all-off signal lamps");
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
  const expectedPlatformYs = [layerGap - 1, layerGap - 1 + DEFAULT_CRUBTECH_LATE_PAIRS_GAP];
  for (const y of expectedPlatformYs) {
    const count = glassCountsByY.get(y) ?? 0;
    if (count !== MAP_SIZE * MAP_SIZE) {
      throw new Error(`Expected full CrubTech glass platform at exported y=${y}, got ${count} blocks`);
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

async function assertCrubTechLatePairPauseMarkerInvariants(): Promise<void> {
  const colorGrid: ColorGrid = Array.from(
    { length: MAP_SIZE },
    () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR),
  );
  colorGrid[0][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[1][1] = { id: 1, isCustom: false, shade: Shade.Flat };
  colorGrid[3][2] = { id: 1, isCustom: false, shade: Shade.Flat };

  const layerGap = DEFAULT_CRUBTECH_LAYER_GAP;
  const latePairY = layerGap + DEFAULT_CRUBTECH_LATE_PAIRS_GAP;
  const shape = generateShapeMap(
    colorGrid,
    undefined,
    false,
    true,
    true,
    {
      layerGap,
      suppress2LayerLatePairY: latePairY,
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
  const plainModeSignalLamps = plainModeMarkers.filter(marker => marker.z === MAP_SIZE && marker.blockName.startsWith("minecraft:redstone_lamp"));
  if (plainModeSignalLamps.length !== MAP_SIZE / 2) {
    throw new Error(`Expected ${MAP_SIZE / 2} plain CrubTech signal lamps, got ${plainModeSignalLamps.length}`);
  }
  const plainModeLitLamp = plainModeSignalLamps.find(marker => marker.blockName === "minecraft:redstone_lamp[lit=true]");
  if (plainModeLitLamp) {
    throw new Error(`Expected plain CrubTech signal lamps to be unlit, got lit lamp at x=${plainModeLitLamp.x}`);
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
  await assertCrubTechInvariants();
  await assertCrubTechWaterPlatformInvariant();
  await assertCrubTechLatePairPauseMarkerInvariants();
  assertDefaultLatePairYInvariant();
  await assertPaletteCollapseModeInvariants();
  console.log("Inline invariants passed.");
  return 0;
}

process.exit(await main());
