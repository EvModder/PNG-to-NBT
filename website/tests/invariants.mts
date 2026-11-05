#!/usr/bin/env bun
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";

import {
  DEFAULT_CORAL_SUPPORT_BLOCK,
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
import { buildFillerAssignmentMap, createFillerAssignments, getSupportModeFillerRoles, isCoralSupportValid } from "@/lib/fillerRules";
import { buildSuppressLoadSpotMarkers } from "@/lib/suppressLoadMarkers";
import { buildSuppressStepPhases, buildTwoLayerLoadPhases } from "@/lib/suppressSteps";
import { generateShapeMap } from "@/lib/shapeGeneration";
import { countUnsupportedLifts, getGroundedStepColors, getMixedStepSettings, getMixedStepReuse, getMixedStepColor, scopeMixedStepPalette } from "@/lib/mixedStepHeights";
import { getEnvironmentalSettings, isGrowthCoverEnabled, isGrowthCoverValid } from "@/lib/environmentalSupport";
import { analyzeFillerNeeds, analyzeMaterialNeeds, analyzeScaffoldingSupport } from "@/lib/shapeAnalysis";
import { getBlockSupport, canSupportBlock, getCommonSupportChoices, standsOnFloor } from "@/lib/blockSupport";
import { FRAGILE_SUPPORT_RULES, isFragileBlock } from "@/data/blockFragility";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import { getPlacementWarnings } from "@/lib/placementWarnings";
import { messages } from "@/lib/messages";
import { enCatalog } from "@/data/i18n/en";
import { esCatalog } from "@/data/i18n/es";
import { normalizeBlockId, resolveExportBlockName, sanitizeUserBlockEntry, toDisplayName, type ColorBlockSelections } from "@/lib/blockId";
import { parseShapeCoordKey, resolveShapeBlockName, toShapeCoordKey } from "@/lib/shapeModel";
import { Shade, type ColorGrid, type ShadedColorRef } from "@/types/color";
import { ShapePartType, type GeneratedShape, type ShapeCell } from "@/types/shape";
import { SupportMode } from "@/types/ui";
import { createZip } from "@/utils/zip";
import { getTwoLayerSpacing, shouldAssumeSupportFloor } from "@/lib/generationPolicy";

// Preserve the UI's spacing policy while moving it out of Index.
for (const support of Object.values(SupportMode)) for (const crubTech of [false, true]) {
  for (const requestedLayerGap of [2, 3, 5, 14, 20, 63]) for (const requestedLateGap of [-5, 1, 10, 63, NaN, 2.5]) {
    const minLayerGap = support === SupportMode.All || support === SupportMode.Fragile ? 3 : 2;
    const layerGap = crubTech ? DEFAULT_CRUBTECH_LAYER_GAP : Math.max(minLayerGap, requestedLayerGap);
    const maxLatePairsGap = Math.max(1, 64 - Math.max(1, layerGap));
    const rawGap = Number.isFinite(requestedLateGap) ? Math.trunc(requestedLateGap) : DEFAULT_SUPPRESS_2LAYER_LATE_PAIRS_GAP;
    const latePairsGap = crubTech ? DEFAULT_CRUBTECH_LATE_PAIRS_GAP : Math.max(1, Math.min(maxLatePairsGap, rawGap));
    const expected = { minLayerGap, layerGap, maxLatePairsGap, latePairsGap, latePairY: Math.max(1, layerGap) + latePairsGap };
    if (JSON.stringify(getTwoLayerSpacing(support, requestedLayerGap, requestedLateGap, crubTech)) !== JSON.stringify(expected)) {
      throw new Error("Shared two-layer spacing differs from the UI policy");
    }
  }
}

const VS_FILLER_LOAD_SPOT_ORTHOGONAL_REACH = 14;
const CRUBTECH_WATER_COLOR_BLOCK = "glass_pane[east=true,north=true,south=true,west=true,waterlogged=true]";
const CRUBTECH_EXPORT_GLASS_PANE = "minecraft:glass_pane[east=true,north=true,south=true,west=true]";
const CRUBTECH_EXPORT_WATERLOGGED_GLASS_PANE = "minecraft:glass_pane[east=true,north=true,south=true,west=true,waterlogged=true]";
const CRUBTECH_EXPORT_CATCHER_CHAIN = "minecraft:iron_chain[axis=z]";
const CRUBTECH_EXPORT_FALLING_WATER = "minecraft:water[level=8]";

function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (Buffer.compare(actual, expected) === 0) return;
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
  if (Buffer.compare(left, right) !== 0) return;
  throw new Error(`${label}: expected differing bytes`);
}

function assertBytesContainAscii(bytes: Uint8Array, expected: string, label: string): void {
  if (!Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(expected)) {
    throw new Error(`${label}: expected bytes to contain ${expected}`);
  }
}

