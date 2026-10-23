#!/usr/bin/env bun
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { BASE_COLORS } from "@/data/mapColors";
import { DEFAULT_MINECRAFT_VERSION } from "@/data/defaultSettings";
import { FRAGILE_SUPPORT_RULES, isFragileBlock } from "@/data/fragileBlocks";
import { EXCLUDED_BLOCKS } from "@/data/mapColorsExcluded";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import { BUILTIN_PRESET_NAMES, getBuiltinPreset } from "@/data/presets";
import { getBlockFallbackVersion, getMinecraftCatalog, getVersionedSelections, isBlockAvailable, isBlockCompatible } from "@/lib/minecraftVersion";
import { areBlockFallbacksEqual, normalizeBlockFallbacks, updatePresetBlockSelection } from "@/lib/presetFallbacks";
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
if (false) {
  // @ts-expect-error Named UI versions must be resolved at the caller.
  isBlockAvailable("stone", "1.21.4");
  // @ts-expect-error Catalog lookup uses the same numeric boundary.
  getMinecraftCatalog("1.21.4");
  // @ts-expect-error Block compatibility uses numeric cutoffs too.
  isBlockCompatible("stone", 11, "1.21.4");
}
for (const dataVersion of [4189, 4324, 4325, 4440]) {
  const legacy = dataVersion < 4325;
  for (const block of ["pale_oak_leaves", "closed_eyeblossom"]) {
    assert.equal(isBlockCompatible(block, 49, dataVersion), legacy);
    assert.equal(isBlockCompatible(block, 6, dataVersion), !legacy);
  }
  assert(isBlockCompatible("pale_oak_leaves[waterlogged=true]", 12, dataVersion));
}
const latest = getMinecraftCatalog(MINECRAFT_VERSIONS[versions.at(-1)!].dataVersion);
assert.equal(DEFAULT_MINECRAFT_VERSION, "26.2");
assert.deepEqual(getBlockFallbackVersion("poplar_pressure_plate", 22), { operator: "<", version: "26.3" });
assert.deepEqual(getBlockFallbackVersion("dried_ghast", 8), { operator: "<", version: "1.21.6" });
assert.deepEqual(getBlockFallbackVersion("golden_dandelion", 30), { operator: "<", version: "26.1" });
assert.deepEqual(getBlockFallbackVersion("closed_eyeblossom", 6), { operator: "<", version: "1.21.5" });
assert.deepEqual(getBlockFallbackVersion("closed_eyeblossom", 49), { operator: ">", version: "1.21.4" });
assert.deepEqual(latest.blocks, BASE_COLORS.map(color => color.blocks));
assert.deepEqual(latest.excluded, EXCLUDED_BLOCKS);
const previous = getMinecraftCatalog(MINECRAFT_VERSIONS["26.2"].dataVersion);
const wilderness = getMinecraftCatalog(MINECRAFT_VERSIONS["26.3"].dataVersion);
const added = wilderness.blocks.flat().filter(block => !previous.blocks.flat().includes(block));
const addedHidden = wilderness.excluded.flat().filter(block => !previous.excluded.flat().includes(block));
assert.equal(added.length, 14);
assert.equal(addedHidden.length, 74);
for (const block of [...added, ...addedHidden]) {
  assert(!isBlockAvailable(block, 5022), block);
  assert(isBlockAvailable(block, 5023), block);
  for (const version of versions.filter(version => MINECRAFT_VERSIONS[version].dataVersion < 5023)) assert(!isBlockAvailable(block, MINECRAFT_VERSIONS[version].dataVersion), `${version}: ${block}`);
}
assert.deepEqual(latest.blocks.flat().filter(block => !wilderness.blocks.flat().includes(block)), ["packed_ice_bricks", "brittle_ice", "ice_crystal", "icicle[attached=true]"]);
const snapshotIce = ["chiseled_packed_ice", "packed_ice_brick_slab", "packed_ice_brick_stairs", "packed_ice_brick_wall"];
assert.deepEqual(latest.excluded.flat().filter(block => !wilderness.excluded.flat().includes(block)), snapshotIce);
for (const block of ["brittle_ice", "packed_ice_bricks", ...snapshotIce]) {
  const introduced = MINECRAFT_VERSIONS["26.4"].dataVersion;
  assert(!isBlockAvailable(block, introduced - 1));
  assert(isBlockAvailable(block, introduced));
  assert.equal(getVersionedSelections({ 5: block }, "26.3")[5], "");
  assert.equal(getVersionedSelections({ 5: block }, "26.4")[5], block);
  assert([...latest.blocks[5], ...latest.excluded[5]].includes(block));
}
for (const [id, block] of [[5, "ice_crystal"], [17, "icicle[attached=true]"]] as const) {
  assert.equal(latest.blocks[id].at(-1), block);
  assert(isFragileBlock(block));
  assert(!isBlockAvailable(block, MINECRAFT_VERSIONS["26.4"].dataVersion - 1));
  assert(isBlockAvailable(block, MINECRAFT_VERSIONS["26.4"].dataVersion));
  assert.equal(getVersionedSelections({ [id]: block }, "26.3")[id], "");
  assert.equal(getVersionedSelections({ [id]: block }, "26.4")[id], block);
}
for (const [id, color] of Object.entries({ 8: "white", 15: "orange", 16: "magenta", 17: "light_blue", 18: "yellow", 19: "lime", 20: "pink", 21: "gray", 22: "light_gray", 23: "cyan", 24: "purple", 25: "blue", 26: "brown", 27: "green", 28: "red", 29: "black" })) {
  const row: readonly string[] = latest.excluded[Number(id)];
  const start = row.indexOf(`${color}_wool_slab`);
  assert(start >= 0);
  assert.deepEqual(row.slice(start, start + 5), [
    `${color}_wool_slab`, `${color}_wool_stairs`, `${color}_concrete_slab`, `${color}_concrete_stairs`,
    color === "purple" ? "shulker_box" : `${color}_shulker_box`,
  ]);
}
assert.deepEqual(latest.blocks[22].slice(-5), ["poplar_log", "stripped_poplar_log", "stripped_poplar_wood", "poplar_planks", "poplar_pressure_plate"]);
assert.deepEqual(latest.blocks[34].filter(block => block.includes("axis=x")), ["oak_log[axis=x]", "jungle_log[axis=x]", "mangrove_log[axis=x]", "poplar_log[axis=x]"]);
assert(latest.blocks[34].includes("poplar_wood"));
assert(latest.blocks[52].includes("red_shrub"));
assert.deepEqual(latest.excluded[40], ["shelf_mushroom"]);
const catalogIds = new Set([...latest.blocks, ...latest.excluded].flat().map(block => block.split("[")[0]));
for (const block of ["poplar_door", "poplar_hanging_sign", "poplar_wall_hanging_sign", "poplar_wall_sign", "potted_poplar_sapling", "straw_bed"]) {
  assert(!catalogIds.has(block), `Fully omitted: ${block}`);
}
for (const block of ["red_shrub", "poplar_pressure_plate", "poplar_sign", "poplar_button[face=floor]", "poplar_trapdoor"]) assert(isFragileBlock(block), block);
assert.deepEqual(FRAGILE_SUPPORT_RULES.get("red_shrub"), FRAGILE_SUPPORT_RULES.get("bush"));
// A below-block rule cannot implement shelf mushroom's side attachment.
assert(!FRAGILE_SUPPORT_RULES.has("shelf_mushroom"));
for (const version of versions) {
  const catalog = getMinecraftCatalog(MINECRAFT_VERSIONS[version].dataVersion);
  assert.equal(getMinecraftCatalog(MINECRAFT_VERSIONS[version].dataVersion), catalog, "Known DataVersions reuse cached catalogs");
  for (const block of ["cactus", "sugar_cane", "carrots", "potatoes", "beetroots"]) {
    assert(![...catalog.blocks, ...catalog.excluded].flat().some(choice => choice.split("[")[0] === block), `${version}: fully omitted ${block}`);
  }
  assert(![...catalog.blocks, ...catalog.excluded].flat().some(block => block.includes("_coral_wall_fan")), `${version}: wall fans must remain fully omitted`);
  for (const [id, block] of [[11, "acacia_log[axis=x]"], [14, "birch_log[axis=x]"], [34, "mangrove_log[axis=x]"]] as const) {
    assert(catalog.blocks[id].includes(block), `${version}: missing horizontal log ${block}`);
  }
  for (const [id, first, next] of [[11, "acacia_log[axis=x]", "pale_oak_log[axis=x]"], [14, "birch_log[axis=x]", "pale_oak_log"], [34, "jungle_log[axis=x]", "mangrove_log[axis=x]"]] as const) {
    assert.equal(catalog.blocks[id].indexOf(first) + 1, catalog.blocks[id].indexOf(next), `${version}: wood-family order`);
  }
  for (const [id, family] of [[11, "pale_oak"], [34, "poplar"], [42, "stripped_cherry"], [43, "cherry"]] as const) {
    const log = `${family}_log[axis=x]`;
    assert(!catalog.excluded[id].includes(log), `${version}: horizontal logs must be visible by default`);
    assert.equal(catalog.blocks[id].includes(log), isBlockAvailable(log, MINECRAFT_VERSIONS[version].dataVersion));
    assert.equal(catalog.blocks[id].includes(`${family}_wood`), isBlockAvailable(log, MINECRAFT_VERSIONS[version].dataVersion));
    if (isBlockAvailable(log, MINECRAFT_VERSIONS[version].dataVersion)) assert.equal(catalog.blocks[id].indexOf(log) + 1, catalog.blocks[id].indexOf(`${family}_wood`));
  }
  assert.equal(catalog.excluded[7].indexOf("azalea") + 1, catalog.excluded[7].indexOf("flowering_azalea"));
  assert.equal(catalog.excluded[7].at(-1), "sweet_berry_bush[age=3]");
  for (const block of ["azalea", "flowering_azalea", "sweet_berry_bush[age=3]"]) {
    assert(catalog.excluded[7].includes(block), `${version}: missing stable plant ${block}`);
    assert(isFragileBlock(block), block);
    const rule = FRAGILE_SUPPORT_RULES.get(block.split("[")[0]);
    assert(rule, `${version}: missing substrate rule for ${block}`);
    assert(!rule.validSupportBlocks.includes("cobblestone"));
  }
  assert.equal(catalog.blocks[7][0], "bamboo_block[axis=x]");
  for (const [id, family] of [[18, "horn"], [20, "brain"], [24, "bubble"], [25, "tube"], [28, "fire"]] as const) {
    const coral = [`${family}_coral_block`, `${family}_coral[waterlogged=false]`, `${family}_coral_fan[waterlogged=false]`];
    const start = catalog.excluded[id].indexOf(coral[0]);
    assert(start >= 0, `${version}: missing ${family} coral`);
    assert.deepEqual(catalog.excluded[id].slice(start, start + 3), coral);
    assert(!isFragileBlock(coral[0]));
    assert(isFragileBlock(coral[1]) && isFragileBlock(coral[2]));
  }
  assert(catalog.excluded[version === "1.21.4" ? 14 : 6].includes("pale_oak_sapling"));
  if (version !== "1.21.4") assert(catalog.excluded[6].indexOf("pale_oak_sapling") > catalog.excluded[6].indexOf("iron_trapdoor"));
  assert.equal(catalog.excluded[6].includes("poplar_sapling"), isBlockAvailable("poplar_sapling", MINECRAFT_VERSIONS[version].dataVersion));
  if (isBlockAvailable("poplar_sapling", MINECRAFT_VERSIONS[version].dataVersion)) assert.equal(catalog.excluded[6].indexOf("pale_oak_sapling") + 1, catalog.excluded[6].indexOf("poplar_sapling"));
  for (const [id, blocks] of [
    [7, ["oak_sapling", "spruce_sapling", "birch_sapling", "jungle_sapling", "acacia_sapling", "dark_oak_sapling", "mangrove_propagule[waterlogged=false]"]],
    [13, ["bamboo_sapling"]], [20, ["cherry_sapling"]],
  ] as const) for (const block of blocks) {
    assert(catalog.excluded[id].includes(block), `${version}: ${block} map color`);
    assert(isFragileBlock(block), block);
  }
  assert(catalog.excluded[6].includes("chipped_anvil") && catalog.excluded[6].includes("damaged_anvil"));
  for (const [id, family] of [[13, "oak"], [34, "spruce"], [2, "birch"], [10, "jungle"], [15, "acacia"], [26, "dark_oak"], [28, "mangrove"], [36, "cherry"], [14, "pale_oak"], [22, "poplar"], [18, "bamboo"], [53, "crimson"], [56, "warped"]] as const) {
    const shelf = `${family}_shelf`;
    assert.equal(catalog.excluded[id].includes(shelf), isBlockAvailable(shelf, MINECRAFT_VERSIONS[version].dataVersion));
    assert(!isBlockAvailable(shelf, 4670), `${shelf}: old wood-colored shelves are not offered`);
    if (family !== "poplar") assert(isBlockAvailable(shelf, 4671));
    if (isBlockAvailable(shelf, MINECRAFT_VERSIONS[version].dataVersion)) {
      assert.equal(getVersionedSelections({ [id]: shelf }, version)[id], shelf);
      assert.equal(catalog.excluded[id].indexOf(`${family}_trapdoor`) + 1, catalog.excluded[id].indexOf(shelf), `${version}: ${family} shelf follows older family members`);
    }
  }
  const plantLeaves = ["oak_leaves", "spruce_leaves", "birch_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "azalea_leaves", "flowering_azalea_leaves"];
  assert.deepEqual(catalog.blocks[7].filter(block => block.endsWith("_leaves")), plantLeaves);
  const otherLeaves = { cherry_leaves: 20, pale_oak_leaves: version === "1.21.4" ? 49 : 6, red_poplar_leaves: 28, orange_poplar_leaves: 15, yellow_poplar_leaves: 18 };
  for (const [block, id] of Object.entries(otherLeaves)) {
    assert.equal(catalog.blocks[id].includes(block), isBlockAvailable(block, MINECRAFT_VERSIONS[version].dataVersion));
  }
  assert.deepEqual(catalog.blocks[12].filter(block => block.includes("_leaves[")),
    [...plantLeaves, ...Object.keys(otherLeaves)].filter(block => isBlockAvailable(block, MINECRAFT_VERSIONS[version].dataVersion))
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
      assert(isBlockAvailable(block, MINECRAFT_VERSIONS[version].dataVersion), `${version}: ${block}`);
      const asset = getBlockIconAsset(block);
      assert(getBlockIconAtlasEntry(asset.atlasName, asset.atlasKey), `Missing icon: ${version} ${block}`);
    }
  }
  for (const name of BUILTIN_PRESET_NAMES) {
    const raw = getBuiltinPreset(name)!.selectedBlocks;
    const before = structuredClone(raw);
    const effective = getVersionedSelections(raw, version);
    assert.deepEqual(raw, before, "Version selection mutated a preset");
    assert(Object.values(effective).every(block => isBlockAvailable(block, MINECRAFT_VERSIONS[version].dataVersion)));
    assert.deepEqual(getVersionedSelections(raw, "26.2"), getVersionedSelections(before, "26.2"));
  }
}
assert(getMinecraftCatalog(MINECRAFT_VERSIONS["1.21.4"].dataVersion).blocks[49].includes("pale_oak_leaves"));
assert(getMinecraftCatalog(MINECRAFT_VERSIONS["1.21.4"].dataVersion).blocks[49].includes("closed_eyeblossom"));
assert(!getMinecraftCatalog(MINECRAFT_VERSIONS["1.21.4"].dataVersion).blocks[6].includes("pale_oak_leaves"));
assert(getMinecraftCatalog(MINECRAFT_VERSIONS["1.21.5"].dataVersion).blocks[6].includes("pale_oak_leaves"));
for (const dataVersion of [4324, 4325]) {
  assert(getMinecraftCatalog(dataVersion).excluded[dataVersion < 4325 ? 14 : 6].includes("pale_oak_sapling"));
  assert.equal(isBlockCompatible("pale_oak_sapling", 14, dataVersion), dataVersion < 4325);
  assert.equal(isBlockCompatible("pale_oak_sapling", 6, dataVersion), dataVersion >= 4325);
}
for (const dataVersion of [4553, 4554]) {
  assert(getMinecraftCatalog(dataVersion).blocks[0].includes(dataVersion < 4554 ? "chain" : "iron_chain"));
}
assert.equal(getVersionedSelections({ 6: "pale_oak_sapling" }, "1.21.4")[6], "");
assert.equal(getVersionedSelections({ 14: "pale_oak_sapling" }, "1.21.4")[14], "pale_oak_sapling");
assert.equal(getVersionedSelections({ 14: "pale_oak_sapling" }, "1.21.5")[14], "");
assert.deepEqual(getBlockFallbackVersion("pale_oak_sapling", 14), { operator: ">", version: "1.21.4" });
assert(getMinecraftCatalog(MINECRAFT_VERSIONS["1.21.4"].dataVersion).blocks[0].includes("chain"));
assert(getMinecraftCatalog(MINECRAFT_VERSIONS["1.21.9"].dataVersion).blocks[0].includes("iron_chain"));
assert(!isBlockAvailable("waxed_copper_lantern", MINECRAFT_VERSIONS["1.21.5"].dataVersion));
assert(!isBlockAvailable("sulfur", MINECRAFT_VERSIONS["1.21.9"].dataVersion));
assert.equal(MINECRAFT_VERSIONS["1.21.5"].dataVersion, 4440);
assert.equal(MINECRAFT_VERSIONS["1.21.9"].dataVersion, 4790);
assert(!isBlockAvailable("dried_ghast", MINECRAFT_VERSIONS["1.21.4"].dataVersion));
assert(isBlockAvailable("dried_ghast", MINECRAFT_VERSIONS["1.21.5"].dataVersion));
assert(!isBlockAvailable("golden_dandelion", MINECRAFT_VERSIONS["1.21.5"].dataVersion));
assert(isBlockAvailable("golden_dandelion", MINECRAFT_VERSIONS["1.21.9"].dataVersion));
assert.equal(getVersionedSelections({ 34: "spruce_shelf" }, "1.21.5")[34], "");
assert.equal(getVersionedSelections({ 34: "spruce_shelf" }, "1.21.5", { 34: ["spruce_planks"] })[34], "spruce_planks");
assert.deepEqual(getBlockFallbackVersion("spruce_shelf", 34), { operator: "<", version: "1.21.11" });
assert(isBlockAvailable("lightning_rod", MINECRAFT_VERSIONS["1.21.4"].dataVersion));
assert(isBlockAvailable("some_mod:custom_block", MINECRAFT_VERSIONS["1.21.4"].dataVersion));
const selected = { 0: "iron_chain", 6: "pale_oak_leaves", 12: "pale_oak_leaves[waterlogged=true]", 18: "sulfur" };
const stored = structuredClone(selected);
const old = getVersionedSelections(selected, "1.21.4");
assert.equal(old[0], "chain");
assert.equal(old[6], "");
assert.equal(old[12], selected[12]);
assert.equal(old[18], "");
assert.equal(old[1], "", "An unassigned color must not select a catalog default");
assert.deepEqual(selected, stored, "Unavailable selections must remain saved");
assert.equal(getVersionedSelections(selected, "26.2")[6], "pale_oak_leaves");
assert.equal(getVersionedSelections(selected, "26.2")[18], "sulfur");
assert.equal(getVersionedSelections({ 6: "" }, "1.21.4")[6], "");
assert.equal(getVersionedSelections({ 49: "closed_eyeblossom" }, "1.21.4")[49], "closed_eyeblossom");
assert.equal(getVersionedSelections({ 49: "closed_eyeblossom" }, "26.2")[49], "");
assert.equal(getVersionedSelections({ 22: "poplar_planks" }, "26.2")[22], "");
assert.equal(getVersionedSelections({ 22: "poplar_planks" }, "26.3")[22], "poplar_planks");
assert.equal(getVersionedSelections({ 22: "some_mod:custom_block" }, "1.21.4")[22], "some_mod:custom_block");

