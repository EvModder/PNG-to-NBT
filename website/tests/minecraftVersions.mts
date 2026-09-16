#!/usr/bin/env bun
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { BASE_COLORS } from "@/data/mapColors";
import { DEFAULT_MINECRAFT_VERSION } from "@/data/defaultSettings";
import { isFragileBlock } from "@/data/fragileBlocks";
import { EXCLUDED_BLOCKS } from "@/data/mapColorsExcluded";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import { BUILTIN_PRESET_NAMES, getBuiltinPreset } from "@/data/presets";
import { getMinecraftCatalog, getVersionedSelections, getVersionedSupportRules, isBlockAvailable } from "@/lib/minecraftVersion";
import { getBlockIconAsset, getBlockIconAtlasEntry } from "@/lib/blockIconAtlas";
import { convertToNbt } from "@/lib/nbtExport";
import { generateShapeMap } from "@/lib/shapeGeneration";
import { analyzeMaterialNeeds } from "@/lib/shapeAnalysis";
import { collectVsFillerPreviewReplacements } from "@/lib/previewImageEdits";
import { Shade, type ColorGrid } from "@/types/color";
import { toShapeCoordKey } from "@/lib/shapeModel";
import { BuildMode, FillerRole, SuppressStepDirection } from "@/types/conversion";
import { ShapePartType, type GeneratedShape } from "@/types/shape";