function assertBytesDoNotContainAscii(bytes: Uint8Array, expected: string, label: string): void {
  if (Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(expected)) {
    throw new Error(`${label}: expected bytes not to contain ${expected}`);
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
  autoPickSupports = false,
): Promise<Uint8Array> {
  const shape = buildTestShape(cells);
  const { data, isZip } = await convertToNbt(shape, {
    selectedBlocks,
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [...fillerAssignments],
    autoPickSupports,
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
  const mixed: TestExportCell[] = [18, 13].flatMap((id, x) => [
    { x, y: 1, z: 0, cell: { id, isCustom: false } }, { x, y: 0, z: 0, cell: [FillerRole.SupportFragile] },
  ]);
  const plants = { 18: "wheat[age=7]", 13: "oak_pressure_plate" };
  const mixedShape = buildTestShape(mixed);
  for (const base of ["stone", "farmland", "air"]) for (const autoPickSupports of [false, true]) {
    const fillers = [{ role: FillerRole.SupportFragile, block: base }];
    const result = parseStructureBlocks(await exportTestStructureNbt(mixed, plants, fillers, true, autoPickSupports));
    const expected = autoPickSupports ? ["farmland", base === "stone" ? "stone" : "cobblestone"] : [base, base];
    for (const [x, id] of expected.entries()) {
      const support = result.find(cell => cell.x === x && !["wheat", "oak_pressure_plate"].includes(normalizeBlockId(cell.blockName)));
      assert.equal(support?.blockName, id === "air" ? undefined : `minecraft:${id}`, `${base}/${autoPickSupports}: wrong substrate at ${x}`);
    }
    const options = { selectedBlocks: plants, selectedBlocksCustom: {}, customColors: [], autoPickSupports, fillerAssignments: fillers, applySupportFloorYs: false };
    const stats = analyzeMaterialNeeds(grid, mixedShape, options);
    const expectedCounts: Record<string, number> = { wheat: 1, oak_pressure_plate: 1 };
    for (const id of expected) if (id !== "air") expectedCounts[id] = (expectedCounts[id] ?? 0) + 1;
    assert.deepEqual(stats.blockCounts, expectedCounts);
    assert.equal(stats.fillerRoleCounts.get(FillerRole.SupportFragile) ?? 0,
      autoPickSupports ? expected.filter(id => id === base).length : 2);
    assert.equal(getPlacementWarnings([mixedShape], options, fillers, false, BuildMode.Flat).some(w => w.kind === "autoSupport"), !autoPickSupports);
  }
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
    const part = buildTestShape(cells).parts[0];
    const warningBlocks: Record<string, number> = {};
    for (const coord of part.cells.keys()) {
      const resolved = resolveShapeBlockName(part, coord, { selectedBlocks, selectedBlocksCustom: {}, customColors: [] },
        buildFillerAssignmentMap(fillerAssignments), false);
      if (!resolved) continue;
      const id = normalizeBlockId(resolved);
      warningBlocks[id] = (warningBlocks[id] ?? 0) + 1;
    }
    assert.deepEqual(warningBlocks, expected, "Warnings must resolve the same support priority and replacements as exports");
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

async function assertTripwireInvariants(): Promise<void> {
  for (const [input, expected] of [
    ["string", "tripwire"], [" MINECRAFT:STRING ", "tripwire"],
    ["string[powered=false]", "tripwire[powered=false]"],
    ["minecraft:string[attached=true]", "tripwire[attached=true]"],
    ["mod:string", "mod:string"], ["string_block", "string_block"], ["tripwire", "tripwire"],
    // Multiface blocks without a true face get down=true; false faces never count.
    ["glow_lichen", "glow_lichen[down=true]"], ["glow_lichen[down=true]", "glow_lichen[down=true]"],
    ["minecraft:sculk_vein[north=false]", "sculk_vein[down=true]"], ["glow_lichen[down=false]", "glow_lichen[down=true]"],
    ["resin_clump[waterlogged=true]", "resin_clump[waterlogged=true,down=true]"],
    ["glow_lichen[north=true]", "glow_lichen[north=true]"], ["glow_lichen[north=true,down=false]", "glow_lichen[north=true,down=false]"],
    ["glow_lichen[down=true,up=true]", "glow_lichen[down=true,up=true]"],
  ]) assert.equal(sanitizeUserBlockEntry(input), expected);
  // Entries that skip input sanitizing still export a face.
  for (const [input, exported] of [
    ["glow_lichen", "minecraft:glow_lichen[down=true]"], ["resin_clump[waterlogged=true]", "minecraft:resin_clump[waterlogged=true,down=true]"],
    ["glow_lichen[down=false,waterlogged=true]", "minecraft:glow_lichen[waterlogged=true,down=true]"], ["sculk_vein[up=true]", "minecraft:sculk_vein[up=true]"],
  ]) assert.equal(resolveExportBlockName(input), exported);
  assert.equal(toDisplayName("minecraft:glow_lichen[down=true]"), "glow_lichen[down=true]");
  assert.equal(getBlockSupport("glow_lichen").props.get("down"), "true");
  const wireCells: TestExportCell[] = [
    { x: 1, y: 0, z: 1, cell: [FillerRole.SupportAll] },
    { x: 2, y: 0, z: 1, cell: { id: 1, isCustom: false } },
    { x: 3, y: 1, z: 1, cell: [FillerRole.SupportAll] },
    { x: 1, y: 0, z: 0, cell: { id: 2, isCustom: false } },
    { x: 0, y: 0, z: 1, cell: { id: 2, isCustom: false } },
    { x: 1, y: 0, z: 2, cell: { id: 3, isCustom: false } },
  ];
  const wireBlocks = parseStructureBlocks(await exportTestStructureNbt(wireCells,
    { 1: "tripwire", 2: "tripwire_hook[facing=south]", 3: "tripwire_hook" },
    [{ role: FillerRole.SupportAll, block: "tripwire[west=true,disarmed=true]" }], true));
  const wireAt = (x: number, y: number) => wireBlocks.find(b => b.x === x && b.y === y && b.z === 1)?.blockName;
  assert.equal(wireAt(1, 0), "minecraft:tripwire[disarmed=true,north=true,east=true,south=true]");
  assert.equal(wireAt(2, 0), "minecraft:tripwire[west=true]");
  assert.equal(wireAt(3, 1), "minecraft:tripwire[disarmed=true]", "A different height must not connect");
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
  const flushShape = buildTestShape(Array.from({ length: MAP_SIZE }, (_, x) => ({
    x, y: 0, z: 0, cell: { id: 1, isCustom: false },
  })));
  const flushOptions = {
    selectedBlocks: { 1: "stone" }, selectedBlocksCustom: {}, customColors: [], fillerAssignments: [],
    applySupportFloorYs: false, forceXZ128: false, forceZ129: false,
    baseName: "water-flush", buildMode: BuildMode.StaircaseClassic,
    suppressStepDirection: SuppressStepDirection.EastToWest,
  };
  const unsloped = await convertToNbt(flushShape, flushOptions);
  for (const run of [1, 7, 127]) {
    const zeroRise = await convertToNbt(flushShape, { ...flushOptions, westEastSlope: { run, rise: 0 } });
    assertBytesEqual(gunzipSync(zeroRise.data), gunzipSync(unsloped.data), `Zero-rise run=${run} leaves NBT unchanged`);
  }
  for (const rise of [-1, 1]) {
    const flush = await convertToNbt(flushShape, { ...flushOptions, westEastSlope: { run: 7, rise } });
    const blocks = parseStructureBlocks(new Uint8Array(gunzipSync(flush.data)));
    for (let x = 0; x < MAP_SIZE; ++x) {
      const expected = Math.floor(x / 7) * rise + (rise < 0 ? Math.floor((MAP_SIZE - 1) / 7) : 0);
      assert.equal(blocks.find(block => block.x === x)?.y, expected, `Water-flush run at x=${x}, rise=${rise}`);
    }
  }
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

  const singleColumnResult = await convertToNbt(slopedShape, {
    selectedBlocks: { 1: "stone" },
    selectedBlocksCustom: {},
    customColors: [],
    fillerAssignments: [],
    applySupportFloorYs: false,
    collapseDuplicatePaletteStates: true,
    forceXZ128: false,
    forceZ129: false,
    baseName: "west-east-single-column-slope-test",
    buildMode: BuildMode.StaircaseClassic,
    suppressStepDirection: SuppressStepDirection.EastToWest,
    westEastSlope: { run: 1, rise: 2 },
    markSuppressLoadSpotsInSchematic: false,
    suppressLoadSpotMarkerBlock: "jigsaw",
  });
  if (singleColumnResult.isZip) throw new Error("Expected single NBT export in W-E single-column slope invariant test");
  const singleColumnStoneBlocks = parseStructureBlocks(new Uint8Array(gunzipSync(singleColumnResult.data)))
    .filter(block => block.blockName === "minecraft:stone");
  for (const x of [0, 1, 2, 3]) {
    const actualY = singleColumnStoneBlocks.find(block => block.x === x)?.y;
    if (actualY !== x * 2) {
      throw new Error(`Expected W-E run=1 slope stone at x=${x} to export y=${x * 2}, got ${actualY}`);
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

async function assertMixedStepSupportInvariants(): Promise<void> {
  const selections = { selectedBlocks: { 2: "scaffolding", 11: "stone" }, selectedBlocksCustom: {}, customColors: [] };
  const settings = (block: string, jumpable = true, support = "resin_block", mode = SupportMode.Fragile) =>
    getMixedStepSettings([], { ...selections, selectedBlocks: { ...selections.selectedBlocks, 2: block } },
      mode, "scaffolding", support, true, 1, jumpable);
  for (const [block, reachable, sturdy] of [
    ["scaffolding", true, true], ["scaffolding[waterlogged=true]", false, true],
    ["stone_pressure_plate", true, false], ["candle", true, false],
    ["sea_pickle[waterlogged=false]", true, false], ["sea_pickle[waterlogged=true]", false, false],
    ["snow[layers=3]", true, false], ["snow[layers=4]", false, false],
    ["oak_trapdoor[half=bottom]", true, false], ["oak_trapdoor[half=top]", false, true],
    ["oak_trapdoor[open=true]", false, false], ["resin_clump[down=true]", true, false], ["resin_clump", true, false],
    ["resin_clump[north=true]", false, false], ["amethyst_cluster[facing=up]", true, false],
    ["amethyst_cluster[facing=north]", false, false], ["honey_block", false, false],
  ] as const) {
    const palette = settings(block).palette;
    if (!palette || palette.canRaise[2] !== reachable || palette.canSupport[2] !== sturdy) {
      throw new Error(`Unexpected mixed-step collision/support eligibility: ${block}`);
    }
  }
  const { palette } = settings("scaffolding");
  if (!palette?.needsSupport[2] || !palette.shadeNeedsSupport || !palette.shadeCanSupport) {
    throw new Error("Scaffolding must both require support and provide a sturdy top");
  }
  if (!settings("scaffolding", false).palette?.canRaise[2]
    || settings("scaffolding", true, "scaffolding").maxHeight !== 1
    || settings("scaffolding", false, "resin_block", SupportMode.None).maxHeight !== 0) {
    throw new Error("Scaffolding must not bypass fragile-support requirements");
  }
  const cobble = getMixedStepSettings([], { ...selections, selectedBlocks: { ...selections.selectedBlocks, 11: "cobblestone" } },
    SupportMode.Fragile, "scaffolding", "resin_block", true, 1, true).palette;
  const scoped = (palette: typeof cobble, colorId: number) => scopeMixedStepPalette(palette, [colorId * 2])!.key;
  if (scoped(settings("scaffolding").palette, 2) !== scoped(cobble, 2) || scoped(settings("scaffolding").palette, 11) === scoped(cobble, 11)) {
    throw new Error("A tile's step palette key must change only with the colors it uses");
  }
  const north = { id: 2, isCustom: false, shade: Shade.Light };
  const south = { id: 11, isCustom: false, shade: Shade.Dark };
  const resinShade = getMixedStepSettings([], selections, SupportMode.Fragile,
    "resin_clump[down=true]", "resin_block", true, 1, true).palette!;
  if (getMixedStepReuse(north, 0, south, 0, palette) !== "color-support"
    || getMixedStepReuse(north, 0, south, 0, resinShade) !== "color-support"
    || getMixedStepReuse(north, 1, south, 0, palette) !== "color"
    || getMixedStepReuse(north, 1, { ...south, shade: Shade.Flat }, 0, palette) !== "support") {
    throw new Error("Scaffolding must support all three mixed-step reuse roles");
  }
  const grid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array(MAP_SIZE).fill(TRANSPARENT_COLOR));
  grid[64][2] = north;
  grid[64][3] = south;
  grid[64][7] = south;
  for (const mixedStepPalette of [palette, settings("scaffolding", false).palette!]) for (const mode of [BuildMode.SuppressStepPairs, BuildMode.SuppressStepChecker]) {
    for (const direction of [SuppressStepDirection.EastToWest, SuppressStepDirection.WestToEast]) {
      const shape = generateShapeMap(grid, undefined, false, true, false, {
        selectedMode: mode, selectedStepDirection: direction, layerGap: 1,
        mixSteps: true, mixedStepMaxHeight: 1, mixedStepPalette,
      })[mode]!;
      const options = { ...selections, buildMode: mode, suppressStepDirection: direction,
        fillerAssignments: createFillerAssignments("resin_block", "scaffolding", "moss_block", "resin_block",
          "slime_block", "slime_block", "resin_block", SupportMode.Fragile, false, true, false),
        applySupportFloorYs: true, forceXZ128: true, forceZ129: true,
        markSuppressLoadSpotsInSchematic: false, baseName: "scaffolding",
      };
      const counts = analyzeMaterialNeeds(grid, shape, options).blockCounts;
      const maximum: Record<string, number> = {};
      let hasStack = false, hasSupport = false;
      for (const part of shape.parts) {
        const phase = await convertToNbt({ ...shape, parts: [part] }, options);
        const cells = parseStructureBlocks(new Uint8Array(gunzipSync(phase.data)));
        const at = new Map(cells.map(block => [`${block.x},${block.y},${block.z}`, block.blockName]));
        for (const block of cells) if (block.blockName === "minecraft:scaffolding") {
          const below = at.get(`${block.x},${block.y - 1},${block.z}`);
          hasStack ||= below === "minecraft:scaffolding";
          hasSupport ||= below === "minecraft:resin_block";
        }
        for (const id of ["scaffolding", "resin_block"]) {
          maximum[id] = Math.max(maximum[id] ?? 0, cells.filter(block => block.blockName === `minecraft:${id}`).length);
        }
      }
      if (!hasStack || !hasSupport) throw new Error("Expected both reused scaffolding and explicit fragile support in export");
      for (const id of ["scaffolding", "resin_block"]) {
        if (counts[id] !== maximum[id]) {
          throw new Error(`Scaffolding reuse material count mismatch: ${id}`);
        }
      }
    }
  }
  // Lifts that only the support block prevents are counted and their blocks listed; other causes are not.
  const lift = (support: string, shade: string, jumpable: boolean, block = "candle") => getMixedStepSettings([4, 6, 22],
    { ...selections, selectedBlocks: { 2: block, 3: "dandelion", 11: "stone" } }, SupportMode.Fragile, shade, support, true, 1, jumpable);
  const liftGrid: ColorGrid = Array.from({ length: MAP_SIZE }, (_, x) => Array.from({ length: MAP_SIZE }, (_, z) => (
    { id: x < 2 ? 2 : 11, isCustom: false, shade: x < 2 ? z % 3 as Shade : Shade.Flat })));
  const blocked = (support: string, shade: string, jumpable: boolean, block?: string) => {
    const { palette, unsupported } = lift(support, shade, jumpable, block);
    return unsupported && [unsupported.blocks, countUnsupportedLifts(liftGrid, palette, unsupported)];
  };
  assert.equal(blocked("dirt", "scaffolding", true), undefined);
  assert.deepEqual(blocked("resin_block", "scaffolding", true), [["dandelion"], 0], "Listed, but unused in this image");
  assert.equal(lift("oak_slab", "scaffolding", true).maxHeight, 0);
  assert.deepEqual(blocked("oak_slab", "scaffolding", true), [["scaffolding", "candle", "dandelion"], 84]);
  assert.deepEqual(lift("oak_slab", "stone", true), { maxHeight: 0 }, "An unreachable shade filler is not a support problem");
  assert.equal(lift("oak_slab", "stone", false).palette!.canRaise[2], false);
  assert.deepEqual(blocked("oak_slab", "stone", false), [["candle"], 84], "Equal placements, but a lifted candle drops with its support");
  assert.deepEqual(blocked("oak_slab", "stone", false, "short_grass"), [["short_grass"], 0], "A lift that would not pay off is not counted");
}

async function assertMixedStepSupportPairs(): Promise<void> {
  const north = { id: 50, isCustom: false, shade: Shade.Light };
  const south = { id: 11, isCustom: false, shade: Shade.Dark };
  const selections = { selectedBlocks: { 50: "decorated_pot", 11: "stone" }, selectedBlocksCustom: {}, customColors: [] };
  const settings = (block: string, shade: string, support = "resin_block", jumpable = true, colorId = 50, cover?: string) =>
    getMixedStepSettings([], { ...selections, selectedBlocks: { ...selections.selectedBlocks, [colorId]: block } },
      SupportMode.Fragile, shade, support, true, 1, jumpable, cover);
  for (const [block, shade, compatible] of [
    ["decorated_pot", "heavy_weighted_pressure_plate", true],
    ["decorated_pot", "candle", true], ["decorated_pot", "sea_pickle[waterlogged=false]", true],
    ["decorated_pot", "resin_clump[down=true]", false],
    ["decorated_pot", "dead_tube_coral_fan[waterlogged=false]", false],
    ["decorated_pot", "scaffolding", false], ["decorated_pot", "snow", false],
    ["ice", "snow", false], ["packed_ice", "snow", false],
    ["blue_ice", "snow", true], ["scaffolding", "snow", true],
    ["stone", "resin_clump[down=true]", true],
  ] as const) for (const jumpable of [false, true]) {
    const palette = settings(block, shade, "resin_block", jumpable).palette;
    if (!palette || palette.canSupport[50] !== compatible
      || (getMixedStepReuse(north, 0, south, 0, palette) === "color-support") !== compatible) {
      throw new Error(`Incorrect mixed-step support pair: ${block} below ${shade}`);
    }
  }
  const partial = settings("dead_tube_coral_fan[waterlogged=false]", "candle", "decorated_pot").palette;
  if (!partial || partial.canRaise[50] || !settings("candle", "candle", "decorated_pot").palette?.canRaise[50]
    || settings("snow", "candle", "ice").palette?.canRaise[50]
    || settings("snow", "snow", "ice").maxHeight !== 0
    || settings("amethyst_cluster[facing=north]", "candle", "resin_block", false).palette?.canRaise[50]) {
    throw new Error("Raised blocks must have compatible below-only support, including configured supports");
  }
  // Plants with a soil requirement lift onto any block that satisfies it: the support
  // filler below a lifted color, or a color block below a plant used as the shade filler.
  for (const [soil, holds] of [["muddy_mangrove_roots", true], ["dirt", true], ["resin_block", false]] as const) {
    assert.equal(settings("poppy", "candle", soil, false).palette!.canRaise[50], holds, `Lifted poppy on ${soil}`);
    assert.equal(settings(soil, "poppy", "dirt", false).palette!.canSupport[50], holds, `Poppy shade filler on ${soil}`);
    assert.equal(settings("stone", "poppy", soil, false).maxHeight, Number(holds), `Poppy shade filler over ${soil} support`);
  }
  assert.equal(getMixedStepReuse(north, 0, south, 0, settings("muddy_mangrove_roots", "poppy", "dirt", false).palette!), "color-support");
  // Only blocks that return their own item are lifted to save a break action.
  for (const [block, drops] of [["poppy", true], ["white_carpet", true], ["candle", true], ["stone_pressure_plate", true],
    ["amethyst_cluster", false], ["small_amethyst_bud", false], ["snow", false], ["oak_trapdoor", false], ["scaffolding", true],
    ["dead_tube_coral_fan[waterlogged=false]", false], ["short_grass", false], ["stone", false]] as const) {
    assert.equal(settings(block, "candle", "resin_block", false).palette!.dropsUnsupported[50], drops, `${block} drops itself`);
  }
  // Jumpable tops: plants have no collision box, so only the support and a solid growth cover matter.
  for (const [plant, soil, jumpable, cover] of [["poppy", "dirt", true], ["poppy", "resin_block", false], ["red_mushroom", "mycelium", true],
    ["short_grass", "moss_block", true], ["nether_wart", "soul_sand", true], ["sweet_berry_bush", "dirt", true],
    ["wither_rose", "dirt", true], ["wheat", "farmland", true], ["azalea", "dirt", false],
    ["oak_sapling", "dirt", true], ["oak_sapling", "dirt", true, "tripwire"], ["oak_sapling", "dirt", true, "air"],
    ["oak_sapling", "dirt", false, "glass"], ["mangrove_propagule", "mud", false, "glass"], ["bamboo_sapling", "dirt", false, "glass"],
    ["poppy", "dirt", true, "glass"]] as const) {
    assert.equal(!!settings(plant, plant, soil, true, 50, cover).palette?.canRaise[50], jumpable, `Jumpable ${plant} on ${soil}, cover ${cover}`);
  }
  assert.equal(settings("stone", "poppy", "dirt").maxHeight, 1, "A passable plant is a jumpable shade filler");
  // A solid cover keeps a palette sapling down without stopping other lifts, and never applies to
  // the shade filler, which gets no cover.
  const covered = settings("oak_sapling", "candle", "dirt", true, 50, "glass");
  assert.deepEqual([covered.maxHeight, covered.palette!.canRaise[50]], [1, false]);
  for (const shade of ["oak_sapling", "twisting_vines[age=25]"]) {
    assert.equal(settings("candle", shade, "dirt", true, 50, "glass").palette?.canRaise[50], true, `Uncovered ${shade} shade filler`);
  }
  // Hanging, wall and ceiling states, and coral that defaults to waterlogged, are never jumpable lifts;
  // other passable floor blocks are.
  const jumpable = (block: string, support: string) => {
    const result = getMixedStepSettings([100], { ...selections, selectedBlocks: { 50: block, 11: "stone" } }, SupportMode.Fragile, "candle", support, true, 1, true);
    return !!result.palette?.canRaise[50] || !!result.unsupported?.blocks.includes(block);
  };
  for (const [block, support, expected] of [["mangrove_propagule[hanging=true]", "mud", false], ["mangrove_propagule", "mud", true],
    ["oak_button", "resin_block", false], ["oak_button[face=floor]", "resin_block", true], ["lantern[hanging=true]", "resin_block", false],
    ["dead_tube_coral_fan", "resin_block", false], ["dead_tube_coral_fan[waterlogged=false]", "resin_block", true],
    ["tube_coral[waterlogged=false]", "resin_block", false], ["oak_sign", "resin_block", true], ["fire", "netherrack", false]] as const) {
    assert.equal(standsOnFloor(block), !/hanging|button$/.test(block), `Floor state ${block}`);
    assert.equal(jumpable(block, support), expected, `Jumpable ${block}`);
  }
  for (const block of ["weeping_vines", "cave_vines_plant", "spore_blossom", "oak_hanging_sign", "oak_wall_sign"]) assert(!standsOnFloor(block), block);
  const grid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array(MAP_SIZE).fill(TRANSPARENT_COLOR));
  grid[64][3] = south;
  for (const [block, shade, reused] of [
    ["decorated_pot", "heavy_weighted_pressure_plate", true],
    ["decorated_pot", "resin_clump[down=true]", false],
    ["ice", "snow", false], ["packed_ice", "snow", false],
  ] as const) for (const mode of [BuildMode.SuppressStepChecker, BuildMode.SuppressStepPairs]) {
    const colorId = block === "decorated_pot" ? 50 : 5;
    grid[64][2] = { ...north, id: colorId };
    for (const direction of [SuppressStepDirection.EastToWest, SuppressStepDirection.WestToEast]) for (const centerOut of [false, true]) {
      const shape = generateShapeMap(grid, undefined, false, true, false, {
        selectedMode: mode, selectedStepDirection: direction, suppressCenterOut: centerOut,
        layerGap: 1, mixSteps: true, mixedStepMaxHeight: 1, mixedStepPalette: settings(block, shade, "resin_block", true, colorId).palette,
      })[mode]!;
      const options = { ...selections, selectedBlocks: { ...selections.selectedBlocks, [colorId]: block },
        buildMode: mode, suppressStepDirection: direction, suppressCenterOut: centerOut,
        fillerAssignments: createFillerAssignments("resin_block", shade, "moss_block", "resin_block",
          "slime_block", "slime_block", "resin_block", SupportMode.Fragile, false, true, false),
        applySupportFloorYs: true, forceXZ128: true, forceZ129: true,
        markSuppressLoadSpotsInSchematic: false, baseName: "support-pairs",
      };
      const counts = analyzeMaterialNeeds(grid, shape, options).blockCounts;
      const maximum: Record<string, number> = {};
      let foundReuse = false;
      for (const part of shape.parts) {
        const phase = await convertToNbt({ ...shape, parts: [part] }, options);
        const cells = parseStructureBlocks(new Uint8Array(gunzipSync(phase.data)));
        const at = new Map(cells.map(cell => [`${cell.x},${cell.y},${cell.z}`, normalizeBlockId(cell.blockName)]));
        const phaseCounts: Record<string, number> = {};
        for (const cell of cells) {
          const id = normalizeBlockId(cell.blockName);
          phaseCounts[id] = (phaseCounts[id] ?? 0) + 1;
          if (id === normalizeBlockId(shade) && at.get(`${cell.x},${cell.y - 1},${cell.z}`) === block) {
            if (!reused) throw new Error(`Export contains unsupported ${shade} on ${block}`);
            foundReuse = true;
          }
        }
        for (const [id, count] of Object.entries(phaseCounts)) maximum[id] = Math.max(maximum[id] ?? 0, count);
      }
      if (reused && !foundReuse) throw new Error("Expected compatible decorated-pot support reuse in export");
      for (const [id, count] of Object.entries(maximum)) if (counts[id] !== count) {
        throw new Error(`Support pair material count mismatch: ${id}`);
      }
    }
  }
}

function assertGroundedStepReuse(): void {
  const selections = { selectedBlocks: { 1: "stone", 2: "white_carpet", 3: "dandelion" }, selectedBlocksCustom: {}, customColors: [] };
  const grounded = (mode: SupportMode, support: string) => getGroundedStepColors([2, 4, 6], selections, mode, support);
  assert.deepEqual(grounded(SupportMode.None, "stone"), [4, 6], "Without supports, fragile colors stay at their required height");
  assert.deepEqual(grounded(SupportMode.Steps, "stone"), [4, 6]);
  assert.deepEqual(grounded(SupportMode.Fragile, "stone"), [6], "A lifted block needs a compatible support");
  assert.deepEqual(grounded(SupportMode.Fragile, "dirt"), []);
  assert.deepEqual(grounded(SupportMode.Fragile, "air"), [4, 6]);
  assert.deepEqual(grounded(SupportMode.Fragile, "white_carpet"), [4, 6], "A fragile support cannot be stacked under a second lift");
  assert.deepEqual(grounded(SupportMode.All, "stone"), [6]);
  assert.deepEqual(grounded(SupportMode.All, "sand"), [2, 4, 6]);

  // Carpet (id 2) only on odd x: even lines keep their reuse.
  const grid: ColorGrid = Array.from({ length: MAP_SIZE }, (_, x) => Array.from({ length: MAP_SIZE }, (_, z) => ({
    id: x % 2 && (x * 7 + z * 5) % 3 ? 2 : 1, isCustom: false, shade: (x * 11 + z * 13) % 3 as Shade,
  })));
  for (const mode of [BuildMode.SuppressStepChecker, BuildMode.SuppressStepPairs] as const) {
    for (const direction of [SuppressStepDirection.NorthToSouth, SuppressStepDirection.SouthToNorth]) for (const suppressCenterOut of [false, true]) {
      const specs = buildSuppressStepPhases(mode, direction, suppressCenterOut);
      const generate = (mixSteps: boolean, groundedStepColors?: number[]) => generateShapeMap(grid, undefined, false, false, false, {
        layerGap: 5, selectedMode: mode, selectedStepDirection: direction, suppressCenterOut, mixSteps, groundedStepColors,
      })[mode]!;
      // Lifted carpets by phase and position, and the number of placed color blocks.
      const survey = (shape: GeneratedShape) => {
        const lifted = new Set<string>();
        let colors = 0;
        for (const part of shape.parts) for (const [key, cell] of part.cells) {
          if (Array.isArray(cell)) continue;
          ++colors;
          const [x, y, z] = parseShapeCoordKey(key);
          const height = y - Math.min(...part.supportFloorYs) - 1;
          if (cell.id === 2 && height > 0) lifted.add(`${part.suppressStepIndex}:${x}:${height}:${z}`);
        }
        return { lifted, colors };
      };
      const label = `${mode}, ${direction}, center-out=${suppressCenterOut}`;
      const separate = survey(generate(false)), reused = survey(generate(true)), shape = generate(true, [4]), kept = survey(shape);
      assert.deepEqual([...kept.lifted].filter(cell => !separate.lifted.has(cell)), [], `${label}: reuse lifts no grounded color`);
      if (mode === BuildMode.SuppressStepChecker) {
        assert([...reused.lifted].some(cell => !separate.lifted.has(cell)), `${label}: unrestricted reuse lifts carpets`);
        assert(kept.colors > separate.colors && kept.colors < reused.colors, `${label}: other lines keep their reuse`);
      }
      // Every phase still shows its own pixels with the requested shade.
      for (const part of shape.parts) {
        const floorY = Math.min(...part.supportFloorYs);
        const tops = new Map<number, { y: number; id: number }>();
        for (const [key, cell] of part.cells) {
          if (Array.isArray(cell) && !cell.some(role => role === FillerRole.ShadeNorthRow || role === FillerRole.ShadeSuppress)) continue;
          const [x, y, z] = parseShapeCoordKey(key);
          const column = x * (MAP_SIZE + 1) + z + 1;
          if (y > (tops.get(column)?.y ?? -Infinity)) tops.set(column, { y, id: Array.isArray(cell) ? -1 : cell.id });
        }
        for (let x = 0; x < MAP_SIZE; ++x) for (let z = 0; z < MAP_SIZE; ++z) {
          if (!specs[part.suppressStepIndex!].includeAt(x, z)) continue;
          const column = x * (MAP_SIZE + 1) + z + 1;
          const top = tops.get(column), northY = tops.get(column - 1)?.y ?? floorY;
          assert.equal(top && `${top.id}:${top.y > northY ? Shade.Light : top.y < northY ? Shade.Dark : Shade.Flat}`,
            `${grid[x][z].id}:${grid[x][z].shade}`, `${label}: map pixel (${x}, ${z})`);
        }
      }
    }
  }
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

// Minimum-height Party keeps every shade while using the fewest levels.
function assertPartyMinHeight(): void {
  const options = { layerGap: 0, collapseStaircaseModes: false, selectedStepDirection: SuppressStepDirection.EastToWest };
  const party = (grid: ColorGrid, partyMinHeight: boolean, buildAtWorldMinY = false) => generateShapeMap(grid, undefined, false,
    grid.some(column => column.includes(TRANSPARENT_COLOR)), false,
    { ...options, selectedMode: BuildMode.StaircaseParty, partyMinHeight, buildAtWorldMinY })[BuildMode.StaircaseParty]!;
  // Every short land-shade sequence, with the rest of the tile transparent.
  for (let sequence = 0; sequence < 81; ++sequence) {
    const tiny: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array(MAP_SIZE).fill(TRANSPARENT_COLOR));
    for (let z = 0; z < 4; ++z) tiny[0][z] = { id: 11, isCustom: false, shade: Math.floor(sequence / 3 ** z) % 3 as Shade };
    const tops = new Map<number, number>();
    for (const part of party(tiny, true).parts) for (const [coord, cell] of part.cells) {
      const [, y, z] = parseShapeCoordKey(coord);
      if (!Array.isArray(cell) || cell.includes(FillerRole.ShadeNorthRow)) tops.set(z, Math.max(tops.get(z) ?? -Infinity, y));
    }
    for (let z = 0; z < 4; ++z) {
      const north = tops.get(z - 1);
      assert.equal(north === undefined ? 1 : Math.sign(tops.get(z)! - north), tiny[0][z].shade - Shade.Flat, `Party shade ${sequence}:${z}`);
    }
    for (const minHeight of [false, true]) {
      assert.equal(party(tiny, minHeight, true), party(tiny, minHeight), "World-min-Y has no effect on Party geometry or cache identity");
    }
  }
  // Repeated low/high runs need exactly five levels.
  const waves: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, (_, z) => ({
    id: 11, isCustom: false, shade: z % 8 < 4 ? Shade.Light : Shade.Dark,
  })));
  const height = (shape: GeneratedShape) => shape.parts[0].bounds.maxY - shape.parts[0].bounds.minY;
  assert.equal(height(party(waves, true)), 4);
  assert(generateShapeMap(waves, undefined, false, false, false, { ...options, collapseStaircaseModes: true, partyMinHeight: true })[BuildMode.StaircaseParty],
    "Compact Party must remain selectable even when identical to another mode");
  const wide = party(waves, false);
  assert(height(wide) > 4);
  assert.equal(party(waves, false), wide, "Toggling min height must not contaminate the default cache");
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

function assertBlockSupportPairs(): void {
  const latest = MINECRAFT_VERSIONS["26.4"].dataVersion;
  // Minecraft support rules distinguish full faces, center posts, rigid rims,
  // collision faces and non-air/solid bases. These are deliberately not equivalent.
  const pairs: [string, string, boolean][] = [
    ["decorated_pot", "stone_pressure_plate", true], ["decorated_pot", "candle", true],
    ["decorated_pot", "dead_tube_coral_fan[waterlogged=false]", false],
    ["hopper", "stone_pressure_plate", true], ["hopper", "candle", false],
    ["hopper", "sea_pickle[waterlogged=false]", true], ["hopper", "rail", true],
    ["glass_pane", "candle", true], ["glass_pane", "rail", false],
    ["oak_leaves", "sea_pickle[waterlogged=false]", true], ["oak_leaves", "candle", false],
    ["oak_leaves", "resin_clump[down=true]", true], ["oak_leaves", "snow", true],
    ["mud", "snow", true], ["soul_sand", "snow", true],
    ["scaffolding", "dead_tube_coral_fan[waterlogged=false]", true], ["scaffolding", "cake", false],
    ["oak_slab", "sea_pickle[waterlogged=false]", false], ["oak_stairs", "sea_pickle[waterlogged=false]", true],
    ["oak_slab[type=top]", "dead_tube_coral", true], ["oak_trapdoor[half=top,open=true]", "candle", false],
    ["oak_trapdoor[half=top]", "candle", true], ["water", "white_carpet", true], ["water", "oak_sign", false],
    ["farmland", "poppy", true], ["farmland", "bamboo_sapling", false],
    ["red_sand", "dead_bush", true], ["blue_terracotta", "dead_bush", true],
    ["sand", "short_dry_grass", true], ["sand", "poppy", false], ["clay", "azalea", true],
    ["soul_sand", "nether_wart", true], ["soul_soil", "nether_wart", false],
    ["end_stone", "chorus_flower[age=5]", true], ["stone", "chorus_flower[age=5]", false],
    ["pale_moss_block", "big_dripleaf", false], ["moss_block", "big_dripleaf", true],
    ["farmland", "cactus_flower", true], ["decorated_pot", "cactus_flower", true],
    ["decorated_pot", "brown_mushroom", true], ["oak_leaves", "brown_mushroom", false],
    ["mangrove_roots[waterlogged=true]", "lily_pad", true], ["mangrove_roots", "lily_pad", false],
  ];
  for (const [base, block, valid] of pairs) assert.equal(canSupportBlock(base, block, latest), valid, `${block} on ${base}`);
  for (const block of ["sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel", "anvil", "chipped_anvil",
    "damaged_anvil", "dragon_egg", "red_concrete_powder", "blue_concrete_powder"]) {
    assert(isFragileBlock(block));
    assert(!canSupportBlock("air", block));
    assert(!canSupportBlock("snow[layers=8]", block));
    assert(canSupportBlock("oak_sign", block));
  }
  for (const crop of ["wheat", "carrots", "potatoes", "beetroots", "torchflower_crop"]) {
    assert(isFragileBlock(`minecraft:${crop}[age=3]`));
    assert(!canSupportBlock("stone", crop));
    assert(!canSupportBlock("air", crop));
    assert(canSupportBlock("farmland", crop));
  }
  for (const block of ["copper_lantern", "exposed_copper_lantern", "weathered_copper_lantern", "white_banner", "candle_cake", "red_candle_cake"]) {
    assert(isFragileBlock(block));
    assert(!canSupportBlock("air", block));
    assert(canSupportBlock("stone", block));
  }
  assert(canSupportBlock("mud", "snow", 4189));
  assert(canSupportBlock("mud", "snow", latest));
  for (const base of ["bamboo", "bamboo_sapling"]) assert(canSupportBlock(base, "oak_sign"));
}


function assertFragileSupportEligibility(): void {
  for (const block of ["air", "none", "", "minecraft:air"]) assert(shouldAssumeSupportFloor(true, BuildMode.Flat, SupportMode.All, block));
  assert(shouldAssumeSupportFloor(true, BuildMode.Flat, SupportMode.None, "sand"));
  assert(shouldAssumeSupportFloor(true, BuildMode.SuppressStepChecker, SupportMode.Fragile, "sand"));
  assert(!shouldAssumeSupportFloor(true, BuildMode.Flat, SupportMode.Fragile, "stone"));
  assert(!shouldAssumeSupportFloor(false, BuildMode.Flat, SupportMode.None, "air"));
  const grid: ColorGrid = Array.from({ length: 128 }, () => Array.from({ length: 128 }, () => ({ id: 1, isCustom: false, shade: Shade.Flat })));
  const hasFragileSupport = (shape: GeneratedShape, selections: ColorBlockSelections, fillers: Map<FillerRole, string>, assumeFloor: boolean) => {
    const { supportNeeds } = analyzeMaterialNeeds(grid, shape, { ...selections,
      fillerAssignments: Array.from(fillers, ([role, block]) => ({ role, block })), applySupportFloorYs: assumeFloor });
    return supportNeeds.aboveFloor > 0 || (!assumeFloor && supportNeeds.atFloor > 0);
  };
  const reused: GeneratedShape = { partType: ShapePartType.SingleColumn, splitExportNames: null,
    suppressedTransparentVsCollisionCount: 0, parts: [{ cells: new Map([
      [toShapeCoordKey(0, 1, 0), { id: 11, isCustom: false, fillerRole: FillerRole.SupportRetained }],
      [toShapeCoordKey(1, 1, 0), { id: 11, isCustom: false, fillerRole: FillerRole.ShadeSuppress }],
      [toShapeCoordKey(2, 1, 0), { id: 11, isCustom: false }],
      [toShapeCoordKey(3, 1, 0), [FillerRole.ShadeSuppress]],
    ]), bounds: { minY: 0, maxY: 1, minZ: 0, maxZ: 0 }, supportFloorYs: new Set([0]) }] };
  assert.deepEqual(analyzeFillerNeeds(reused).roleCounts,
    new Map([[FillerRole.SupportRetained, 1], [FillerRole.ShadeSuppress, 2]]),
    "Dependency counts must include filler assignments reused as color blocks");
  const selections = { selectedBlocks: { 1: "stone_pressure_plate", 11: "stone" }, selectedBlocksCustom: {}, customColors: [] };
  const assignments = createFillerAssignments("scaffolding", "resin_clump[down=true]", "moss_block", "resin_block", "resin_block",
    "slime_block", "resin_block", SupportMode.Fragile, false, false, false);
  const fillers = buildFillerAssignmentMap(assignments);
  const make = (height: number): GeneratedShape => ({ partType: ShapePartType.SuppressStepPhases, splitExportNames: null,
    suppressedTransparentVsCollisionCount: 0, parts: [{ bounds: { minY: 0, maxY: 3, minZ: 0, maxZ: 127 }, supportFloorYs: new Set([0]),
      cells: new Map([[toShapeCoordKey(0, height + 1, 0), [FillerRole.ShadeSuppress]],
        [toShapeCoordKey(0, height, 0), [FillerRole.SupportFragile]]]) }] });
  assert(!hasFragileSupport(make(0), selections, fillers, true), "The assumed floor supports shade fillers");
  assert(hasFragileSupport(make(0), selections, fillers, false), "Without a floor the same filler needs support");
  const raised = make(1);
  assert(hasFragileSupport(raised, selections, fillers, true), "Raised shade fillers need support");
  const air = new Map(fillers); air.set(FillerRole.SupportFragile, "air");
  assert(hasFragileSupport(raised, selections, air, true), "Air cannot hide an unmet requirement");
  const noSupport = new Map(fillers); noSupport.delete(FillerRole.SupportFragile);
  assert(hasFragileSupport(raised, selections, noSupport, true), "None cannot hide an unmet requirement");
  const disabledShade = new Map(fillers); disabledShade.set(FillerRole.ShadeSuppress, "air");
  assert(!hasFragileSupport(raised, selections, disabledShade, true), "Disabled fillers need no support");
  const phases = make(0); phases.parts.push(raised.parts[0]);
  assert(hasFragileSupport(phases, selections, fillers, true), "A need in any phase keeps Fragile available");
  const analysisOptions = { ...selections, fillerAssignments: assignments, applySupportFloorYs: true };
  const repeated = { ...raised, parts: [raised.parts[0], raised.parts[0]] };
  assert.equal(analyzeMaterialNeeds(grid, repeated, analysisOptions).supportNeeds.aboveFloor, 1,
    "Support demand uses the phase maximum, not the sum");
  assert.equal(analyzeMaterialNeeds(grid, { ...repeated, partType: ShapePartType.SingleColumn }, analysisOptions).supportNeeds.aboveFloor, 2);
  const soil = make(1);
  soil.parts[0].cells.set(toShapeCoordKey(0, 2, 0), { id: 1, isCustom: false });
  const soilOptions = { ...analysisOptions, selectedBlocks: { 1: "poppy" } };
  for (const block of ["stone", "dirt"]) {
    const fillerAssignments = [{ role: FillerRole.SupportFragile, block }];
    assert.deepEqual(analyzeMaterialNeeds(grid, soil, { ...soilOptions, fillerAssignments }).supportNeeds.constrainedBlocks,
      new Set(["poppy"]), "Even a currently valid placement constrains the next support choice");
  }
  assert.equal(analyzeMaterialNeeds(grid, soil, { ...soilOptions, phaseRange: [1, 1] }).supportNeeds.constrainedBlocks.size, 0);
  raised.parts[0].cells.set(toShapeCoordKey(0, 1, 0), { id: 11, isCustom: false });
  assert(!hasFragileSupport(raised, selections, fillers, true), "A reused color block replaces the optional support");
  raised.parts[0].cells.set(toShapeCoordKey(0, 1, 0), [FillerRole.ShadeNorthRow]);
  const solidShade = new Map(fillers); solidShade.set(FillerRole.ShadeNorthRow, "stone");
  assert(!hasFragileSupport(raised, selections, solidShade, true), "A valid shade block is not an extra support placement");
  raised.parts[0].cells.set(toShapeCoordKey(0, 1, 0), [FillerRole.SupportRetained]);
  assert(hasFragileSupport(raised, selections, fillers, true), "Retained supports require the support assignment");
  raised.parts[0].cells.set(toShapeCoordKey(0, 1, 0), { id: 11, isCustom: false, fillerRole: FillerRole.SupportRetained });
  assert(hasFragileSupport(raised, selections, fillers, true), "Support reused as color still requires its assignment");

  for (const mode of [BuildMode.StaircaseNorthline, BuildMode.SuppressStepPairs, BuildMode.SuppressStepChecker]) {
    for (const direction of Object.values(SuppressStepDirection)) {
      const shape = generateShapeMap(grid, Shade.Flat, false, false, false, { selectedMode: mode,
        selectedStepDirection: direction, layerGap: 5, mixSteps: true })[mode]!;
      assert(shape);
      assert(!hasFragileSupport(shape, selections, fillers, true), `${mode}/${direction}: all blocks rest on the floor`);
      assert(hasFragileSupport(shape, selections, fillers, false), `${mode}/${direction}: removing the floor exposes support needs`);
      const full = analyzeMaterialNeeds(grid, shape, analysisOptions);
      const retained = analyzeMaterialNeeds(grid, shape, { ...analysisOptions, keepSuppressExtras: true });
      assert.deepEqual(retained.supportNeeds, full.supportNeeds, "Recycling changes inventory, not required support placements");
    }
  }
}


async function assertEnvironmentalSupport(): Promise<void> {
  // Fresh shape objects: these checks edit cells in place, and results are cached per shape.
  const getEnvironmentalWarnings = (shapes: GeneratedShape[], ...settings: [ColorBlockSelections, FillerAssignment[], boolean]) => {
    const kinds = getPlacementWarnings(shapes.map(shape => ({ ...shape })), ...settings, BuildMode.StaircaseGroup).map(w => w.kind);
    return { growth: kinds.includes("growthCover") || kinds.includes("missingCover"),
      missingCover: kinds.includes("missingCover"), dryCoral: kinds.includes("coralSupport") };
  };
  const coral: GeneratedShape = { partType: ShapePartType.SingleColumn, splitExportNames: null,
    suppressedTransparentVsCollisionCount: 0, parts: [{ cells: new Map([
      [toShapeCoordKey(0, 1, 0), { id: 25, isCustom: false }],
      [toShapeCoordKey(0, 0, 0), [FillerRole.CoralSupport]],
    ]), bounds: { minY: 0, maxY: 1, minZ: 0, maxZ: 0 }, supportFloorYs: new Set([0]) }] };
  const coralSelections = { selectedBlocks: { 25: "tube_coral_block", 10: "mangrove_roots[waterlogged=true]" }, selectedBlocksCustom: {}, customColors: [] };
  const wetSupport = [{ role: FillerRole.CoralSupport, block: "mangrove_roots[waterlogged=true]" }];
  assert(getEnvironmentalWarnings([coral], coralSelections, wetSupport, true).dryCoral, "Omitted platform fillers require a reminder");
  assert.deepEqual(getPlacementWarnings([coral], coralSelections, wetSupport, true, BuildMode.Flat).map(w => w.kind), ["coralSupport"]);
  assert(!getEnvironmentalWarnings([coral], coralSelections, wetSupport, false).dryCoral, "Generated waterlogged support needs no reminder");
  const coralGrid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => TRANSPARENT_COLOR));
  for (const block of ["", "air", "mangrove_roots", DEFAULT_CORAL_SUPPORT_BLOCK, "oak_slab[type=top,waterlogged=true]"]) {
    for (const autoPickSupports of [false, true]) {
      const assignments = [{ role: FillerRole.CoralSupport, block }];
      const selections = { ...coralSelections, autoPickSupports };
      const expected = autoPickSupports && !isCoralSupportValid(block) ? DEFAULT_CORAL_SUPPORT_BLOCK : block;
      const placed = expected && expected !== "air";
      const resolved = resolveShapeBlockName(coral.parts[0], toShapeCoordKey(0, 0, 0), selections, buildFillerAssignmentMap(assignments), false);
      assert.equal(resolved, placed ? `minecraft:${expected}` : "");
      assert.equal(getEnvironmentalWarnings([coral], selections, assignments, false).dryCoral, !isCoralSupportValid(expected));
      assert(getEnvironmentalWarnings([coral], selections, assignments, true).dryCoral, "Auto-pick must not replace assumed platforms");
      const options = { ...selections, fillerAssignments: assignments, applySupportFloorYs: false };
      const counts = analyzeMaterialNeeds(coralGrid, coral, options).blockCounts;
      assert.equal(counts.mangrove_roots ?? 0, expected.startsWith("mangrove_roots") ? 1 : 0);
      const file = await convertToNbt(coral, { ...options, baseName: "coral",
        buildMode: BuildMode.Flat, suppressStepDirection: SuppressStepDirection.EastToWest });
      const blocks = parseStructureBlocks(new Uint8Array(gunzipSync(file.data)));
      assert.equal(blocks.some(cell => normalizeBlockId(cell.blockName) === "mangrove_roots"), expected.startsWith("mangrove_roots"));
    }
  }
  coral.parts[0].cells.set(toShapeCoordKey(0, 0, 0), { id: 10, isCustom: false });
  assert(!getEnvironmentalWarnings([coral], coralSelections, wetSupport, true).dryCoral, "An actual waterlogged color block is not an omitted platform");
  coral.parts[0].cells.set(toShapeCoordKey(0, 0, 0), [FillerRole.SupportFragile]);
  assert(getEnvironmentalWarnings([coral], coralSelections, [{ ...wetSupport[0], role: FillerRole.SupportFragile }], false).dryCoral,
    "Optional supports omitted beneath non-fragile coral blocks cannot hydrate them");
  coral.parts[0].cells.clear();
  coral.parts[0].cells.set(toShapeCoordKey(0, 1, 0), { id: 7, isCustom: false });
  coral.parts[0].cells.set(toShapeCoordKey(0, 2, 0), [FillerRole.SupportFragile]);
  assert(getEnvironmentalWarnings([coral], { ...coralSelections, selectedBlocks: { 7: "oak_sapling" } },
    [{ role: FillerRole.SupportFragile, block: "glass" }], false).missingCover, "Unexported optional fillers cannot prevent growth");
  const environmentalSelections = { selectedBlocks: { 7: "oak_sapling", 13: "bamboo_sapling", 25: "tube_coral_fan[waterlogged=false]" },
    selectedBlocksCustom: {}, customColors: [], minecraftVersion: "26.2" as const };
  const environmentalPalette = getEnvironmentalSettings([14, 26, 50], environmentalSelections).palette!;
  assert.equal(environmentalPalette.minimumLayerGap, 3);
  for (const support of Object.values(SupportMode)) {
    const spacing = getTwoLayerSpacing(support, 2, 63, false, environmentalPalette.minimumLayerGap);
    assert.equal(spacing.layerGap, 3);
    assert.equal(spacing.latePairsGap, 61);
  }
  assert.equal(environmentalPalette.roles[14], FillerRole.GrowthCover);
  assert.equal(environmentalPalette.roles[26], FillerRole.GrowthCover);
  assert.equal(environmentalPalette.roles[50], FillerRole.CoralSupport);
  assert.deepEqual(getEnvironmentalSettings([22], { ...environmentalSelections, selectedBlocks: { 11: "stone" } }), { growthCover: undefined, palette: undefined });
  for (const block of ["azalea", "flowering_azalea", "crimson_fungus", "warped_fungus", "torchflower",
    "sweet_berry_bush[age=3]", "wheat[age=7]", "chorus_flower[age=5]", "potted_oak_sapling", "potted_poplar_sapling"]) {
    const selections = { ...environmentalSelections, selectedBlocks: { 7: block, 13: "bamboo_sapling" } };
    for (const cover of ["tripwire", "air", ""]) {
      assert.deepEqual(getEnvironmentalSettings([14], selections, isGrowthCoverEnabled(cover)), { growthCover: undefined, palette: undefined },
        `${block}: no cover geometry or input eligibility, even with an unused sapling selected`);
      assert.deepEqual(getEnvironmentalSettings([14, 26], selections, isGrowthCoverEnabled(cover)).palette?.roles,
        cover === "tripwire" ? { 26: FillerRole.GrowthCover } : undefined,
        `${block}: a neighboring growing plant must not add covers to stable plants`);
    }
    assert.deepEqual(getEnvironmentalWarnings([coral], selections, [], false),
      { growth: false, missingCover: false, dryCoral: false }, `${block}: no growth warning`);
  }
  const vineSelections = { ...environmentalSelections, selectedBlocks: { 7: "oak_sapling", 23: "twisting_vines[age=25]" } };
  coral.parts[0].cells.clear();
  coral.parts[0].cells.set(toShapeCoordKey(0, 1, 0), { id: 23, isCustom: false });
  assert(!getEnvironmentalWarnings([coral], vineSelections, [], false).missingCover, "Vine covers are optional");
  coral.parts[0].cells.set(toShapeCoordKey(1, 1, 0), { id: 7, isCustom: false });
  assert(getEnvironmentalWarnings([coral], vineSelections, [], false).missingCover, "Saplings still require covers alongside vines");
  assert.equal(getEnvironmentalSettings([46], vineSelections).palette?.roles[46], FillerRole.GrowthCover, "Vines default to covers");
  for (const cover of ["", "  ", "air", "minecraft:air", "none", "n/a", "na"]) {
    assert.deepEqual(getEnvironmentalSettings([46], vineSelections, isGrowthCoverEnabled(cover)), { growthCover: "optional", palette: undefined });
    assert.deepEqual(getEnvironmentalSettings([14, 46], vineSelections, isGrowthCoverEnabled(cover)), { growthCover: "required", palette: undefined });
  }
  assert.deepEqual(getEnvironmentalSettings([14, 46], vineSelections, true).palette?.roles,
    { 14: FillerRole.GrowthCover, 46: FillerRole.GrowthCover });
  assert.equal(getEnvironmentalSettings([46, 14], vineSelections, false).growthCover, "required", "Plant order must not change cover requirements");
  assert.deepEqual(getEnvironmentalSettings([14, 26, 50], environmentalSelections, false).palette?.roles,
    { 50: FillerRole.CoralSupport }, "Disabling growth covers preserves coral supports");
  for (const cover of ["tripwire", "glass"]) assert(isGrowthCoverEnabled(cover));
  for (const mode of Object.values(SupportMode)) {
    const fillers = createFillerAssignments("oak_slab[type=top,waterlogged=true]", "stone", "stone", "stone", "stone", "stone", "stone", mode, false, false, false, "glass");
    assert.equal(fillers.find(f => f.role === FillerRole.GrowthCover)?.block, "glass");
    assert.equal(fillers.find(f => f.role === FillerRole.CoralSupport)?.block,
      mode === SupportMode.Fragile || mode === SupportMode.All ? "oak_slab[type=top,waterlogged=true]" : undefined);
  }
  assert(isGrowthCoverValid("tripwire"));
  assert(isGrowthCoverValid("glass"));
  for (const invalid of ["air", "oak_leaves", "torch", "cake", "glass[waterlogged = true]"]) assert(!isGrowthCoverValid(invalid));
  for (const valid of ["mangrove_roots[waterlogged=true]", "oak_slab[type=top,waterlogged=true]"]) assert(isCoralSupportValid(valid));
  for (const invalid of ["mangrove_roots", "oak_leaves[waterlogged=true]", "oak_slab[waterlogged=true]", "oak_slab[type=double,waterlogged=true]", "oak_fence[waterlogged=true]"]) assert(!isCoralSupportValid(invalid));
  const environmentGrid: ColorGrid = Array.from({ length: MAP_SIZE }, (_, x) => Array.from({ length: MAP_SIZE }, (_, z) =>
    ({ id: [7, 13, 25][(x + z) % 3], shade: Shade.Flat, isCustom: false })));
  const environmentalAssignments = createFillerAssignments("mangrove_roots[waterlogged=true]", "resin_block", "moss_block", "resin_block",
    "resin_block", "slime_block", "resin_block", SupportMode.Fragile, false, false, false);
  for (const mode of [BuildMode.StaircaseNorthline, BuildMode.StaircaseGroup, BuildMode.Suppress2Layer,
    BuildMode.SuppressStepPairs, BuildMode.SuppressStepChecker]) {
    const steps = mode === BuildMode.SuppressStepPairs || mode === BuildMode.SuppressStepChecker;
    const directions = mode === BuildMode.StaircaseNorthline || mode === BuildMode.StaircaseGroup
      ? [SuppressStepDirection.EastToWest] : Object.values(SuppressStepDirection);
    for (const direction of directions) for (const centerOut of steps ? [false, true] : [false]) {
      const options = { layerGap: 5, selectedMode: mode, selectedStepDirection: direction, suppressCenterOut: centerOut,
        mixSteps: true, collapseStaircaseModes: false };
      const plain = generateShapeMap(environmentGrid, Shade.Flat, false, false, false, options)[mode]!;
      const shape = generateShapeMap(environmentGrid, Shade.Flat, false, false, false, { ...options, environmentalPalette })[mode]!;
      assert(shape);
      assert.equal(generateShapeMap(environmentGrid, Shade.Flat, false, false, false, options)[mode], plain, "Environmental additions must not mutate cached ordinary shapes");
      let covers = 0;
      let coralSupports = 0;
      for (const [index, part] of shape.parts.entries()) {
        const floor = Math.min(...part.supportFloorYs) + 1;
        const oldPart = plain.parts[index];
        const oldFloor = Math.min(...oldPart.supportFloorYs) + 1;
        for (const [coord, cell] of part.cells) {
          if (Array.isArray(cell)) continue;
          const [x, y, z] = parseShapeCoordKey(coord);
          assert.deepEqual(oldPart.cells.get(toShapeCoordKey(x, y - floor + oldFloor, z)), cell, "Color geometry must remain unchanged relative to the platform");
          if (cell.fillerRole) continue;
          const role = environmentalPalette.roles[cell.id * 2];
          const neighbor = part.cells.get(toShapeCoordKey(x, y + (role === FillerRole.GrowthCover ? 1 : -1), z));
          assert(Array.isArray(neighbor) && neighbor.includes(role), `${mode}/${direction}: missing environmental block`);
          if (role === FillerRole.GrowthCover) ++covers;
          else ++coralSupports;
        }
        if (index > 0 && shape.partType === ShapePartType.SuppressStepPhases) {
          assert(part.bounds.minY > shape.parts[index - 1].bounds.maxY, "Covers must not overlap the next exported phase");
        }
      }
      assert(covers > 0 && coralSupports > 0);
      const analysisOptions = { ...environmentalSelections, fillerAssignments: environmentalAssignments, applySupportFloorYs: true };
      const warnings = getEnvironmentalWarnings([shape], environmentalSelections, environmentalAssignments, true);
      assert(warnings.growth && !warnings.missingCover && warnings.dryCoral);
      assert(!getEnvironmentalWarnings([shape], environmentalSelections, environmentalAssignments, false).dryCoral);
      const counts = analyzeMaterialNeeds(environmentGrid, shape, analysisOptions);
      assert(counts.blockCounts.tripwire > 0, "Growth covers must count toward materials");
      const withFloor = analyzeMaterialNeeds(environmentGrid, shape, { ...analysisOptions, applySupportFloorYs: false });
      assert(withFloor.blockCounts.mangrove_roots > 0, "Waterlogged supports must count toward materials");
      if (mode === BuildMode.StaircaseNorthline && direction === SuppressStepDirection.EastToWest && !centerOut) {
        for (const applySupportFloorYs of [true, false]) {
          const result = await convertToNbt(shape, { ...analysisOptions, applySupportFloorYs, buildMode: mode,
            baseName: "environment", suppressStepDirection: direction });
          const exported = parseStructureBlocks(new Uint8Array(gunzipSync(result.data)));
          assert.equal(exported.filter(block => normalizeBlockId(block.blockName) === "tripwire").length, covers);
          const roots = exported.filter(block => normalizeBlockId(block.blockName) === "mangrove_roots");
          assert.equal(roots.length, (applySupportFloorYs ? counts : withFloor).blockCounts.mangrove_roots ?? 0, "Never replace assumed platforms");
          assert(roots.every(block => block.blockName.includes("waterlogged=true")));
        }
      }
    }
  }
  const shadedGrid: ColorGrid = environmentGrid.map((column, x) => column.map((pixel, z) => ({ ...pixel, shade: (x + z) % 3 })));
  for (const mode of [BuildMode.Suppress2Layer, BuildMode.Suppress2LayerLateFillers, BuildMode.Suppress2LayerLatePairs]) {
    for (const direction of Object.values(SuppressStepDirection)) {
      const shape = generateShapeMap(shadedGrid, undefined, false, false, mode !== BuildMode.Suppress2Layer, {
        layerGap: 2, selectedMode: mode, selectedStepDirection: direction, environmentalPalette,
      })[mode]!;
      const warnings = getEnvironmentalWarnings([shape], environmentalSelections, environmentalAssignments, false);
      assert(!warnings.missingCover && !warnings.dryCoral, "Environmental supports must raise insufficient layer gaps");
    }
  }
}


function assertScaffoldingSupportWarnings(): void {
  const role = FillerRole.SupportAll;
  const selections = { selectedBlocks: { 7: "poppy", 11: "stone", 13: "scaffolding" }, selectedBlocksCustom: {}, customColors: [], minecraftVersion: "26.2" as const };
  const assignments = [{ role, block: "scaffolding" }, { role: FillerRole.ShadeSuppress, block: "stone" }];
  const shape: GeneratedShape = { partType: ShapePartType.SingleColumn, splitExportNames: null,
    suppressedTransparentVsCollisionCount: 0, parts: [{ cells: new Map(),
      bounds: { minY: 0, maxY: 10, minZ: 0, maxZ: 127 }, supportFloorYs: new Set([0]) }] };
  const part = shape.parts[0];
  const put = (x: number, y: number, cell: ShapeCell = [role]) => part.cells.set(toShapeCoordKey(x, y, 0), cell);
  const warn = (floor = true, blocks = assignments, palette = selections) =>
    analyzeScaffoldingSupport([shape], palette, blocks, floor).roles.has(role);
  put(0, 1);
  assert(!warn(), "Assumed floor supports scaffolding");
  assert(warn(false), "Without an assumed floor, air cannot support scaffolding");
  put(0, 2);
  assert(!warn(), "Grounded vertical scaffold stacks are valid");
  part.cells.delete(toShapeCoordKey(0, 1, 0));
  assert(warn(), "An assumed floor does not bridge a vertical air gap");
  put(0, 1, { id: 11, isCustom: false });
  assert(!warn(), "Actual sturdy color blocks support scaffolding");
  for (const block of ["glass", "soul_sand", "oak_slab[type=top]", "oak_slab[type=double]", "oak_stairs[half=top]", "oak_trapdoor[half=top]", "snow[layers=8]"]) {
    assert(!warn(true, assignments, { ...selections, selectedBlocks: { ...selections.selectedBlocks, 11: block } }), block);
  }
  for (const block of ["oak_leaves", "water", "resin_clump[down=true]", "oak_slab", "oak_stairs", "oak_trapdoor[half=top,open=true]", "snow[layers=7]"]) {
    assert(warn(true, assignments, { ...selections, selectedBlocks: { ...selections.selectedBlocks, 11: block } }), block);
  }
  assert(warn(true, assignments, { ...selections, selectedBlocks: { ...selections.selectedBlocks, 11: "honey_block" } }));
  assert(analyzeScaffoldingSupport([shape], { ...selections, minecraftVersion: undefined, selectedBlocks: { 11: "honey_block" } },
    assignments, true).roles.has(role), "Omitted version preserves the site-default honey support rule");
  assert.equal(analyzeScaffoldingSupport([shape], { ...selections, minecraftVersion: "26.4", selectedBlocks: { 11: "honey_block" } }, assignments, true).roles.size, 0);
  part.cells.clear();
  put(0, 1, { id: 11, isCustom: false });
  for (let x = 0; x <= 6; x++) put(x, 2);
  put(6, 3);
  assert(!warn(false), "Six horizontal extensions and a vertical continuation remain supported");
  put(7, 2);
  assert(warn(false), "The seventh horizontal extension falls");
  part.cells.delete(toShapeCoordKey(7, 2, 0));
  part.cells.delete(toShapeCoordKey(0, 1, 0));
  assert(warn(false), "A disconnected scaffold cluster cannot support itself");
  part.cells.clear();
  put(0, 0);
  assert(!warn(), "Omitted floor-level filler must not produce warnings");
  part.cells.clear();
  put(0, 1, [FillerRole.SupportFragile]);
  put(0, 2, { id: 11, isCustom: false });
  assert.equal(analyzeScaffoldingSupport([shape], selections, [{ role: FillerRole.SupportFragile, block: "scaffolding" }], false).roles.size, 0,
    "Unneeded fragile support is not exported");
  part.cells.clear();
  put(0, 1);
  put(0, 2, { id: 7, isCustom: false });
  assert(warn(false), "Without consent the scaffold remains, even below a poppy");
  assert(!analyzeScaffoldingSupport([shape], { ...selections, autoPickSupports: true }, assignments, false).roles.size,
    "Opting in replaces the incompatible scaffold under a poppy");
  assert.equal(analyzeScaffoldingSupport([shape], selections, [{ role, block: "stone" }], false).roles.size, 0);
  part.cells.clear();
  put(0, 2, [FillerRole.ShadeSuppress, role]);
  assert(!warn(false, [assignments[1], assignments[0]]), "The winning non-scaffold assignment suppresses the warning");
  assert(warn(false, [{ role: FillerRole.ShadeSuppress, block: "air" }, assignments[0]]), "Disabled fillers do not hide unsupported scaffolding");
  part.cells.clear();
  put(0, 2);
  put(0, 1, { id: 13, isCustom: false });
  assert(!warn(), "Scaffolding color blocks can connect supports to the platform");
  assert(warn(false), "Floating scaffolding color blocks are not sturdy anchors");

  const grid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => ({ id: 11, shade: Shade.Flat, isCustom: false })));
  for (const mode of [BuildMode.Flat, BuildMode.StaircaseClassic, BuildMode.SuppressStepChecker, BuildMode.SuppressStepPairs]) {
    const generated = generateShapeMap(grid, Shade.Flat, false, false, false, { selectedMode: mode, layerGap: 5, mixSteps: false,
      collapseStaircaseModes: false, includeFlatNorthline: true,
      selectedStepDirection: SuppressStepDirection.EastToWest })[mode === BuildMode.Flat ? BuildMode.StaircaseNorthline : mode]!;
    assert(generated, mode);
    assert.equal(analyzeScaffoldingSupport([generated], selections, assignments, true).roles.size, 0, `${mode}: floor-level support is omitted`);
  }
}