// Fallback chains require explicit confirmation; ordinary selections replace everywhere.
const preferences = { name: "Fallbacks", selectedBlocks: { 18: "yellow_carpet" } };
assert.deepEqual(updatePresetBlockSelection(preferences, 18, "sulfur", "26.2"), {
  selectedBlocks: { 18: "sulfur" }, blockFallbacks: undefined,
});
const newerPreset = { name: "Fallbacks", selectedBlocks: { 18: "yellow_wool_slab" } };
assert.equal(updatePresetBlockSelection(newerPreset, 18, "sulfur", "26.2"), null);
const intermediate = { ...newerPreset, ...updatePresetBlockSelection(newerPreset, 18, "sulfur", "26.2", "fallback")! };
assert.equal(updatePresetBlockSelection(intermediate, 18, "yellow_carpet", "1.21.4"), null);
const chained = { ...intermediate, ...updatePresetBlockSelection(intermediate, 18, "yellow_carpet", "1.21.4", "fallback")! };
assert.deepEqual(chained.blockFallbacks, { 18: ["sulfur", "yellow_carpet"] });
assert.equal(updatePresetBlockSelection(chained, 18, "yellow_concrete_slab", "26.3")!.blockFallbacks,
  undefined, "An ordinary replacement must not inherit a fallback chain");
