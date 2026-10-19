import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { generateTile } from "@/api/generateTile";
import { generateShapeMap } from "@/lib/shapeGeneration";
import { convertToNbtEntries } from "@/lib/nbtExport";
import { createFillerAssignments } from "@/lib/fillerRules";
import { requiresTwoLayerLateShading, type WaterDrops } from "@/lib/colorGridAnalysis";
import { getMinecraftCatalog } from "@/lib/minecraftVersion";
import { BASE_COLORS } from "@/data/mapColors";
import { SUPPRESS_STEP_LIMITS, SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS, type SuppressLoadSpotMarkerBlock } from "@/data/defaultSettings";
import { getTwoLayerSpacing } from "@/lib/generationPolicy";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { SupportMode } from "@/types/ui";
import { Shade, type ColorGrid } from "@/types/color";
import type { GenerateTileRequest, GenerateTileResult, GenerationOptions, GenerationMode } from "@/api/contract";

// The distributed declaration stays standalone; fail typechecking if either side drifts.
function assertTypeParity<A, B>(same: [A, B] extends [B, A] ? true : never) { assert(same); }
assertTypeParity<GenerationMode, `${Exclude<BuildMode, BuildMode.SuppressSplitRow | BuildMode.SuppressSplitChecker>}`>(true);
assertTypeParity<NonNullable<GenerationOptions["direction"]>, `${SuppressStepDirection}`>(true);
assertTypeParity<NonNullable<GenerationOptions["support"]>, `${SupportMode}`>(true);
assertTypeParity<NonNullable<GenerationOptions["loadSpotBlock"]>, SuppressLoadSpotMarkerBlock>(true);
assertTypeParity<NonNullable<GenerationOptions["waterDrops"]>, WaterDrops>(true);
assertTypeParity<GenerationOptions["westEastSlope"], Parameters<typeof convertToNbtEntries>[1]["westEastSlope"]>(true);
assertTypeParity<GenerateTileResult["files"], Awaited<ReturnType<typeof convertToNbtEntries>>>(true);

async function invalid(input: unknown, pattern?: RegExp) {
  await assert.rejects(generateTile(input as GenerateTileRequest), error => {
    assert.equal((error as { code: string }).code, "INVALID_INPUT");
    if (pattern) assert.match((error as Error).message, pattern);
    return true;
  });
}

const tile = (pixel: (x: number, z: number) => number) => Uint8Array.from({ length: 16384 }, (_, i) => pixel(i % 128, i >> 7));
const flat = tile(() => 45);
const varied = tile((x, z) => 44 + (x + z) % 3);
const transparent = tile((x, z) => x % 9 === 0 && z % 7 === 0 ? 0 : 44 + (x + z) % 3);
const water = tile((x, z) => x % 5 === 0 ? 48 + z % 3 : 45);
const grid = (colors: Uint8Array): ColorGrid => Array.from({ length: 128 }, (_, x) => Array.from({ length: 128 }, (_, z) => ({
  id: colors[z * 128 + x] >> 2, shade: (colors[z * 128 + x] & 3) as Shade, isCustom: false,
})));
const unpack = (data: Uint8Array) => gunzipSync(data);
const request = (colors = varied, options: GenerationOptions = {}): GenerateTileRequest => ({ colors, blocks: { 11: "stone", 12: "water" }, options });
let comparisons = 0;