async function assertContextualSupport(): Promise<void> {
  const variants = ["dead_tube_coral_fan[waterlogged=false]", "dead_tube_coral_fan[waterlogged=true]"];
  const single = messages.preview.placementWarning("supportBlock", variants);
  assert(single.text.includes("dead_tube_coral_fan") && !single.text.includes("["));
  const multiple = messages.preview.placementWarning("supportBlock", ["cherry_pressure_plate", ...variants]);
  assert.match(multiple.text, /^2\b/);
  for (const block of variants) assert(multiple.detail?.includes(block));
  assert.equal(messages.preview.placementWarning("cropLight", ["wheat"]).detail, undefined);
  const supportWarning = (ids: string[]) =>
    messages.preview.fragileSupportOverrideWarning(getCommonSupportChoices(ids, [], [], 4903));
  assert.deepEqual(supportWarning(["wheat"]).supports, ["farmland"]);
  // A constrained kind only counts once the palette or a filler places it.
  assert.deepEqual(getCommonSupportChoices(["wheat"], ["lily_pad"], ["stone"], 4903).supports, ["farmland"]);
  assert.deepEqual(getCommonSupportChoices(["wheat"], ["lily_pad"], ["stone", "lily_pad"], 4903).supports, []);
  const plants = ["azalea", "open_eyeblossom"];
  const shared = supportWarning(plants);
  assert.match(shared.text, /\b2\b/);
  assert.equal(shared.detail, plants.join(", "));
  assert.deepEqual(shared.supports, FRAGILE_SUPPORT_RULES.get("open_eyeblossom")!.validSupportBlocks);
  for (const choice of shared.supports) assert(plants.every(block => canSupportBlock(choice, block)));
  const conflict = supportWarning(["wheat", "lily_pad"]);
  assert.deepEqual(conflict.supports, []);
  assert.equal(conflict.listedBlocks?.summary, "2 blocks");
  assert.deepEqual(conflict.listedBlocks?.blocks, ["wheat", "lily_pad"]);
  // The fitted list replaces the text, so its parts must rebuild it exactly.
  const listed = [conflict, ...Object.keys(enCatalog.preview.placementWarnings).map(kind =>
    messages.preview.placementWarning(kind as keyof typeof enCatalog.preview.placementWarnings, ["wheat", "lily_pad"]))];
  for (const { text, listedBlocks } of listed) if (listedBlocks) {
    assert.equal(`${listedBlocks.before}[${listedBlocks.blocks.join(", ")}]${listedBlocks.after}`, text);
  }
  for (const catalog of [enCatalog, esCatalog]) for (const [kind, template] of [...Object.entries(catalog.preview.placementWarnings),
    ["fragileSupportOverrideWarningMixed", catalog.preview.fragileSupportOverrideWarningMixed]]) {
    for (const form of typeof template === "string" ? [template] : Object.values(template)) {
      assert((form.match(/\{\w+\}/g) ?? []).length <= 1, `${catalog.locale} ${kind}: only the list is a placeholder`);
    }
  }
  assert.deepEqual(supportWarning(["wheat", "oak_pressure_plate"]).supports, []);
  const selections = { selectedBlocks: { 1: "stone_pressure_plate", 12: "water" }, selectedBlocksCustom: {}, customColors: [] };
  const make = (height = 1): GeneratedShape => ({ partType: ShapePartType.SingleColumn, splitExportNames: null,
    suppressedTransparentVsCollisionCount: 0, parts: [{ bounds: { minY: -3, maxY: 8, minZ: 0, maxZ: 127 }, supportFloorYs: new Set([0]),
      cells: new Map([[toShapeCoordKey(0, height + 1, 0), { id: 1, isCustom: false } as ShapeCell],
        [toShapeCoordKey(0, height, 0), [FillerRole.SupportFragile]]]) }] });
  const warnings = (shape: GeneratedShape, support: string, assumeFloor = true) => getPlacementWarnings([shape], selections,
    [{ role: FillerRole.SupportFragile, block: support }], assumeFloor, BuildMode.SuppressStepChecker);
  for (const support of ["sand", "gravel", "white_concrete_powder", "azalea", "flowering_azalea", "snow[layers=8]", "scaffolding"]) {
    assert.deepEqual(warnings(make(), support).filter(warning => warning.kind !== "snowRisk"), [], `${support}: wildcard floor supports the support material`);
    assert(warnings(make(2), support).some(warning => warning.invalid), `${support}: support material cannot float`);
    assert(warnings(make(), support, false).some(warning => warning.invalid), `${support}: no assumed floor means no free support`);
    for (const jumpable of [false, true]) {
      const mixed = getMixedStepSettings([], selections, SupportMode.Fragile, "resin_clump[down=true]", support, true, 1, jumpable);
      assert.equal(mixed.maxHeight, 1, `${support}: lift-one supports rest on the platform`);
      assert(mixed.palette?.floorOnlySupport);
      if (mixed.palette.supportColor > 0) {
        const color = { id: mixed.palette.supportColor, shade: Shade.Light, isCustom: false };
        assert.notEqual(getMixedStepColor(color, 1, undefined, 0, mixed.palette).fillerRole, FillerRole.SupportRetained,
          "A fragile support may not substitute for a raised color without its own base");
      }
      assert.equal(getMixedStepSettings([], selections, SupportMode.Fragile, "resin_clump[down=true]", support, true, 2, jumpable).maxHeight, 0);
    }
  }
  const upper = make(5);
  upper.parts[0].supportFloorYs = new Set([0, 4]);
  assert(warnings(upper, "azalea").some(warning => warning.kind === "transparentSupport"));
  assert.deepEqual(warnings(upper, "sand"), [], "Transparent upper floors still hold gravity blocks");
  const lily = make(5);
  lily.parts[0].supportFloorYs = new Set([0, 4]);
  lily.parts[0].cells = new Map([[toShapeCoordKey(0, 5, 0), { id: 1, isCustom: false }]]);
  assert.deepEqual(getPlacementWarnings([lily], { ...selections, selectedBlocks: { 1: "lily_pad" } }, [], true,
    BuildMode.Suppress2Layer), [], "Transparent platforms can provide waterlogged lily-pad supports");
  const submerged = make();
  submerged.parts[0].cells.set(toShapeCoordKey(4, -2, 4), { id: 12, isCustom: false });
  assert(warnings(submerged, "azalea").some(warning => warning.kind === "transparentSupport" && warning.blocks.includes("azalea")));
  assert(!warnings(submerged, "sand").some(warning => warning.kind === "falling"));
  assert(getPlacementWarnings([submerged], selections, [{ role: FillerRole.SupportFragile, block: "azalea" }],
    true, BuildMode.Flat).some(warning => warning.kind === "transparentSupport"), "Flat mode cannot bypass transparent-water-floor constraints");

  const grid: ColorGrid = Array.from({ length: MAP_SIZE }, () => Array.from({ length: MAP_SIZE }, () => ({ id: 2, shade: Shade.Flat, isCustom: false })));
  const shape = generateShapeMap(grid, Shade.Flat, false, false, false, {
    selectedMode: BuildMode.Flat, layerGap: 5, selectedStepDirection: SuppressStepDirection.EastToWest,
    collapseStaircaseModes: false,
  })[BuildMode.StaircaseNorthline]!;
  for (const block of ["sand", "gravel", "red_sand", "white_concrete_powder", "anvil"]) {
    const colors = { ...selections, selectedBlocks: { 2: block } };
    const assignments = [{ role: FillerRole.SupportFragile, block: "stone" }];
    const counts = analyzeMaterialNeeds(grid, shape, { ...colors, fillerAssignments: assignments, applySupportFloorYs: false });
    assert.equal(counts.blockCounts.stone, MAP_SIZE ** 2, `${block}: Fragile supplies supports for falling colors`);
    assert.equal(analyzeMaterialNeeds(grid, shape, { ...colors, fillerAssignments: assignments, applySupportFloorYs: true }).blockCounts.stone, undefined);
    assert(getPlacementWarnings([shape], colors, [], false, BuildMode.Flat).some(warning => warning.kind === "supportMode"));
    assert.deepEqual(getPlacementWarnings([shape], colors, [], false, BuildMode.Flat, true).map(warning => warning.kind), ["supportMode"],
      `${block}: CrubTech gets the same support-mode guidance`);
    assert.deepEqual(getPlacementWarnings([shape], colors, assignments, false, BuildMode.Flat), []);
    const nbt = await convertToNbt(shape, { ...colors, fillerAssignments: assignments, applySupportFloorYs: false,
      forceXZ128: true, forceZ129: false, baseName: "support", buildMode: BuildMode.Flat, suppressStepDirection: SuppressStepDirection.EastToWest });
    const blocks = parseStructureBlocks(new Uint8Array(gunzipSync(nbt.data)));
    assert.equal(blocks.filter(entry => entry.blockName === "minecraft:stone").length, counts.blockCounts.stone);
  }
  const stepGrid: ColorGrid = Array.from({ length: MAP_SIZE }, (_, x) => Array.from({ length: MAP_SIZE }, (_, z) =>
    ({ id: (x + z) % 2 ? 1 : 11, shade: (z % 3) as Shade, isCustom: false })));
  const stepSelections = { ...selections, selectedBlocks: { 1: "stone_pressure_plate", 11: "stone" } };
  for (const support of ["sand", "azalea", "scaffolding"]) for (const reachable of [false, true]) {
    const mixed = getMixedStepSettings([2, 22], stepSelections, SupportMode.Fragile, "resin_clump[down=true]", support, true, 1, reachable);
    const assignments = createFillerAssignments(support, "resin_clump[down=true]", "moss_block", "resin_block", "resin_block",
      "slime_block", "resin_block", SupportMode.Fragile, false, false, false);
    for (const mode of [BuildMode.SuppressStepChecker, BuildMode.SuppressStepPairs]) {
      const generated = generateShapeMap(stepGrid, undefined, false, false, false, {
        selectedMode: mode, selectedStepDirection: SuppressStepDirection.EastToWest, layerGap: 5,
        mixSteps: true, mixedStepMaxHeight: mixed.maxHeight, mixedStepPalette: mixed.palette,
      })[mode]!;
      assert.deepEqual(getPlacementWarnings([generated], stepSelections, assignments, true, mode).filter(warning => warning.invalid), [],
        `${mode}/${support}/${reachable}: raised reuse leaves no unsupported blocks`);
    }
  }
}