assert.equal(updatePresetBlockSelection(chained, 18, "yellow_concrete", "26.3")!.blockFallbacks, undefined);
for (const [version, block] of [["1.21.4", "yellow_carpet"], ["26.2", "sulfur"], ["26.3", "yellow_wool_slab"]] as const) {
  assert.equal(getVersionedSelections(chained.selectedBlocks, version, chained.blockFallbacks)[18], block);
}
const beforeFallbackEdit = structuredClone(chained);
assert.equal(updatePresetBlockSelection(chained, 18, "yellow_concrete", "1.21.4"), null);
const kept = updatePresetBlockSelection(chained, 18, "yellow_concrete", "1.21.4", "fallback")!;
assert.equal(kept.selectedBlocks[18], "yellow_wool_slab");
assert.deepEqual(kept.blockFallbacks, { 18: ["sulfur", "yellow_concrete"] });
assert.deepEqual(updatePresetBlockSelection(chained, 18, "yellow_concrete", "26.2", "fallback")!.blockFallbacks,
  { 18: ["yellow_concrete"] }, "Updating a fallback must discard superseded lower-priority choices");
const mixedOrder = { ...chained, blockFallbacks: { 18: ["yellow_carpet", "sulfur", "yellow_wool"] } };
assert.deepEqual(updatePresetBlockSelection(mixedOrder, 18, "yellow_concrete", "1.21.4", "fallback")!.blockFallbacks,
  { 18: ["sulfur", "yellow_concrete"] }, "Collapse every available alternative while preserving unavailable choices regardless of order");