// Read the actual help table: changing defaults, choices or bounds must update the docs too.
const html = readFileSync(new URL("../src/api/index.html", import.meta.url), "utf8");
const documented = [...html.matchAll(/<tr><td><code>(\w+)<\/code><\/td><td>([\s\S]*?)<\/td><td>/g)].map(([, name, values]) => {
  const defaultText = values.match(/class="default"[^>]*><code>([^<]+)<\/code>/)?.[1];
  assert(defaultText !== undefined, `${name}: missing documented default`);
  let value: unknown;
  try { value = name === "minecraftVersion" ? defaultText : JSON.parse(defaultText); }
  catch { value = defaultText === "unset" ? undefined : defaultText; }
  return { name, value, values: [...values.matchAll(/<code>([^<]+)<\/code>/g)].map(match => match[1]),
    note: values.match(/class="value-note">([^<]+)<\/span>/)?.[1] };
});
const documentedDefaults = Object.fromEntries(documented.map(({ name, value }) => [name, value])) as GenerationOptions;
const declaration = readFileSync(new URL("../src/api/contract.ts", import.meta.url), "utf8");
const declaredOptions = [...declaration.split("export interface GenerationOptions {")[1].split("\n}")[0]
  .matchAll(/^  (\w+)\?:/gm)].map(match => match[1]).sort();