function assertPlacementWarnings(): void {
  type Placement = [number, number, number, string];
  const check = (placements: Placement[], assumeFloor = false, mode = BuildMode.StaircaseGroup) => {
    const selectedBlocks: Record<number, string> = {};
    const cells = new Map<number, ShapeCell>();
    placements.forEach(([x, y, z, block], i) => {
      selectedBlocks[i + 1] = block;
      cells.set(toShapeCoordKey(x, y, z), { id: i + 1, isCustom: false });
    });
    const shape: GeneratedShape = { partType: ShapePartType.SingleColumn, splitExportNames: null,
      suppressedTransparentVsCollisionCount: 0,
      parts: [{ cells, bounds: { minY: Math.min(...placements.map(p => p[1])), maxY: Math.max(...placements.map(p => p[1])),
        minZ: -10, maxZ: 130 }, supportFloorYs: new Set([0]) }] };
    const selections = { selectedBlocks, selectedBlocksCustom: {}, customColors: [] };
    return { warnings: getPlacementWarnings([shape], selections, [], assumeFloor, mode), shape, selections };
  };
  const kinds = (placements: Placement[], assumeFloor = false, mode = BuildMode.StaircaseGroup) =>
    check(placements, assumeFloor, mode).warnings.map(warning => warning.kind);
  const coveredPlant = check([[0, 1, 0, "oak_sapling"], [0, 2, 0, "tripwire"]], true);
  assert.deepEqual(getPlacementWarnings([coveredPlant.shape], coveredPlant.selections, [], true, BuildMode.Suppress2Layer, true)
    .map(warning => warning.kind), ["growthCover"], "CrubTech covers need the growth reminder, not a blanket machine warning");
  assert.deepEqual(kinds([[0, 1, 0, "oak_sapling"], [1, 1, 0, "tube_coral_fan"], [2, 1, 0, "tnt"],
    [3, 1, 0, "redstone_block"]], true, BuildMode.Flat), ["coralSupport", "tntIgnition"], "Assumed floors do not remove actual ignition or hydration hazards");
  assert(kinds([[0, 1, 0, "stone_pressure_plate"]], false, BuildMode.Flat).includes("missingSupport"));
  assert(!kinds([[0, 1, 0, "stone_pressure_plate"]], true).includes("missingSupport"));
  assert(kinds([[0, 2, 0, "stone_pressure_plate"]], true).includes("missingSupport"));
  assert(kinds([[0, 2, 0, "scaffolding"]], true).includes("missingSupport"));
  assert(!kinds([[0, 1, 0, "scaffolding"], [1, 1, 0, "scaffolding"]], true).includes("missingSupport"));
  assert(kinds([[0, 1, 0, "sand"]]).includes("falling"));
  assert(!kinds([[0, 1, 0, "sand"], [0, 0, 0, "stone"]]).includes("falling"));
  assert(!kinds([[0, 1, 0, "stone_pressure_plate"], [0, 0, 0, "hopper"]]).includes("invalidSupport"));
  assert(kinds([[0, 1, 0, "candle"], [0, 0, 0, "hopper"]]).includes("invalidSupport"));
  assert(!kinds([[0, 1, 0, "sea_pickle[waterlogged=false]"], [0, 0, 0, "oak_leaves"]]).includes("invalidSupport"));
  assert(!kinds([[0, 1, 0, "resin_clump[down=true]"], [0, 0, 0, "oak_leaves"]]).includes("attachmentSupport"));
  assert(!kinds([[0, 1, 0, "snow"], [0, 0, 0, "mud"]]).includes("invalidSupport"));
  assert(kinds([[0, 1, 0, "rail"]]).includes("missingSupport"));
  for (const base of ["resin_clump[down=true]", "snow[layers=8]", "fern", "water"]) {
    assert(kinds([[0, 1, 0, "sand"], [0, 0, 0, base]]).includes("falling"), `${base}: falling blocks pass through replaceable bases`);
  }
  assert(kinds([[0, 1, 0, "oak_sapling"], [0, 0, 0, "stone"]]).includes("invalidSupport"));
  assert(!kinds([[0, 1, 0, "oak_sapling"], [0, 0, 0, "dirt"]]).includes("invalidSupport"));
  for (const mode of [BuildMode.Flat, BuildMode.StaircaseNorthline, BuildMode.SuppressStepChecker]) {
    assert.deepEqual(kinds([[0, 1, 0, "poppy"]], true, mode), [], "Assumed platforms do not imply invalid soil");
    assert.deepEqual(kinds([[0, 1, 0, "poppy"], [0, 0, 0, "dirt"]], false, mode), [], "Dirt supports poppies");
    assert(kinds([[0, 1, 0, "poppy"]], false, mode).includes("missingSupport"));
  }
  assert(kinds([[0, 2, 0, "poppy"]], true).includes("missingSupport"), "Assumed floors do not support raised floating flowers");
  const flower = check([[0, 2, 0, "poppy"]]);
  flower.shape.parts[0].cells.set(toShapeCoordKey(0, 1, 0), [FillerRole.SupportFragile]);
  for (const assumeFloor of [false, true]) {
    assert.deepEqual(getPlacementWarnings([flower.shape], flower.selections,
      [{ role: FillerRole.SupportFragile, block: "dirt" }], assumeFloor, BuildMode.StaircaseGroup), [],
    "Fragile-mode dirt support is valid, including above an assumed floor");
  }
  const wrongSupports = check([[0, 1, 0, "poppy"], [0, 0, 0, "stone"],
    [1, 1, 0, "poppy"], [1, 0, 0, "oak_slab[type=top]"]]);
  assert.deepEqual(wrongSupports.warnings.map(({ kind, blocks, support }) => ({ kind, blocks, support })), [
    { kind: "invalidSupport", blocks: ["poppy"], support: "stone" },
    { kind: "invalidSupport", blocks: ["poppy"], support: "oak_slab[type=top]" },
  ], "Each warning identifies the actual incompatible support, retaining its state");
  assert.equal(getPlacementWarnings([wrongSupports.shape, wrongSupports.shape], wrongSupports.selections,
    [], false, BuildMode.StaircaseGroup).length, 2, "Merge repeated pairs without mixing different supports");
  assert(wrongSupports.warnings.every(warning => warning.invalid), "Incompatible supports use red advisory text");
  for (const block of ["poppy", "lantern[hanging=true]", "shelf_mushroom"]) {
    assert(check([[0, 2, 0, block]]).warnings.every(warning => warning.invalid), "Missing supports use red advisory text");
  }
  assert(kinds([[0, 1, 0, "dead_tube_coral_fan"], [0, 0, 0, "decorated_pot"]]).includes("invalidSupport"));
  assert(!kinds([[0, 1, 0, "sea_pickle[waterlogged=false]"], [0, 0, 0, "decorated_pot"]]).includes("invalidSupport"));
  assert(!kinds([[0, 1, 0, "dead_tube_coral_fan"], [0, 0, 0, "oak_slab[type=top]"]]).includes("invalidSupport"));
  assert(kinds([[0, 1, 0, "dead_tube_coral_fan"], [0, 0, 0, "oak_slab[type=bottom]"]]).includes("invalidSupport"));
  assert(kinds([[0, 1, 0, "lantern[hanging=true]"]]).includes("attachmentSupport"));
  assert(!kinds([[0, 1, 0, "lantern[hanging=true]"], [0, 2, 0, "stone"]]).includes("attachmentSupport"));
  assert(kinds([[0, 1, 0, "amethyst_cluster[facing=north]"]]).includes("attachmentSupport"));
  assert(!kinds([[0, 1, 0, "amethyst_cluster[facing=north]"], [0, 1, 1, "stone"]]).includes("attachmentSupport"));
  assert(!kinds([[0, 1, 0, "resin_clump[down=true]"], [0, 0, 0, "stone"]]).includes("attachmentSupport"));
  assert(kinds([[0, 1, 0, "resin_clump[down=true,east=true]"], [0, 0, 0, "stone"]]).includes("attachmentSupport"));
  const sideClump = check([[0, 1, 0, "resin_clump[east=true]"], [0, 0, 0, "stone"]]).warnings.find(w => w.kind === "attachmentSupport");
  assert.deepEqual(sideClump?.blocks, ["resin_clump"]);
  assert.equal(messages.preview.placementWarning("attachmentSupport", sideClump.blocks).text, "resin_clump requires support from selected sides");
  const shadeShape = check([[0, 1, 0, "stone"]]);
  const shadePart = { ...shadeShape.shape.parts[0], cells: new Map(shadeShape.shape.parts[0].cells) };
  shadePart.cells.set(toShapeCoordKey(1, 1, 0), [FillerRole.ShadeSuppress]);
  assert.deepEqual(getPlacementWarnings([{ ...shadeShape.shape, parts: [shadePart] }], shadeShape.selections, [{ role: FillerRole.ShadeSuppress, block: "resin_clump[north=true]" }],
    true, BuildMode.StaircaseGroup).find(w => w.kind === "attachmentSupport")?.blocks, ["resin_clump"], "Side-attached fillers warn in the preview");
  for (const id of ["resin_clump", "glow_lichen", "sculk_vein"]) {
    const block = `${id}[down=true]`;
    assert.deepEqual(kinds([[0, 2, 0, block], [0, 1, 0, "scaffolding"]], true), [],
      `${id} attaches to the top of supported scaffolding`);
    const floating = kinds([[0, 3, 0, block], [0, 2, 0, "scaffolding"]], true);
    assert(floating.includes("missingSupport") && !floating.includes("attachmentSupport"),
      "Unsupported scaffolding remains a separate failure, not an invalid attachment");
    assert(kinds([[0, 2, 0, `${id}[east=true]`], [1, 2, 0, "scaffolding"]]).includes("attachmentSupport"),
      "Scaffolding sides do not provide full attachment faces");
    assert(kinds([[0, 2, 0, `${id}[up=true]`], [0, 3, 0, "scaffolding"]]).includes("attachmentSupport"),
      "Do not treat scaffolding as a full cube");
    assert(kinds([[0, 2, 0, `${id}[down=true,east=true]`], [0, 1, 0, "scaffolding"]], true).includes("attachmentSupport"),
      "A valid bottom attachment must not hide another unsupported face");
    assert(kinds([[0, 2, 0, block], [0, 1, 0, "decorated_pot"]], true).includes("invalidSupport"));
    assert(kinds([[0, 2, 0, block]], true).includes("missingSupport"));
    const filler = check([[0, 2, 0, block]]);
    filler.shape.parts[0].cells.set(toShapeCoordKey(0, 1, 0), [FillerRole.SupportFragile]);
    assert.deepEqual(getPlacementWarnings([filler.shape], filler.selections,
      [{ role: FillerRole.SupportFragile, block: "scaffolding" }], true, BuildMode.SuppressStepChecker), [],
    "Configured scaffolding support is valid for down-facing attachments");
  }
  for (const block of ["resin_clump[down=true]", "stone_pressure_plate", "sand", "poppy"]) {
    const warnings = (height: number, assumeFloor: boolean, role: FillerRole, base: string, stepHere = false) => {
      const { shape, selections } = check([[0, height, 0, block]]);
      shape.parts[0].cells.set(toShapeCoordKey(0, height - 1, 0), [
        FillerRole.SupportAll, FillerRole.SupportFragile, ...(stepHere ? [FillerRole.StairStep] : []),
      ]);
      return getPlacementWarnings([shape], selections, [{ role, block: base }], assumeFloor, BuildMode.StaircaseGroup).map(w => w.kind);
    };
    assert.deepEqual(warnings(1, true, FillerRole.StairStep, "dirt"), [], "A suitable assumed floor needs no mode change");
    assert.deepEqual(warnings(1, false, FillerRole.StairStep, "dirt"), ["supportMode"]);
    assert.deepEqual(warnings(2, true, FillerRole.StairStep, "dirt"), ["supportMode"], "A valid filler alone does not generate a support");
    assert.deepEqual(warnings(2, true, FillerRole.StairStep, "dirt", true), [], "Steps works when its support occupies this position");
    for (const role of [FillerRole.SupportAll, FillerRole.SupportFragile]) assert.deepEqual(warnings(2, true, role, "dirt"), []);
    assert.deepEqual(warnings(2, true, FillerRole.StairStep, "air", true), ["autoSupport"]);
  }
  for (const block of ["resin_clump", "resin_clump[down=false]"]) {
    assert(!kinds([[0, 2, 0, block], [0, 1, 0, "stone"]]).some(kind => kind.startsWith("attachment")), `${block} attaches below`);
  }
  const sample = check([[0, 2, 0, "resin_clump[down=true]"], [1, 2, 0, "resin_clump[down=true]"]]);
  for (const x of [0, 1]) sample.shape.parts[0].cells.set(toShapeCoordKey(x, 1, 0), [FillerRole.SupportAll, FillerRole.SupportFragile]);
  const [missing] = getPlacementWarnings([sample.shape, sample.shape], sample.selections, [], true, BuildMode.StaircaseGroup);
  assert.deepEqual(missing.blocks, ["resin_clump"]);
  assert.equal(missing.missingPlacements, 4, "Count placements across selected tiles, even when they share a cached shape and block type");
  assert(kinds([[0, 2, 0, "resin_clump[down=true]"]], true, BuildMode.Flat).includes("missingSupport"),
    "The flat fast path cannot grant support to a raised attachment");
  for (const [facing, x, z] of [["north", 0, 1], ["south", 0, -1], ["west", 1, 0], ["east", -1, 0]] as const) {
    assert(kinds([[0, 1, 0, `shelf_mushroom[facing=${facing}]`]]).includes("shelfSupport"));
    assert(!kinds([[0, 1, 0, `shelf_mushroom[facing=${facing}]`], [x, 1, z, "stone"]]).includes("shelfSupport"));
    assert(kinds([[0, 1, 0, `shelf_mushroom[facing=${facing}]`], [x, 1, z, "oak_slab[type=top]"]]).includes("shelfSupport"));
    // Vanilla checks the supporting block's sturdy face toward the shelf.
    for (const support of ["mud", "copper_grate", `oak_stairs[facing=${facing}]`]) {
      assert(!kinds([[0, 1, 0, `shelf_mushroom[facing=${facing}]`], [x, 1, z, support]]).includes("shelfSupport"), support);
    }
    for (const support of ["oak_leaves", "scaffolding", `oak_stairs[facing=${facing === "north" ? "south" : "north"},shape=outer_left]`]) {
      assert(kinds([[0, 1, 0, `shelf_mushroom[facing=${facing}]`], [x, 1, z, support]]).includes("shelfSupport"), support);
    }
  }
  for (const source of ["redstone_block", "oak_pressure_plate", "lava", "fire"]) {
    assert(kinds([[0, 1, 0, "tnt"], [1, 1, 0, source]]).includes(source === "oak_pressure_plate" ? "tnt" : "tntIgnition"));
    assert(!kinds([[0, 1, 0, "tnt"], [4, 1, 0, source]]).some(kind => kind.startsWith("tnt")));
  }
  assert(kinds([[0, 1, 0, "tnt"], [1, 1, 0, "stone"], [1, 2, 0, "lever[face=floor]"]]).includes("tnt"));
  assert(!kinds([[0, 1, 0, "tnt"], [1, 1, 0, "torch"]]).includes("tnt"), "Ordinary torches do not ignite TNT");
  assert(kinds([[0, 1, 0, "lava"], [1, 1, 0, "oak_planks"]]).includes("fireSpread"));
  assert(kinds([[0, 1, 0, "fire"], [1, 1, 0, "oak_planks"]]).includes("fireSpread"));
  assert(!kinds([[0, 1, 0, "lava"], [1, 1, 0, "crimson_planks"]]).includes("fireSpread"));
  for (const source of ["glowstone", "redstone_lamp[lit=true]", "waxed_oxidized_copper_lantern", "conduit", "respawn_anchor[charges=4]"]) {
    assert(kinds([[0, 1, 0, "ice"], [4, 1, 0, source]]).includes("iceMelt"));
    assert(!kinds([[0, 1, 0, "ice"], [5, 1, 0, source]]).includes("iceMelt"));
    assert(!kinds([[0, 1, 0, "packed_ice"], [1, 1, 0, source]]).some(kind => kind.endsWith("Melt")));
    assert(!kinds([[0, 1, 0, "snow"], [4, 1, 0, source]]).includes("snowMelt"));
    assert(kinds([[0, 1, 0, "snow"], [3, 1, 0, source]]).includes("snowMelt"));
  }
  for (const source of ["redstone_lamp", "furnace[lit=false]", "soul_torch", "redstone_torch", "campfire[lit=false]", "respawn_anchor[charges=3]"]) {
    assert(!kinds([[0, 1, 0, "ice"], [1, 1, 0, source]]).includes("iceMelt"));
  }
  assert(!kinds([[0, 1, 0, "red_concrete_powder"], [1, 1, 0, "water"]]).some(kind => String(kind) === "powderWater"));
  assert.deepEqual(kinds([[0, 1, 0, "sponge"], [1, 1, 0, "mangrove_roots[waterlogged=true]"]]), []);
  assert(kinds([[0, 1, 0, "grass_block"], [1, 2, 0, "dirt"]]).includes("grassSpread"));
  assert(kinds([[0, 4, 0, "mycelium"], [1, 1, 1, "dirt"]]).includes("grassSpread"));
  for (const placements of [[[2, 1, 0, "dirt"]], [[1, 3, 0, "dirt"]], [[1, 1, 0, "coarse_dirt"]], [[1, 1, 0, "dirt"], [1, 2, 0, "stone"]]] as Placement[][]) {
    assert(!kinds([[0, 1, 0, "grass_block"], ...placements]).includes("grassSpread"), "Grass spreads only to nearby uncovered dirt");
  }
  const shadeDirt = check([[0, 1, 0, "grass_block"], [20, 1, 0, "dirt"], [1, 2, 1, "white_carpet"]]);
  shadeDirt.shape.parts[0].cells.set(toShapeCoordKey(1, 1, 0), [FillerRole.ShadeNorthRow]);
  shadeDirt.shape.parts[0].cells.set(toShapeCoordKey(0, 1, 1), { id: 2, isCustom: false, fillerRole: FillerRole.ShadeSuppress });
  shadeDirt.shape.parts[0].cells.set(toShapeCoordKey(1, 1, 1), [FillerRole.SupportFragile]);
  shadeDirt.shape.parts[0].cells.set(toShapeCoordKey(0, 1, -1), { id: 2, isCustom: false, fillerRole: FillerRole.SupportRetained });
  const dirtFillers = [FillerRole.ShadeNorthRow, FillerRole.ShadeSuppress, FillerRole.SupportFragile, FillerRole.SupportRetained].map(role => ({ role, block: "dirt" }));
  assert(!getPlacementWarnings([shadeDirt.shape], shadeDirt.selections, dirtFillers, false, BuildMode.StaircaseGroup).some(w => w.kind === "grassSpread"),
    "Dirt placed as a shade or support filler does not count");
  assert.deepEqual(kinds([[0, 1, 0, "oak_leaves[persistent=false]"]]), [], "Export already forces persistent leaves");
  assert(!kinds([[0, 1, 0, "twisting_vines[age=25]"]]).includes("missingCover"));
  for (const [source, red] of [["redstone_block", true], ["oak_pressure_plate", false],
    ["oak_pressure_plate[powered=true]", true], ["sculk_sensor", false], ["lightning_rod[facing=east]", false],
    ["lightning_rod[facing=east,powered=true]", true]] as const) {
    assert.deepEqual(kinds([[0, 1, 0, "tnt"], [1, 1, 0, source]]).filter(kind => kind.startsWith("tnt")), [red ? "tntIgnition" : "tnt"]);
  }
  assert(!kinds([[0, 1, 0, "tnt"], [1, 1, 0, "stone"], [2, 1, 0, "redstone_block"]]).some(kind => kind.startsWith("tnt")), "Redstone blocks do not strongly power the intervening cube");
  const active = check([[0, 1, 0, "tnt"], [1, 1, 0, "redstone_block"]]);
  const potential = check([[0, 1, 0, "tnt"], [1, 1, 0, "oak_pressure_plate"]]);
  // Separate tile palettes can differ only in custom tests; use shared IDs here.
  potential.shape.parts[0].cells.set(toShapeCoordKey(1, 1, 0), { id: 3, isCustom: false });
  const combinedSelections = { ...active.selections, selectedBlocks: { ...active.selections.selectedBlocks, 3: "oak_pressure_plate" } };
  for (const shapes of [[active.shape, potential.shape], [potential.shape, active.shape]]) {
    assert.deepEqual(getPlacementWarnings(shapes, combinedSelections, [], false, BuildMode.StaircaseGroup)
      .filter(w => w.kind.startsWith("tnt")).map(w => `${w.kind}:${w.blocks}:${w.invalid}`).sort(),
      ["tntIgnition:redstone_block:true"], "Active ignition displaces a potential source, in either tile order");
  }
  assert(check([[0, 1, 0, "tnt"], [1, 1, 0, "stone"], [1, 2, 0, "lever[face=floor,powered=true]"]])
    .warnings.some(w => w.kind === "tntIgnition" && w.invalid), "A correctly mounted control can strongly power an adjacent cube");
  assert(kinds([[0, 1, 0, "tnt"], [1, 1, 0, "shulker_box"], [1, 2, 0, "lever[face=floor,powered=true]"]]).includes("tntIgnition"),
    "Shulker boxes conduct redstone");
  assert(!kinds([[0, 1, 0, "tnt"], [1, 1, 0, "glass"], [1, 2, 0, "lever[face=floor,powered=true]"]]).some(kind => kind.startsWith("tnt")),
    "Glass does not conduct redstone");
  assert(!kinds([[0, 1, 0, "tnt"], [1, 1, 0, "stone"], [1, 2, 0, "lever[face=ceiling]"]]).some(kind => kind.startsWith("tnt")));
  assert(kinds([[0, 1, 0, "fire"], [2, 5, 1, "oak_planks"]]).includes("fireSpread"));
  assert(!kinds([[0, 1, 0, "fire"], [3, 5, 1, "oak_planks"]]).includes("fireSpread"));
  assert(kinds([[0, 1, 0, "lava"], [3, 3, 2, "oak_planks"]]).includes("fireSpread"));
  assert(!kinds([[0, 1, 0, "lava"], [4, 3, 2, "oak_planks"]]).includes("fireSpread"));
  assert(!kinds([[0, 1, 0, "fire"], [1, 1, 0, "oak_leaves[waterlogged=true]"]]).includes("fireSpread"));
  assert(check([[0, 1, 0, "ice"], [4, 1, 0, "glowstone"]]).warnings.some(w => w.kind === "iceMelt" && w.invalid));
  assert.deepEqual(check([[0, 1, 0, "ice"], [1, 1, 0, "glowstone"], [0, 1, 1, "sea_lantern"]]).warnings.find(w => w.kind === "iceMelt")?.blocks,
    ["glowstone", "sea_lantern"], "A melt error names every responsible light source");
  assert(!kinds([[0, 1, 0, "ice"], [2, 1, 0, "stone"], [4, 1, 0, "glowstone"]]).includes("iceMelt"));
  assert(kinds([[0, 1, 0, "ice"]], true, BuildMode.Flat).includes("meltRisk"));
  assert(kinds([[0, 1, 0, "snow"], [0, 0, 0, "stone"]]).includes("snowRisk"));
  // A melt error already covers its block type's light reminder.
  for (const [block, below, source, error, reminder] of [["ice", "stone", "glowstone", "iceMelt", "meltRisk"], ["snow", "stone", "glowstone", "snowMelt", "snowRisk"]] as const) {
    const found = kinds([[0, 1, 0, block], [0, 0, 0, below], [1, 1, 0, source]]);
    assert(found.includes(error) && !found.includes(reminder), `${error} hides ${reminder}`);
  }
  const cold = kinds([[0, 1, 0, "ice"], [0, 0, 0, "stone"], [2, 1, 0, "snow"], [2, 0, 0, "stone"]]);
  assert(cold.includes("iceSnowRisk") && !cold.includes("meltRisk") && !cold.includes("snowRisk"), "Ice and snow share one reminder");
  const melting = check([[0, 1, 0, "ice"], [0, 0, 0, "stone"], [1, 1, 0, "glowstone"], [2, 1, 0, "snow"], [2, 0, 0, "stone"], [3, 1, 0, "sea_lantern"]]).warnings;
  assert.deepEqual(melting.filter(w => /Melt|Risk/.test(w.kind)).map(w => [w.kind, w.blocks]), [["iceSnowMelt", ["glowstone", "sea_lantern"]]],
    "Ice and snow share one melt error");
  assert(!kinds([[0, 1, 0, "fire"], [1, 1, 0, "moss_carpet"]]).includes("fireSpread"), "Moss carpet is not flammable");
  assert(kinds([[0, 1, 0, "fire"], [1, 1, 0, "white_carpet"]]).includes("fireSpread"));
  const waterIce = check([[0, 1, 0, "ice"], [1, 1, 0, "glowstone"]]);
  waterIce.shape.parts[0].cells.set(toShapeCoordKey(0, 1, 0), { id: WATER_BASE_INDEX, isCustom: false });
  assert(!getPlacementWarnings([{ ...waterIce.shape }], { ...waterIce.selections,
    selectedBlocks: { ...waterIce.selections.selectedBlocks, [WATER_BASE_INDEX]: "ice" } }, [], false, BuildMode.StaircaseGroup)
    .some(w => w.kind === "iceMelt" || w.kind === "meltRisk"), "Ice exported for water color is intended to be converted");
  assert(kinds([[0, 1, 0, "frosted_ice"]]).includes("frostedIce"));
  const { shape, selections } = check([[0, 1, 0, "tnt"], [1, 1, 0, "redstone_block"]]);
  shape.parts[0].cells.delete(toShapeCoordKey(1, 1, 0));
  shape.parts.push({ ...shape.parts[0], cells: new Map([[toShapeCoordKey(1, 1, 0), { id: 2, isCustom: false }]]) });
  assert(!getPlacementWarnings([{ ...shape }], selections, [], false, BuildMode.SuppressStepChecker).some(w => w.kind.startsWith("tnt")),
    "Separate phases must not be treated as simultaneous neighbors");
  shape.parts.pop();
  shape.parts[0].cells.set(toShapeCoordKey(1, 1, 0), [FillerRole.ShadeSuppress]);
  assert(getPlacementWarnings([{ ...shape }], selections, [{ role: FillerRole.ShadeSuppress, block: "redstone_block" }], false,
    BuildMode.SuppressStepChecker).some(w => w.kind === "tntIgnition"), "Hazards include exported fillers");
  assert(!getPlacementWarnings([{ ...shape }], selections, [{ role: FillerRole.ShadeSuppress, block: "none" }], false,
    BuildMode.SuppressStepChecker).some(w => w.kind.startsWith("tnt")), "Disabled fillers are not hazards");
  const cached = check([[0, 1, 0, "ice"], [1, 1, 0, "redstone_lamp[lit=true]"]]);
  assert(cached.warnings.some(w => w.kind === "iceMelt"));
  const unlit = { ...cached.selections, selectedBlocks: { ...cached.selections.selectedBlocks, 2: "redstone_lamp[lit=false]" } };
  assert(!getPlacementWarnings([cached.shape], unlit, [], false, BuildMode.StaircaseGroup).some(w => w.kind === "iceMelt"),
    "Warning cache must not flatten state tags like the material-count cache");
  assert.deepEqual(getPlacementWarnings([cached.shape], cached.selections, [], false, BuildMode.StaircaseGroup), cached.warnings);
  const snow = check([[0, 1, 0, "snow"], [0, 0, 0, "packed_ice"]]);
  assert(snow.warnings.some(w => w.kind === "invalidSupport"));
  assert(!getPlacementWarnings([snow.shape], { ...snow.selections, minecraftVersion: "26.4" }, [], false,
    BuildMode.StaircaseGroup).some(w => w.kind === "invalidSupport"));
  const mushroom = check([[0, 1, 0, "brown_mushroom"], [0, 0, 0, "decorated_pot"]]);
  assert(mushroom.warnings.some(w => w.kind === "mushroomLight"));
  // Five of a type within x/z +/-4 and y +/-1 stop each other from spreading; anything sparser can spread.
  const patch = (cells: [number, number, number][], extra: [number, number, number, string][] = []) =>
    check([...cells.map(([x, y, z]): [number, number, number, string] => [x, y, z, "brown_mushroom"]), ...extra])
      .warnings.find(w => w.kind === "mushroomSpread")?.blocks;
  assert.deepEqual(mushroom.warnings.find(w => w.kind === "mushroomSpread")?.blocks, ["brown_mushroom"]);
  assert.deepEqual(patch([[0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]]), ["brown_mushroom"]);
  assert.equal(patch([[0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0], [4, 1, 0]]), undefined);
  assert.equal(patch([[0, 1, 0], [1, 2, 1], [2, 1, 2], [3, 2, 3], [4, 1, 4]]), undefined);
  assert.deepEqual(patch([[0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0], [5, 1, 0]]), ["brown_mushroom"], "The ends are more than 4 apart");
  assert.deepEqual(patch([[0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0], [4, 3, 0]]), ["brown_mushroom"], "Two blocks up is out of range");
  assert.deepEqual(patch([[0, 1, 0], [1, 1, 0], [2, 1, 0], [3, 1, 0]], [[4, 1, 0, "red_mushroom"]]), ["brown_mushroom", "red_mushroom"],
    "Other mushroom types do not count");
  assert.deepEqual(getPlacementWarnings([mushroom.shape], { ...mushroom.selections, minecraftVersion: "26.4" }, [], false,
    BuildMode.StaircaseGroup).map(w => w.kind), ["mushroomSpread"], "26.4 mushrooms allow center support and no longer need low light");
  const cutoff = MINECRAFT_VERSIONS["26.4"].dataVersion;
  assert(!getBlockSupport("honey_block", cutoff - 1).full);
  assert(getBlockSupport("honey_block", cutoff).full);
  assert(getBlockSupport("honey_block", cutoff + 1).full);
  const releases = MINECRAFT_VERSIONS as Record<string, { label: string; dataVersion: number }>;
  releases.future = { label: "Future", dataVersion: cutoff + 100 };
  try {
    const honey = check([[0, 1, 0, "stone_pressure_plate"], [0, 0, 0, "honey_block"]]);
    assert(honey.warnings.some(w => w.kind === "invalidSupport"));
    for (const { shape, selections } of [snow, mushroom, honey]) {
      assert.deepEqual(getPlacementWarnings([shape], { ...selections, minecraftVersion: "future" as MinecraftVersion }, [], false,
        BuildMode.StaircaseGroup).filter(w => w.kind !== "mushroomSpread" && w.kind !== "snowRisk"), [], "Later versions retain the 26.4 placement rules");
    }
  } finally { delete releases.future; }
}