assert.deepEqual(chained, beforeFallbackEdit);
assert(!areBlockFallbacksEqual(chained.blockFallbacks, kept.blockFallbacks));
const replaced = updatePresetBlockSelection(chained, 18, "yellow_concrete", "1.21.4", "replace")!;
assert.equal(replaced.selectedBlocks[18], "yellow_concrete");
assert.equal(replaced.blockFallbacks, undefined);
const cleared = updatePresetBlockSelection(chained, 18, "", "1.21.4")!;
assert.equal(cleared.blockFallbacks, undefined);
assert.equal(getVersionedSelections(cleared.selectedBlocks, "26.3")[18], "");
assert.deepEqual(normalizeBlockFallbacks({ 18: ["yellow_wool_slab", "yellow_carpet", "yellow_carpet", "", 3], 999: ["stone"] }, chained.selectedBlocks), { 18: ["yellow_carpet"] });
assert.equal(getVersionedSelections({ 6: "pale_oak_leaves" }, "1.21.4", { 6: ["closed_eyeblossom", "iron_block"] })[6], "iron_block");
assert.equal(getVersionedSelections({ 0: "poplar_button[face=floor]" }, "1.21.4", { 0: ["iron_chain"] })[0], "chain");
assert(!FRAGILE_SUPPORT_RULES.get("big_dripleaf")!.validSupportBlocks.includes("pale_moss_block"));
assert(FRAGILE_SUPPORT_RULES.get("dead_bush")!.validSupportBlocks.includes("farmland"));