assert.deepEqual(documented.map(row => row.name).sort(), declaredOptions, "Document every option exactly once");
// Published warning codes: every code the generator can emit is documented, and nothing else is.
const emittedCodes = [...readFileSync(new URL("../src/api/generateTile.ts", import.meta.url), "utf8")
  .matchAll(/warn\("([A-Z_]+)"|"(PLACEMENT_[A-Z_]+)"/g)].map(match => match[1] ?? match[2]);
assert.deepEqual([...html.split('<li id="warnings">')[1].split("</li>")[0].matchAll(/<code>([A-Z_]+)<\/code>/g)].map(match => match[1]).sort(),
  emittedCodes.toSorted(), "Document every warning code exactly once");
for (const [name, values] of Object.entries({
  mode: Object.values(BuildMode).filter(mode => mode !== BuildMode.SuppressSplitRow && mode !== BuildMode.SuppressSplitChecker),
  direction: Object.values(SuppressStepDirection), support: Object.values(SupportMode), loadSpotBlock: SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS,
})) assert.deepEqual(documented.find(row => row.name === name)!.values.toSorted(), [...values].sort(), `${name}: documented choices`);

// Omitted and explicitly documented defaults must agree even when mode-specific adjustments apply.
for (const input of [request(flat), request(varied, { mode: "staircase_party" }),
  request(varied, { mode: "suppress_step_checker" }), request(varied, { mode: "suppress_2layer" }),
  request(water, { mode: "suppress_step_pairs", belowPlatformWater: true }),
  request(varied, { mode: "suppress_step_checker", maxBlockLift: 1, support: "fragile",
    supportBlock: "resin_block", shadeBlock: "resin_clump[down=true]" }),
]) {
  const implicit = await generateTile(input);
  const explicit = await generateTile({ ...input, options: { ...documentedDefaults, ...input.options } });
  assert.deepEqual(explicit.effectiveOptions, implicit.effectiveOptions, "Documented defaults must match runtime defaults");
  assert.deepEqual(explicit.files.map(file => unpack(file.data)), implicit.files.map(file => unpack(file.data)));
  assert.deepEqual(Object.keys(implicit.effectiveOptions).filter(key => key !== "westEastSlope").sort(),
    declaredOptions.filter(key => key !== "westEastSlope"), "Runtime and public contract option keys must agree");
}
for (const row of documented.filter(row => typeof row.value === "number")) {
  const range = row.note?.match(/^Integer: (\d+)-(\d+)\.$/);
  assert(range, `${row.name}: document the numeric range`);
  const min = Number(range[1]), max = Number(range[2]);
  for (const value of [min, max]) await generateTile(request(flat, { [row.name]: value }));
  for (const value of [min - 1, max + 1, min + 0.5, NaN, Infinity]) await invalid(request(flat, { [row.name]: value }), new RegExp(row.name));
}
const slopeNote = documented.find(row => row.name === "westEastSlope")!.note!;
for (const key of ["run", "rise"] as const) {
  const range = slopeNote.match(new RegExp(`${key} (-?\\d+)(?:-| to )(-?\\d+)`));
  assert(range, `Document westEastSlope.${key} bounds`);
  const min = Number(range[1]), max = Number(range[2]);
  for (const value of [min, max]) await generateTile(request(flat, { westEastSlope: { run: 1, rise: 0, [key]: value } }));
  for (const value of [min - 1, max + 1, min + 0.5]) await invalid(request(flat, { westEastSlope: { run: 1, rise: 0, [key]: value } }), /westEastSlope/);
}
const waterRange = documented.find(row => row.name === "waterDrops")!.note!.match(/^Integers: (\d+)-(\d+)\.$/)!;
assert(waterRange, "Document waterDrops bounds");
for (const index of [0, 1, 2]) for (const value of [Number(waterRange[1]), Number(waterRange[2]), Number(waterRange[1]) - 1, Number(waterRange[2]) + 1, 0.5]) {
  const waterDrops: [number, number, number] = [4, 2, 0];
  waterDrops[index] = value;
  if (value === Number(waterRange[1]) || value === Number(waterRange[2])) await generateTile(request(flat, { waterDrops }));
  else await invalid(request(flat, { waterDrops }), /waterDrops/);
}

const explicitFlat = await generateTile(request(flat, { mode: "flat" }));
for (const support of Object.values(SupportMode)) for (const crubTech of [false, true]) {
  const result = await generateTile(request(flat, { mode: "suppress_2layer", support, crubTech, layerGap: 2, latePairsGap: 63 }));
  const expected = getTwoLayerSpacing(support, 2, 63, crubTech);
  assert.equal(result.effectiveOptions.layerGap, expected.layerGap);
  assert.equal(result.effectiveOptions.latePairsGap, expected.latePairsGap);
}
for (const [minStepOffset, valid] of [[SUPPRESS_STEP_LIMITS.minOffset - 1, false], [SUPPRESS_STEP_LIMITS.minOffset, true],
  [SUPPRESS_STEP_LIMITS.maxOffset, true], [SUPPRESS_STEP_LIMITS.maxOffset + 1, false]] as const) {
  const input = request(flat, { mode: "suppress_step_checker", minStepOffset });
  if (valid) assert.equal((await generateTile(input)).effectiveOptions.minStepOffset, minStepOffset);
  else await invalid(input, /minStepOffset/);
}
await invalid(request(flat, { maxBlockLift: SUPPRESS_STEP_LIMITS.maxLift + 1 }), /maxBlockLift/);
for (const mode of [BuildMode.Flat, BuildMode.SuppressStepChecker, BuildMode.SuppressStepPairs] as const) {
  const output = await generateTile(request(flat, { mode, support: SupportMode.All, supportBlock: "scaffolding", assumeSupportFloor: true }));
  assert(output.files[0].data.length > 0, `${mode}: allow grounded or omitted scaffolding supports`);
}
assert((await generateTile(request(flat, { support: SupportMode.All, supportBlock: "scaffolding", assumeSupportFloor: false })))
  .warnings.some(warning => warning.code === "PLACEMENT_SCAFFOLD_SUPPORT_FILLER"));
for (const supportBlock of ["stone", "air"]) {
  const result = await generateTile(request(flat, { support: "all", supportBlock, assumeSupportFloor: true }));
  assert.equal(result.effectiveOptions.assumeSupportFloor, supportBlock === "air");
}
const fallingColors = tile(() => 9);
for (const autoPickSupports of [false, true]) {
  const result = await generateTile({ colors: tile(x => (x % 2 ? 13 : 18) * 4 + 1),
    blocks: { 18: "wheat[age=7]", 13: "oak_pressure_plate" }, options: { support: "fragile", supportBlock: "stone", autoPickSupports } });
  const nbt = unpack(result.files[0].data);
  assert(nbt.includes("minecraft:stone"));
  assert.equal(nbt.includes("minecraft:farmland"), autoPickSupports);
  assert.equal(result.warnings.some(warning => warning.code === "PLACEMENT_AUTO_SUPPORT"), !autoPickSupports);
}
const unsupportedSand = await generateTile({ colors: fallingColors, blocks: { 2: "sand" }, options: { assumeSupportFloor: false } });
assert(unsupportedSand.warnings.some(warning => warning.code === "PLACEMENT_SUPPORT_MODE"));
const supportedSand = await generateTile({ colors: fallingColors, blocks: { 2: "sand" }, options: { support: "fragile", supportBlock: "stone" } });
assert.equal(supportedSand.effectiveOptions.assumeSupportFloor, false);
assert(!supportedSand.warnings.some(warning => warning.code.startsWith("PLACEMENT_")));
const resinColors = tile((_, z) => 37 * 4 + z % 3);
for (const support of [SupportMode.Steps, SupportMode.Fragile, SupportMode.All]) {
  const { warnings } = await generateTile({ colors: resinColors, blocks: { 37: "resin_clump[down=true]" },
    options: { mode: "staircase_group", support, supportBlock: "stone", assumeSupportFloor: true } });
  assert.deepEqual(warnings.map(w => w.code), support === SupportMode.Steps ? ["PLACEMENT_SUPPORT_MODE"] : []);
}
for (const options of [undefined, {}, { mode: undefined }] as const) {
  const output = await generateTile({ ...request(flat), options });
  assert.equal(output.effectiveOptions.mode, "flat");
  assert.deepEqual(unpack(output.files[0].data), unpack(explicitFlat.files[0].data));
  await invalid({ ...request(varied), options }, /specify a compatible generation mode/);
}
for (const mode of [BuildMode.StaircaseGroup, BuildMode.SuppressStepChecker, BuildMode.Suppress2Layer] as const) {
  const output = await generateTile(request(flat, { mode }));
  assert.equal(output.effectiveOptions.mode, mode);
  assert(output.files[0].data.length > 0);
}

// Compare the API with the established engine/export call pattern, not a second API invocation.
for (const mode of [BuildMode.SuppressStepChecker, BuildMode.SuppressStepPairs, BuildMode.Suppress2Layer] as const) {
  for (const direction of Object.values(SuppressStepDirection)) for (const centerOut of [false, true]) {
    for (const keepExtras of mode === BuildMode.Suppress2Layer ? [false] : [false, true]) {
      const colors = varied;
      const colorGrid = grid(colors);
      const options = { mode, direction, centerOut, keepExtras, minStepOffset: 3, uniformStepSpacing: false, markLoadSpots: true };
      const actual = await generateTile(request(colors, options));
      const shape = generateShapeMap(colorGrid, undefined, false, false, false, {
        layerGap: 5, mixSteps: true, selectedMode: mode, selectedStepDirection: direction,
        suppressCenterOut: centerOut, skipEmptySuppressSteps: !keepExtras, minSuppressStepOffset: 3,
        uniformSuppressStepSpacing: false, keepSuppressExtras: keepExtras, collapseStaircaseModes: true,
        enableWaterConvenience: false,
      })[mode]!;
      const expected = await convertToNbtEntries(shape, {
        selectedBlocks: { 11: "stone" }, selectedBlocksCustom: {}, customColors: [], minecraftVersion: "26.2",
        fillerAssignments: createFillerAssignments("cobblestone", "resin_block", "moss_block", "resin_block", "resin_block",
          "slime_block", "resin_block", SupportMode.None, false, false, false),
        applySupportFloorYs: true, forceXZ128: true, forceZ129: false, baseName: "tile", buildMode: mode,
        suppressStepDirection: direction, suppressCenterOut: centerOut, keepSuppressExtras: keepExtras,
        markSuppressLoadSpotsInSchematic: true, suppressLoadSpotMarkerBlock: "jigsaw", suppress2LayerLatePairY: 6,
      });
      assert.deepEqual(unpack(actual.files[0].data), unpack(expected[0].data), `${mode}/${direction}/${centerOut}/${keepExtras}`);
      assert.equal(actual.effectiveOptions.skipEmptySteps, !keepExtras);
      ++comparisons;
    }
  }
}

for (const mode of [BuildMode.StaircaseNorthline, BuildMode.StaircaseSouthline, BuildMode.StaircaseClassic,
  BuildMode.StaircaseValley, BuildMode.StaircaseGroup, BuildMode.StaircaseParty] as const) {
  const output = await generateTile(request(varied, { mode }));
  assert(output.files[0].data.length > 0);
}
// Repeated low/high runs need exactly five levels at minimum height.
const compactParty = await generateTile(request(tile((_, z) => 44 + (z % 8 < 4 ? Shade.Light : Shade.Dark)),
  { mode: "staircase_party", partyMinHeight: true }));
assert.equal(compactParty.effectiveOptions.partyMinHeight, true);
const compactNbt = unpack(compactParty.files[0].data);
assert.equal(compactNbt.readInt32BE(compactNbt.indexOf(Buffer.from("size")) + 4 + 9), 5);
for (const [mode, colors] of [[BuildMode.Flat, flat], [BuildMode.InclineUp, tile(() => 44)], [BuildMode.InclineDown, tile(() => 46)]] as const) {
  const output = await generateTile(request(colors, { mode }));
  assert(output.files[0].data.length > 0);
}
assert((await generateTile({ colors: new Uint8Array(16384), blocks: {} })).files.length === 1);
for (const support of Object.values(SupportMode)) {
  const result = await generateTile(request(varied, { mode: "staircase_classic", support }));
  assert.equal(result.effectiveOptions.support, support);
}
for (const minecraftVersion of Object.keys(MINECRAFT_VERSIONS) as MinecraftVersion[]) {
  const result = await generateTile(request(flat, { minecraftVersion }));
  assert.equal(result.effectiveOptions.minecraftVersion, minecraftVersion);
  // Every catalog's primary and excluded choices must pass the public selection validator.
  const catalog = getMinecraftCatalog(MINECRAFT_VERSIONS[minecraftVersion].dataVersion);
  const maxOptions = Math.max(...catalog.blocks.map((blocks, id) => blocks.length + catalog.excluded[id].length));
  for (let index = 0; index < maxOptions; ++index) {
    const blocks = Object.fromEntries(BASE_COLORS.flatMap((_, id) => {
      const block = [...catalog.blocks[id], ...catalog.excluded[id]][index];
      return block ? [[id, block]] : [];
    }));
    await generateTile({ colors: new Uint8Array(16384), blocks, options: { minecraftVersion } });
  }
}

for (const belowPlatformWater of [false, true]) for (const mode of [BuildMode.SuppressStepPairs, BuildMode.SuppressStepChecker] as const) {
  for (const direction of Object.values(SuppressStepDirection)) {
    const result = await generateTile(request(water, { mode, direction, belowPlatformWater, waterDrops: [4, 2, 1] }));
    assert(result.files[0].data.length > 0);
  }
}
for (const mode of [BuildMode.Suppress2LayerLateFillers, BuildMode.Suppress2LayerLatePairs] as const) {
  assert(requiresTwoLayerLateShading(grid(transparent)));
  for (const direction of Object.values(SuppressStepDirection)) {
    assert((await generateTile(request(transparent, { mode, direction }))).files[0].data.length > 0);
  }
  if (mode === BuildMode.Suppress2LayerLateFillers) continue;
  const result = await generateTile(request(transparent, { mode, crubTech: true, support: "fragile", centerOut: true, direction: "north_to_south", layerSplit: true }));
  assert.equal(result.effectiveOptions.support, "all");
  assert.equal(result.effectiveOptions.direction, "east_to_west");
  assert.equal(result.effectiveOptions.centerOut, false);
  assert.equal(result.files.length, 3);
  assert.equal(new Set(result.files.map(file => file.name)).size, 3);
  assert(result.files.every(file => file.name.startsWith("tile") && file.name.endsWith(".nbt")));
}
const crubWater = await generateTile(request(water, { mode: "suppress_2layer", crubTech: true, layerSplit: true }));
assert.equal(crubWater.files.length, 3);
for (const maxBlockLift of [0, 1, 2, 10]) {
  const output = await generateTile(request(varied, { mode: "suppress_step_checker", maxBlockLift, jumpableTops: true }));
  assert.equal(output.effectiveOptions.jumpableTops, false); // None support cannot guarantee jumpability.
}
const fragile = await generateTile({ ...request(varied, { mode: "suppress_step_checker", maxBlockLift: 1, jumpableTops: true,
  support: "fragile", supportBlock: "resin_block", shadeBlock: "resin_clump[down=true]" }), blocks: { 11: "stone_pressure_plate" } });
assert.equal(fragile.effectiveOptions.maxBlockLift, 1);
assert.equal(fragile.effectiveOptions.jumpableTops, true);

const environmentColors = tile((x, z) => [7, 13, 25][(x + z) % 3] * 4 + (x + z) % 3);
const environmentBlocks = { 7: "oak_sapling", 13: "bamboo_sapling", 25: "tube_coral_fan[waterlogged=false]" };
for (const keepExtras of [false, true]) {
  const output = await generateTile({ colors: environmentColors, blocks: environmentBlocks,
    options: { mode: "suppress_step_checker", support: "fragile", supportBlock: "mangrove_roots[waterlogged=true]", keepExtras, assumeSupportFloor: false } });
  const nbt = unpack(output.files[0].data);
  assert(nbt.includes(Buffer.from("minecraft:tripwire")) && nbt.includes(Buffer.from("minecraft:mangrove_roots")));
  assert.equal(nbt.includes(Buffer.from("minecraft:barrier")), keepExtras);
  assert(output.warnings.some(warning => warning.code === "PLACEMENT_GROWTH_COVER"));
  assert(!output.warnings.some(warning => warning.code === "PLACEMENT_CORAL_SUPPORT"));
}
const coral = await generateTile({ colors: tile((x, z) => 100 + (x + z) % 3), blocks: { 25: environmentBlocks[25] },
  options: { mode: "suppress_2layer", layerGap: 2 } });
assert.equal(coral.effectiveOptions.layerGap, 3);
assert(coral.warnings.some(warning => warning.code === "PLACEMENT_CORAL_SUPPORT"));
const floorCoral = await generateTile({ colors: tile(() => 101), blocks: { 25: environmentBlocks[25] }, options: { mode: "flat", assumeSupportFloor: true } });
assert.deepEqual(floorCoral.warnings.filter(warning => warning.code.startsWith("PLACEMENT_")).map(w => w.code), ["PLACEMENT_CORAL_SUPPORT"]);
for (const autoPickSupports of [false, true]) {
  const output = await generateTile({ colors: tile(() => 101), blocks: { 25: environmentBlocks[25] },
    options: { mode: "flat", assumeSupportFloor: false, support: "fragile", supportBlock: "stone", autoPickSupports } });
  assert.equal(unpack(output.files[0].data).includes(Buffer.from("minecraft:mangrove_roots")), autoPickSupports);
  assert.equal(output.warnings.some(warning => warning.code === "PLACEMENT_CORAL_SUPPORT"), !autoPickSupports);
}
for (const mode of ["flat", "staircase_group", "suppress_step_checker", "suppress_2layer"] as const) {
  for (const growthCoverBlock of ["tripwire", "", "air"]) {
    const output = await generateTile({ colors: tile((x, z) => 92 + (mode === "flat" ? 1 : (x + z) % 3)),
      blocks: { 23: "twisting_vines[age=25]" }, options: { mode, growthCoverBlock, support: "fragile" } });
    const nbt = unpack(output.files[0].data);
    assert.equal(nbt.includes(Buffer.from("minecraft:tripwire")), growthCoverBlock === "tripwire", `${mode}: selected or omitted cover`);
    assert(nbt.includes(Buffer.from("age")) && nbt.includes(Buffer.from("25")), "Both modes keep the stable exported state");
    assert(!output.warnings.some(w => w.code === "PLACEMENT_MISSING_COVER" || w.code === "PLACEMENT_GROWTH_COVER"), "Vines must not report growth-cover warnings");
  }
}
for (const growthCoverBlock of ["", "air"]) {
  const mixed = await generateTile({ colors: tile((x, z) => (x % 2 ? 7 : 23) * 4 + (x + z) % 3),
    blocks: { 7: "oak_sapling", 23: "twisting_vines[age=25]" }, options: { mode: "staircase_group", growthCoverBlock, support: "fragile" } });
  assert(!unpack(mixed.files[0].data).includes(Buffer.from("minecraft:tripwire")));
  assert(mixed.warnings.some(w => w.code === "PLACEMENT_MISSING_COVER"), "Uncovered saplings still warn in a mixed palette");
}
for (const options of [{ growthCoverBlock: "cake" }, { growthCoverBlock: "stone" }]) {
  await invalid({ colors: environmentColors, blocks: environmentBlocks, options: { mode: "staircase_group", ...options } });
}

for (const options of [
  { mode: "garbage" }, { mode: "suppress_split_row" }, { minecraftVersion: "__proto__" }, { unknown: true },
  { support: "anything" }, { centerOut: 1 }, { maxBlockLift: 11 }, { maxBlockLift: NaN }, { minStepOffset: 0 },
  { minStepOffset: 21 }, { waterDrops: [1, 2] }, { layerGap: 100000 }, { layerGap: 2.5 }, { name: "ignored" },
  { westEastSlope: { run: 128, rise: 1 } }, { direction: "NS" }, { layerSplit: true }, { crubTech: true },
  { keepExtras: true }, { mode: "flat" }, { mode: "incline_up" }, { shadeBlock: "resin_clump[down=true,down=false]" },
]) await invalid(request(varied, { mode: "staircase_group", ...options } as GenerationOptions));
await invalid({ ...request(), colors: new Uint8Array(128) });
await invalid({ ...request(), colors: tile(() => 47) });
await invalid({ ...request(), colors: tile(() => 255) });
await invalid({ ...request(), blocks: {} });
await invalid({ ...request(), blocks: { 11: "dirt" } });
await invalid({ ...request(), name: "example" }, /Unknown request field/);
await invalid({ ...request(), blocks: { 11: "stone[waterlogged=true]" } });
await invalid(request(transparent, { mode: "suppress_2layer" }));
await invalid(request(water, { mode: "suppress_step_checker", direction: "north_to_south", centerOut: true }));
await invalid(null);
await invalid({ ...request(), options: null });

const first = await generateTile(request(varied, { mode: "suppress_step_checker" }));
await generateTile(request(varied, { mode: "suppress_step_checker", keepExtras: true, maxBlockLift: 1 }));
const again = await generateTile(request(varied, { mode: "suppress_step_checker" }));
assert.deepEqual(unpack(first.files[0].data), unpack(again.files[0].data), "Requests must not contaminate later defaults");
assert.equal(first.effectiveOptions.maxBlockLift, 0);
assert.equal(first.effectiveOptions.keepExtras, false);
assert(!unpack(first.files[0].data).includes(Buffer.from("minecraft:barrier")));
assert.deepEqual(varied, tile((x, z) => 44 + (x + z) % 3), "Input pixels were mutated");
console.log(`Hosted API documentation: ${documented.length} options, defaults, enums and numeric bounds match runtime behavior.`);
console.log(`Hosted API: ${comparisons} byte-equivalent exports; modes, versions, catalogs, support, water, CrubTech, reuse and validation passed.`);