async function main(): Promise<number> {
  const [suite, ...extra] = process.argv.slice(2);
  if (extra.length || suite && !["--rules", "--slope", "--support", "--environment", "--placement"].includes(suite)) {
    throw new Error("Choose one of --rules, --slope, --support, --environment or --placement, or omit flags for the full suite");
  }
  if (suite === "--placement") {
    assertPlacementWarnings();
    console.log("Placement warning invariants passed.");
    return 0;
  }
  if (suite === "--rules") {
    assertBlockSupportPairs();
    console.log("Block support rules passed.");
    return 0;
  }
  if (process.argv.includes("--environment")) {
    await assertEnvironmentalSupport();
    console.log("Environmental generation invariants passed.");
    return 0;
  }
  assertBlockSupportPairs();
  if (process.argv.includes("--slope")) {
    await assertWestEastSlopeExportInvariant();
    console.log("West-east slope export invariants passed.");
    return 0;
  }
  assertFragileSupportEligibility();
  if (process.argv.includes("--support")) {
    assertScaffoldingSupportWarnings();
    assertPlacementWarnings();
    await assertContextualSupport();
    await assertSharedSupportMaterialCounts();
    console.log("Support eligibility and placement invariants passed.");
    return 0;
  }
  assertScaffoldingSupportWarnings();
  assertPlacementWarnings();
  await assertContextualSupport();
  assertZipMetadata();
  assertPartyMinHeight();
  await assertSharedSupportMaterialCounts();
  assertVsSparseMarkerInvariants();
  await assertMixedStepSupportInvariants();
  await assertMixedStepSupportPairs();
  assertGroundedStepReuse();
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
  await assertTripwireInvariants();
  await assertPaletteCollapseModeInvariants();
  await assertWestEastSlopeExportInvariant();
  await assertEnvironmentalSupport();
  console.log("Inline invariants passed.");
  return 0;
}

process.exit(await main());