const waterGrid: ColorGrid = Array.from({ length: 128 }, () =>
  Array.from({ length: 128 }, () => ({ id: 12, isCustom: false, shade: Shade.Flat })),
);
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
  assert(bytes.includes(Buffer.from(MINECRAFT_VERSIONS[version].dataVersion >= 5006 ? "\x08\x00\x02id" : "\x08\x00\x04Name")), "Palette field names must match the export version");
  const chain = version === "1.21.4" || version === "1.21.5" ? "minecraft:chain" : "minecraft:iron_chain";
  assert.equal(bytes.toString().split(chain).length - 1, 1, "Chain spellings must collapse to one palette state");
  const split = await exportBytes(version, { 0: "chain", 6: "iron_block" }, "iron_chain", false);
  assert.equal(split.toString().split(chain).length - 1, 2, "Uncollapsed chain states must remain separate by role");
  const support = await exportBytes(version, { 0: "", 6: "big_dripleaf" }, "pale_moss_block");
  assert(support.includes(Buffer.from("minecraft:dirt")), "All versions use modern dripleaf support rules");
  const deadBush = await exportBytes(version, { 0: "", 6: "dead_bush" }, "farmland");
  assert(deadBush.includes(Buffer.from("minecraft:farmland")), "All versions use modern dead bush support rules");
  for (const block of ["azalea", "flowering_azalea", "sweet_berry_bush[age=3]"]) {
    const substrate = FRAGILE_SUPPORT_RULES.get(block.split("[")[0])!.replacementBlock;
    const bytes = await exportBytes(version, { 6: block }, "cobblestone");
    assert(bytes.includes(Buffer.from(`minecraft:${substrate}`)), `${block}: missing exported substrate`);
    assert(!bytes.includes(Buffer.from("minecraft:cobblestone")), `${block}: unsuitable support survived`);
    const stats = analyzeMaterialNeeds(waterGrid, shape, {
      minecraftVersion: version, selectedBlocks: { 6: block }, selectedBlocksCustom: {}, customColors: [],
      fillerAssignments: [{ role: FillerRole.SupportAll, block: "cobblestone" }], applySupportFloorYs: false,
    });
    assert.equal(stats.blockCounts[substrate], 1, `${block}: material/export substrate mismatch`);
  }
  const catalog = getMinecraftCatalog(MINECRAFT_VERSIONS[version].dataVersion);
  for (const block of [...catalog.blocks, ...catalog.excluded].flat()) {
    if (!/^(sea_pickle|conduit|(dead_)?(tube|brain|bubble|fire|horn)_coral(_fan|_wall_fan)?)(\[|$)/.test(block)) continue;
    assert(block.includes("waterlogged=false"), `${block} must specify its dry state`);
    const dry = await exportBytes(version, { 6: block });
    assert(dry.includes(Buffer.from("waterlogged\x00\x05false")));
    const wet = await exportBytes(version, { 6: block.replace("waterlogged=false", "waterlogged=true") });
    assert(wet.includes(Buffer.from("waterlogged\x00\x04true")), "Explicit waterlogging must remain supported");
  }
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
for (const block of ["ice_crystal", "icicle[attached=true]", "brittle_ice", "packed_ice_bricks", ...snapshotIce]) {
  await assert.rejects(exportBytes("26.3", { 6: block }), /unavailable/);
  const bytes = await exportBytes("26.4", { 6: block }, "glass");
  assert(bytes.includes(Buffer.from(`minecraft:${block.split("[")[0]}`)));
  if (block.startsWith("icicle")) assert(bytes.includes(Buffer.from("attached\x00\x04true")));
}
for (const color of ["red", "orange", "yellow"]) {
  const leaves = await exportBytes("26.3", { 0: "glass", 6: `${color}_poplar_leaves[waterlogged=true]` });
  assert(leaves.includes(Buffer.from(`minecraft:${color}_poplar_leaves`)));
  assert(leaves.includes(Buffer.from("persistent")));
  assert(leaves.includes(Buffer.from("waterlogged")));
}

// The platform's chains are hardcoded, not taken from the selected palette.
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
  { oak_leaves: 2, stone: 1, water: 1 });
materialOptions.selectedBlocks[0] = "glass";
materialOptions.selectedBlocks[7] = "moss_block";
materialOptions.selectedBlocks[12] = "glass_pane[waterlogged=true]";
assert.deepEqual(analyzeMaterialNeeds(waterGrid, materialShape, materialOptions).blockCounts,
  { glass: 1, moss_block: 2, stone: 1, glass_pane: 2 });
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