const versions = Object.keys(MINECRAFT_VERSIONS) as MinecraftVersion[];
const latest = getMinecraftCatalog();
assert.equal(DEFAULT_MINECRAFT_VERSION, versions.at(-1));
assert.deepEqual(latest.blocks, BASE_COLORS.map(color => color.blocks));
assert.deepEqual(latest.excluded, EXCLUDED_BLOCKS);
const previous = getMinecraftCatalog("26.2");
const added = latest.blocks.flat().filter(block => !previous.blocks.flat().includes(block));
const addedHidden = latest.excluded.flat().filter(block => !previous.excluded.flat().includes(block));
assert.equal(added.length, 14);
assert.equal(addedHidden.length, 72);
for (const block of [...added, ...addedHidden]) {
  assert(!isBlockAvailable(block, 5022), block);
  assert(isBlockAvailable(block, 5023), block);
  for (const version of versions.slice(0, -1)) assert(!isBlockAvailable(block, version), `${version}: ${block}`);
}
for (const [id, color] of Object.entries({ 8: "white", 15: "orange", 16: "magenta", 17: "light_blue", 18: "yellow", 19: "lime", 20: "pink", 21: "gray", 22: "light_gray", 23: "cyan", 24: "purple", 25: "blue", 26: "brown", 27: "green", 28: "red", 29: "black" })) {
  const row = latest.excluded[Number(id)];
  const start = row.indexOf(`${color}_wool_slab`);
  assert(start >= 0);
  assert.deepEqual(row.slice(start, start + 5), [
    `${color}_wool_slab`, `${color}_wool_stairs`, `${color}_concrete_slab`, `${color}_concrete_stairs`,
    color === "purple" ? "shulker_box" : `${color}_shulker_box`,
  ]);
}
assert.deepEqual(latest.blocks[22].slice(-5), ["poplar_log", "stripped_poplar_log", "stripped_poplar_wood", "poplar_planks", "poplar_pressure_plate"]);
assert.deepEqual(latest.blocks[34].filter(block => block.includes("axis=x")), ["oak_log[axis=x]", "jungle_log[axis=x]", "poplar_log[axis=x]"]);
assert(latest.blocks[34].includes("poplar_wood"));
assert(latest.blocks[52].includes("red_shrub"));
assert.deepEqual(latest.excluded[40], ["shelf_mushroom"]);
const catalogIds = new Set([...latest.blocks, ...latest.excluded].flat().map(block => block.split("[")[0]));
for (const block of ["poplar_door", "poplar_hanging_sign", "poplar_wall_hanging_sign", "poplar_wall_sign", "poplar_shelf", "poplar_sapling", "potted_poplar_sapling", "straw_bed"]) {
  assert(!catalogIds.has(block), `Fully omitted: ${block}`);
}
for (const block of ["red_shrub", "poplar_pressure_plate", "poplar_sign", "poplar_button[face=floor]", "poplar_trapdoor"]) assert(isFragileBlock(block), block);
assert.deepEqual(getVersionedSupportRules().get("red_shrub"), getVersionedSupportRules().get("bush"));
// A below-block rule cannot implement shelf mushroom's side attachment.
assert(!getVersionedSupportRules().has("shelf_mushroom"));
for (const version of versions) {
  const catalog = getMinecraftCatalog(version);
  assert.equal(catalog.blocks[7][0], "bamboo_block[axis=x]");
  const plantLeaves = ["oak_leaves", "spruce_leaves", "birch_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "azalea_leaves", "flowering_azalea_leaves"];
  assert.deepEqual(catalog.blocks[7].filter(block => block.endsWith("_leaves")), plantLeaves);
  const otherLeaves = { cherry_leaves: 20, pale_oak_leaves: version === "1.21.4" ? 49 : 6, red_poplar_leaves: 28, orange_poplar_leaves: 15, yellow_poplar_leaves: 18 };
  for (const [block, id] of Object.entries(otherLeaves)) {
    assert.equal(catalog.blocks[id].includes(block), isBlockAvailable(block, version));
  }
  assert.deepEqual(catalog.blocks[12].filter(block => block.includes("_leaves[")),
    [...plantLeaves, ...Object.keys(otherLeaves)].filter(block => isBlockAvailable(block, version))
      .map(block => `${block}[waterlogged=true]`));
  const stone = catalog.excluded[11];
  assert.equal(stone.indexOf("cauldron") + 1, stone.indexOf("hopper"));
  assert.deepEqual(stone.slice(-5), ["suspicious_gravel", "bedrock", "spawner", "trial_spawner", "vault"]);
  assert.deepEqual(stone.filter(block => block.endsWith("_slab")), [
    "cobblestone_slab", "mossy_cobblestone_slab", "stone_slab", "smooth_stone_slab",
    "stone_brick_slab", "mossy_stone_brick_slab", "andesite_slab", "polished_andesite_slab",
  ]);
  assert.equal(stone.indexOf("stonecutter") + 1, stone.indexOf("cobblestone_slab"));
  assert(catalog.blocks.every(row => row.every(block => !block.endsWith("_slab"))), `${version}: visible slab`);
  for (const row of catalog.excluded) {
    const paired = row.filter(block => !block.endsWith("_slab") || row.includes(block.replace(/_slab$/, "_stairs")));
    for (const slab of row.filter(block => block.endsWith("_slab"))) {
      const stairs = slab.replace(/_slab$/, "_stairs");
      if (row.includes(stairs)) assert.equal(paired.indexOf(slab) + 1, paired.indexOf(stairs), `${version}: ${slab} ordering`);
    }
  }
  for (const row of [...catalog.blocks, ...catalog.excluded]) {
    for (const block of row) {
      assert(isBlockAvailable(block, version), `${version}: ${block}`);
      const asset = getBlockIconAsset(block);
      assert(getBlockIconAtlasEntry(asset.atlasName, asset.atlasKey), `Missing icon: ${version} ${block}`);
    }
  }
  for (const name of BUILTIN_PRESET_NAMES) {
    const raw = getBuiltinPreset(name)!.selectedBlocks;
    const before = structuredClone(raw);
    const effective = getVersionedSelections(raw, version);
    assert.deepEqual(raw, before, "Version selection mutated a preset");
    assert(Object.values(effective).every(block => isBlockAvailable(block, version)));
    assert.deepEqual(getVersionedSelections(raw, "26.2"), getVersionedSelections(before, "26.2"));
  }
}
assert(getMinecraftCatalog("1.21.4").blocks[49].includes("pale_oak_leaves"));
assert(getMinecraftCatalog("1.21.4").blocks[49].includes("closed_eyeblossom"));
assert(!getMinecraftCatalog("1.21.4").blocks[6].includes("pale_oak_leaves"));
assert(getMinecraftCatalog("1.21.5").blocks[6].includes("pale_oak_leaves"));
assert(getMinecraftCatalog("1.21.4").blocks[0].includes("chain"));
assert(getMinecraftCatalog("1.21.9").blocks[0].includes("iron_chain"));
assert(!isBlockAvailable("waxed_copper_lantern", "1.21.5"));
assert(!isBlockAvailable("sulfur", "1.21.9"));
assert.equal(MINECRAFT_VERSIONS["1.21.5"].dataVersion, 4440);
assert.equal(MINECRAFT_VERSIONS["1.21.9"].dataVersion, 4790);
assert(!isBlockAvailable("dried_ghast", "1.21.4"));
assert(isBlockAvailable("dried_ghast", "1.21.5"));
assert(!isBlockAvailable("golden_dandelion", "1.21.5"));
assert(isBlockAvailable("golden_dandelion", "1.21.9"));
assert(isBlockAvailable("lightning_rod", "1.21.4"));
assert(isBlockAvailable("some_mod:custom_block", "1.21.4"));
const selected = { 0: "iron_chain", 6: "pale_oak_leaves", 12: "pale_oak_leaves[waterlogged=true]", 18: "sulfur" };
const old = getVersionedSelections(selected, "1.21.4");
assert.equal(old[0], "chain");
assert.equal(old[6], latest.blocks[6][0]);
assert.equal(old[12], selected[12]);
assert.notEqual(old[18], "sulfur");
assert.equal(getVersionedSelections(selected, "26.2")[18], "sulfur");
assert.equal(getVersionedSelections({ 6: "" }, "1.21.4")[6], "");
assert(getVersionedSupportRules("1.21.4").get("big_dripleaf")!.validSupportBlocks.includes("pale_moss_block"));
assert(!getVersionedSupportRules("1.21.5").get("big_dripleaf")!.validSupportBlocks.includes("pale_moss_block"));
assert(!getVersionedSupportRules("1.21.4").get("dead_bush")!.validSupportBlocks.includes("farmland"));
assert(getVersionedSupportRules("1.21.5").get("dead_bush")!.validSupportBlocks.includes("farmland"));

const shape: GeneratedShape = {
  parts: [{
    cells: new Map([
      [toShapeCoordKey(0, 1, 0), { id: 0, isCustom: false }],
      [toShapeCoordKey(1, 1, 0), { id: 6, isCustom: false }],
      [toShapeCoordKey(1, 0, 0), [FillerRole.SupportAll]],
    ]),
    bounds: { minY: 0, maxY: 1, minZ: 0, maxZ: 0 },
    supportFloorYs: new Set(),
  }],
  partType: ShapePartType.SingleColumn,
  splitExportNames: null,
  suppressedTransparentVsCollisionCount: 0,
};
const vsShape: GeneratedShape = {
  ...shape,
  parts: [{ ...shape.parts[0], cells: new Map([[toShapeCoordKey(2, 1, 2), [FillerRole.ShadeVoidDominant]]]) }],
};
for (const [version, id] of [["1.21.4", 49], ["26.2", 6]] as const) {
  const [pixel] = collectVsFillerPreviewReplacements({
    shape: vsShape, minecraftVersion: version, shadeFillerBlock: "",
    dominateVoidFillerBlock: "pale_oak_leaves", recessiveVoidFillerBlock: "",
  });
  assert.deepEqual([pixel.r, pixel.g, pixel.b], [BASE_COLORS[id].r, BASE_COLORS[id].g, BASE_COLORS[id].b]);
}
async function exportBytes(version: MinecraftVersion, blocks: Record<number, string>, support = "iron_chain", collapseDuplicatePaletteStates = true) {
  const result = await convertToNbt(shape, {
    minecraftVersion: version, selectedBlocks: blocks, selectedBlocksCustom: {}, customColors: [],
    collapseDuplicatePaletteStates,
    fillerAssignments: [{ role: FillerRole.SupportAll, block: support }],
    applySupportFloorYs: false, baseName: "version-test", buildMode: BuildMode.StaircaseClassic,
    suppressStepDirection: SuppressStepDirection.EastToWest,
  });
  assert(!result.isZip);
  const bytes = gunzipSync(result.data);
  assert.equal(bytes.subarray(6, 17).toString(), "DataVersion");
  assert.equal(bytes.readInt32BE(17), MINECRAFT_VERSIONS[version].dataVersion);
  return bytes;
}
for (const version of versions) {
  const bytes = await exportBytes(version, { 0: "chain", 6: "iron_block" });
  const chain = version === "1.21.4" || version === "1.21.5" ? "minecraft:chain" : "minecraft:iron_chain";
  assert.equal(bytes.toString().split(chain).length - 1, 1, "Chain spellings must collapse to one palette state");
  const split = await exportBytes(version, { 0: "chain", 6: "iron_block" }, "iron_chain", false);
  assert.equal(split.toString().split(chain).length - 1, 2, "Uncollapsed chain states must remain separate by role");
  const support = await exportBytes(version, { 0: "", 6: "big_dripleaf" }, "pale_moss_block");
  assert(support.includes(Buffer.from(version === "1.21.4" ? "minecraft:pale_moss_block" : "minecraft:dirt")));
}
const older = await exportBytes("1.21.4", { 0: "glass", 6: "iron_block" }, "stone");
const newer = await exportBytes("26.2", { 0: "glass", 6: "iron_block" }, "stone");
older.writeInt32BE(newer.readInt32BE(17), 17);
assert.deepEqual(older, newer, "Unchanged blocks must produce identical geometry/palette bytes");
await assert.rejects(exportBytes("1.21.4", { 0: "glass", 6: "waxed_copper_lantern" }), /unavailable/);
await assert.rejects(exportBytes("26.2", { 0: "glass", 6: "red_shrub" }), /unavailable/);
const shrub = await exportBytes("26.3", { 0: "glass", 6: "red_shrub" }, "stone");
assert(shrub.includes(Buffer.from("minecraft:red_shrub")));
assert(shrub.includes(Buffer.from("minecraft:dirt")), "Red shrub needs a soil support replacement");
for (const color of ["red", "orange", "yellow"]) {
  const leaves = await exportBytes("26.3", { 0: "glass", 6: `${color}_poplar_leaves[waterlogged=true]` });
  assert(leaves.includes(Buffer.from(`minecraft:${color}_poplar_leaves`)));
  assert(leaves.includes(Buffer.from("persistent")));
  assert(leaves.includes(Buffer.from("waterlogged")));
}

// The platform's chains are hardcoded, not taken from the selected palette.
const waterGrid: ColorGrid = Array.from({ length: 128 }, () =>
  Array.from({ length: 128 }, () => ({ id: 12, isCustom: false, shade: Shade.Flat })),
);
const materialShape: GeneratedShape = {
  ...shape,
  parts: [{ ...shape.parts[0], cells: new Map([
    [toShapeCoordKey(0, 1, 0), { id: 0, isCustom: false }],
    [toShapeCoordKey(1, 1, 0), { id: 7, isCustom: false }],
    [toShapeCoordKey(2, 1, 0), { id: 7, isCustom: false }],
    [toShapeCoordKey(3, 1, 0), { id: 0, isCustom: true }],
    [toShapeCoordKey(4, 1, 0), { id: 12, isCustom: false }],
    [toShapeCoordKey(4, 0, 0), { id: 12, isCustom: false }],
  ]) }],
};
const materialOptions = {
  selectedBlocks: { 0: "", 7: "oak_leaves[waterlogged=true]", 12: "water" },
  selectedBlocksCustom: { 0: "stone" }, customColors: [{ r: 1, g: 2, b: 3, blocks: ["stone"] }],
  fillerAssignments: [], applySupportFloorYs: false,
};
assert.deepEqual(analyzeMaterialNeeds(waterGrid, materialShape, materialOptions).blockCounts,
  { "oak_leaves[waterlogged=true]": 2, stone: 1, water: 1 });
materialOptions.selectedBlocks[0] = "glass";
materialOptions.selectedBlocks[7] = "moss_block";
materialOptions.selectedBlocks[12] = "glass_pane[waterlogged=true]";
assert.deepEqual(analyzeMaterialNeeds(waterGrid, materialShape, materialOptions).blockCounts,
  { glass: 1, moss_block: 2, stone: 1, "glass_pane[waterlogged=true]": 2 });
const crubTechShape = generateShapeMap(waterGrid, Shade.Flat, true, false, false, {
  layerGap: 14, suppress2LayerLatePairY: 25, useCrubTech: true,
  waterSetting: { kind: "below-platform", drops: [25, 15, 8] },
  selectedMode: BuildMode.Suppress2Layer, selectedStepDirection: SuppressStepDirection.EastToWest,
})[BuildMode.Suppress2Layer]!;
assert(crubTechShape);
for (const version of ["1.21.4", "26.2"] as const) {
  const result = await convertToNbt(crubTechShape, {
    minecraftVersion: version, selectedBlocks: { 12: "glass_pane[waterlogged=true]" },
    selectedBlocksCustom: {}, customColors: [], fillerAssignments: [], applySupportFloorYs: true,
    baseName: "crubtech-water", buildMode: BuildMode.Suppress2Layer, crubTech: true,
    suppressStepDirection: SuppressStepDirection.EastToWest,
  });
  const bytes = gunzipSync(result.data);
  assert(bytes.includes(Buffer.from(version === "1.21.4" ? "minecraft:chain" : "minecraft:iron_chain")));
  assert.equal(bytes.readInt32BE(17), MINECRAFT_VERSIONS[version].dataVersion);
}
console.log("Minecraft version catalog, preset, support and NBT checks passed.");
