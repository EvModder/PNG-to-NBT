import assert from "node:assert/strict";
import { BASE_COLORS } from "@/data/mapColors";
import { EXCLUDED_BLOCKS } from "@/data/mapColorsExcluded";
import { BLOCK_INTRODUCTIONS, MINECRAFT_VERSIONS } from "@/data/minecraftVersions";
import { BUILTIN_PRESET_NAMES, getBuiltinPreset } from "@/data/presets";
import { STORAGE_KEYS } from "@/data/storageKeys";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { SupportMode } from "@/types/ui";
import { encodeFullPreset, decodeFullPreset, loadPresets } from "@/lib/codecPreset";
import { decodeUrlParamBytes } from "@/lib/codecUrlParam";
import { decodeColorGrid, encodeColorGrid } from "@/lib/codecColorGrid";
import { resolveAssignedColorBlock } from "@/lib/blockId";
import { Shade, type ColorGrid } from "@/types/color";
import { removeCustomColorBlock } from "@/utils/customColors";

type FullPreset = Parameters<typeof encodeFullPreset>[0];

// Fixed values make the wire fixture independent of changing application defaults.
const standard: FullPreset = {
  blockPreset: getBuiltinPreset("Fullblock")!,
  customColors: [], selectedBlocksCustom: {},
  supportFiller: "cobblestone", shadeFiller: "resin_block",
  crubTechShadeBreakableFillerBlock: "moss_block", crubTechShadePushableFillerBlock: "resin_block",
  suppress2LayerLateFillerBlock: "slime_block", dominateVoidFillerBlock: "slime_block", recessiveVoidFillerBlock: "honey_block",
  supportMode: SupportMode.None, buildMode: BuildMode.StaircaseGroup,
  proPaletteSeed: false, mixSteps: true, buildAtWorldMinY: true, crubTech: false, westEastSlopeEnabled: false,
  suppressStepDirection: SuppressStepDirection.EastToWest, vsFillerLoadSpotDirection: SuppressStepDirection.NorthToSouth,
  minecraftVersion: "26.2", suppress2LayerLatePairsGap: 1, layerGap: 5,
  lightWaterDrop: 0, flatWaterDrop: 2, darkWaterDrop: 4, westEastSlopeRun: 0, westEastSlopeRise: 0,
};

let roundTrips = 0;
const seenEscapes = new Set<string>();
async function roundTrip(preset: FullPreset): Promise<string> {
  const encoded = await encodeFullPreset(preset);
  assert.match(encoded, /^[rpz][A-Za-z0-9]+$/);
  for (const [escape] of encoded.matchAll(/Z[012]/g)) seenEscapes.add(escape);
  assert.equal(new URLSearchParams({ preset: encoded }).toString(), `preset=${encoded}`);
  assert.deepEqual(await decodeFullPreset(encoded), preset);
  ++roundTrips;
  return encoded;
}

// Display reordering must preserve normal/hidden selections and filler references.
const originalRows = BASE_COLORS.map(color => color.blocks);
const originalExcluded = EXCLUDED_BLOCKS.slice();
const hidden: FullPreset = { ...standard, blockPreset: {
  name: "Hidden", selectedBlocks: Object.fromEntries(EXCLUDED_BLOCKS.map((row, id) => [id, row.at(-1) ?? ""])),
}, supportFiller: "barrier", shadeFiller: "reinforced_deepslate" };
const standardUrl = await roundTrip(standard);
const hiddenUrl = await roundTrip(hidden);
try {
  BASE_COLORS.forEach((color, id) => {
    color.blocks = color.blocks.toReversed();
    EXCLUDED_BLOCKS[id] = EXCLUDED_BLOCKS[id].toReversed();
  });
  assert.equal(await encodeFullPreset(standard), standardUrl);
  assert.equal(await encodeFullPreset(hidden), hiddenUrl);
  assert.deepEqual(await decodeFullPreset(standardUrl), standard);
  assert.deepEqual(await decodeFullPreset(hiddenUrl), hidden);
} finally {
  BASE_COLORS.forEach((color, id) => { color.blocks = originalRows[id]; EXCLUDED_BLOCKS[id] = originalExcluded[id]; });
}

// Previous mixed text/JSON codec, measured with these same explicit settings.
const oldLengths = [360, 304, 351, 389];
for (const [index, name] of BUILTIN_PRESET_NAMES.entries()) {
  const encoded = await roundTrip({ ...standard, blockPreset: getBuiltinPreset(name)! });
  assert(encoded.length < oldLengths[index] * 0.6, `${name}: unexpectedly long preset URL`);
  console.log(`${name}: ${oldLengths[index]} -> ${encoded.length} URL characters`);
}

const versions = Object.keys(MINECRAFT_VERSIONS) as FullPreset["minecraftVersion"][];
const savedVersions = await Promise.all(versions.flatMap(minecraftVersion => [standard, hidden].map(async preset => {
  const expected = { ...preset, minecraftVersion };
  return { expected, url: await roundTrip(expected) };
})));
// Cover every indexed block, not just the built-in presets' selections.
for (const rows of [originalRows, originalExcluded]) {
  for (let option = 0; option < Math.max(...rows.map(row => row.length)); ++option) {
    const expected = { ...standard, minecraftVersion: versions.at(-1)!, blockPreset: {
      name: "Catalog coverage", selectedBlocks: Object.fromEntries(rows.map((row, id) => [id, row[option] ?? ""])),
    } };
    savedVersions.push({ expected, url: await roundTrip(expected) });
  }
}
// Simulate a site update inserting a new release's blocks throughout both lists.
// Also reverse their display order; test fresh lookups, versions and fillers.
const introductions = BLOCK_INTRODUCTIONS as [RegExp, number][];
const releases = MINECRAFT_VERSIONS as Record<string, { label: string; dataVersion: number }>;
const latestVersion = versions.at(-1)!;
const originalDataVersion = releases[latestVersion].dataVersion;
const futureDataVersion = originalDataVersion + 100;
try {
  introductions.push([/^future_insert_/, futureDataVersion]);
  releases.future = { label: "Future", dataVersion: futureDataVersion };
  BASE_COLORS.forEach((color, id) => {
    const middle = Math.floor(color.blocks.length / 2);
    color.blocks = [`future_insert_normal_${id}`, ...color.blocks.slice(0, middle), `future_insert_middle_${id}`, ...color.blocks.slice(middle)].reverse();
    const hiddenMiddle = Math.floor(EXCLUDED_BLOCKS[id].length / 2);
    EXCLUDED_BLOCKS[id] = [`future_insert_hidden_${id}`, ...EXCLUDED_BLOCKS[id].slice(0, hiddenMiddle), `future_insert_hidden_middle_${id}`, ...EXCLUDED_BLOCKS[id].slice(hiddenMiddle)].reverse();
  });
  for (const { expected, url } of savedVersions) {
    assert.deepEqual(await decodeFullPreset(url), expected);
    assert.equal(await encodeFullPreset(expected), url);
  }
  await roundTrip({ ...standard, minecraftVersion: "future" as FullPreset["minecraftVersion"], blockPreset: {
    ...standard.blockPreset, selectedBlocks: { ...standard.blockPreset.selectedBlocks, 18: "future_insert_normal_18", 19: "future_insert_hidden_19" },
  }, supportFiller: "future_insert_middle_20", shadeFiller: "future_insert_hidden_21" });

  // A future release could instead extend the last UI range. Its new endpoint
  // must not change the availability cutoff recorded in an already-shared URL.
  delete releases.future;
  releases[latestVersion].dataVersion = futureDataVersion;
  for (const { expected, url } of savedVersions) assert.deepEqual(await decodeFullPreset(url), expected);
} finally {
  introductions.pop();
  delete releases.future;
  releases[latestVersion].dataVersion = originalDataVersion;
  BASE_COLORS.forEach((color, id) => { color.blocks = originalRows[id]; EXCLUDED_BLOCKS[id] = originalExcluded[id]; });
}

const directions = Object.values(SuppressStepDirection);
const integers = [0, 1, 127, 128, 16383, 16384, 2 ** 32, Number.MAX_SAFE_INTEGER];
let index = 0;
for (const buildMode of Object.values(BuildMode)) {
  for (const supportMode of Object.values(SupportMode)) {
    for (const minecraftVersion of versions) {
      const flags = index % 32;
      await roundTrip({
        ...standard, buildMode, supportMode, minecraftVersion,
        proPaletteSeed: !!(flags & 1), mixSteps: !!(flags & 2), buildAtWorldMinY: !!(flags & 4),
        crubTech: !!(flags & 8), westEastSlopeEnabled: !!(flags & 16),
        suppressStepDirection: directions[index % 4], vsFillerLoadSpotDirection: directions[Math.floor(index / 4) % 4],
        layerGap: integers[index % integers.length], lightWaterDrop: 7, flatWaterDrop: 14, darkWaterDrop: 24,
        suppress2LayerLatePairsGap: 10, westEastSlopeRun: 128, westEastSlopeRise: index % 2 ? -16384 : 16384,
      });
      ++index;
    }
  }
}

// Cover all normal/hidden references, including version-limited states and fillers.
for (const rows of [BASE_COLORS.map(color => color.blocks), EXCLUDED_BLOCKS]) {
  for (let option = 0; option < Math.max(...rows.map(row => row.length)); ++option) {
    await roundTrip({ ...standard, minecraftVersion: latestVersion, blockPreset: {
      name: "Catalog", selectedBlocks: Object.fromEntries(rows.map((row, id) => [id, row[option] ?? ""])),
    }, supportFiller: rows.flat()[option] ?? "" });
  }
}

const custom: FullPreset = {
  ...standard,
  blockPreset: {
    name: "\uFEFFCustom | : , ; % \0 \u00e9 \u5730\u56fe \ud83c\udf0a",
    selectedBlocks: {
      ...standard.blockPreset.selectedBlocks,
      0: "glass_pane[east=true,west=true]", 11: "piston[facing=up]", 28: "example:ruby[axis=x,variant=red]",
    },
  },
  supportFiller: "example:support[a=b,c=d]", shadeFiller: "", crubTechShadeBreakableFillerBlock: "minecraft:air",
  customColors: [
    { r: 0, g: 127, b: 255, blocks: ["example:ruby", "example:ruby[axis=x,lit=true]"] },
    { r: 123, g: 45, b: 67, blocks: ["example:other"] },
    { r: 0, g: 0, b: 0, blocks: [] },
  ],
  selectedBlocksCustom: { 0: "example:ruby[axis=x,lit=true]", 1: "", 2: "" },
};
await roundTrip(custom);
// Custom choices have their own order/indices, unrelated to the vanilla catalog
// and its version filtering. Base-palette RGB extensions must keep both mappings.
const extended: FullPreset = { ...custom, blockPreset: {
  ...custom.blockPreset, selectedBlocks: { ...custom.blockPreset.selectedBlocks, 11: "example:stone[variant=rough,axis=x]" },
}, customColors: [...custom.customColors, {
  r: 112, g: 112, b: 112, blocks: ["example:stone[variant=rough,axis=x]", "example:stone[variant=smooth]"],
}], selectedBlocksCustom: { ...custom.selectedBlocksCustom, 3: "example:stone[variant=rough,axis=x]" } };
for (const minecraftVersion of versions) await roundTrip({ ...extended, minecraftVersion });
const extendedUrl = await encodeFullPreset(extended);
try {
  BASE_COLORS.forEach(color => { color.blocks = color.blocks.toReversed(); });
  EXCLUDED_BLOCKS.forEach((row, id) => { EXCLUDED_BLOCKS[id] = row.toReversed(); });
  assert.equal(await encodeFullPreset(extended), extendedUrl);
  assert.deepEqual(await decodeFullPreset(extendedUrl), extended);
} finally {
  BASE_COLORS.forEach((color, id) => { color.blocks = originalRows[id]; EXCLUDED_BLOCKS[id] = originalExcluded[id]; });
}
const manyCustom: FullPreset = { ...standard,
  customColors: Array.from({ length: 300 }, (_, id) => ({
    r: 1 + Math.floor(id / 256), g: id % 256, b: 149,
    blocks: Array.from({ length: id === 299 ? 130 : 2 }, (_, option) => `example:block_${id}[variant=${option}]`),
  })),
  selectedBlocksCustom: Object.fromEntries(Array.from({ length: 300 }, (_, id) => [id,
    id % 3 === 0 ? "" : `example:block_${id}[variant=${id === 299 ? 129 : 1}]`,
  ])),
};
await roundTrip(manyCustom);
// A mixed shared image must retain custom IDs above one-byte boundaries, all
// three shades, and the distinction between custom and ordinary map-color IDs.
const sharedGrid: ColorGrid = Array.from({ length: 128 }, (_, x) => Array.from({ length: 128 }, (_, z) => ({
  id: x % 2 ? 299 : 11, isCustom: x % 2 === 1, shade: [Shade.Dark, Shade.Flat, Shade.Light][z % 3],
})));
const decodedGrid = await decodeColorGrid(await encodeColorGrid(sharedGrid));
assert.deepEqual(decodedGrid, sharedGrid);
const decodedMany = await decodeFullPreset(await encodeFullPreset(manyCustom));
assert(decodedMany);
assert.equal(resolveAssignedColorBlock(decodedGrid![1][0], {
  selectedBlocks: decodedMany.blockPreset.selectedBlocks, customColors: decodedMany.customColors,
  selectedBlocksCustom: decodedMany.selectedBlocksCustom,
}), "example:block_299[variant=129]");
const removed = removeCustomColorBlock(extended.customColors, extended.selectedBlocksCustom, 1, "example:other");
const afterRemoval = { ...extended, customColors: [...removed.customColors], selectedBlocksCustom: removed.selectedBlocksCustom };
await roundTrip(afterRemoval);
assert.equal(afterRemoval.selectedBlocksCustom[2], extended.selectedBlocksCustom[3]);
assert.deepEqual(afterRemoval.customColors[2], extended.customColors[3]);
await roundTrip({ ...custom, blockPreset: { ...custom.blockPreset, name: "Long name ".repeat(1000) } });
await roundTrip({ ...standard, westEastSlopeRise: -(2 ** 52) });

// Only explicit shared fields are serialized, never stray device preferences.
assert.equal(await encodeFullPreset({ ...standard, autoFixInvalidColors: true, belowPlatformWater: true } as FullPreset), await encodeFullPreset(standard));
const defaultSelection = { ...custom, selectedBlocksCustom: {} };
const decodedDefault = await decodeFullPreset(await encodeFullPreset(defaultSelection));
assert.deepEqual(decodedDefault?.selectedBlocksCustom, { 0: custom.customColors[0].blocks[0], 1: "example:other", 2: "" });

// A simple all-empty fixture makes byte offsets explicit for corruption checks.
const empty: FullPreset = {
  ...standard,
  blockPreset: { name: "", selectedBlocks: Object.fromEntries(BASE_COLORS.map((_, id) => [id, ""])) },
  supportFiller: "", shadeFiller: "", crubTechShadeBreakableFillerBlock: "", crubTechShadePushableFillerBlock: "",
  suppress2LayerLateFillerBlock: "", dominateVoidFillerBlock: "", recessiveVoidFillerBlock: "",
};
const emptyEncoded = await roundTrip(empty);
const bytes = (await decodeUrlParamBytes(emptyEncoded.replace(/Z([012])/g, (_, digit) => "Z-_"[Number(digit)])))!;
// Pin field/enum order, not mutable catalog positions or compressor-specific output.
assert.equal(Buffer.from(bytes).toString("hex"),
  "02a726" + "00".repeat(64) + "06000000000000000007000201050002040000");
const compression = Object.getOwnPropertyDescriptor(globalThis, "CompressionStream");
try {
  Object.defineProperty(globalThis, "CompressionStream", { configurable: true, value: undefined });
  const fallback = await roundTrip(empty);
  assert.match(fallback, /^[rp]/);
} finally {
  if (compression) Object.defineProperty(globalThis, "CompressionStream", compression);
  else Reflect.deleteProperty(globalThis, "CompressionStream");
}
const raw = (bytes: Uint8Array) => `r${Buffer.from(bytes).toString("base64url").replace(/[Z_-]/g, char => `Z${"Z-_".indexOf(char)}`)}`;

// TEMP: published text URLs remain readable, but never restore their retired
// import-policy setting or supply values for settings the old format omitted.
const legacySections = [
  "Published preset", BASE_COLORS.map(() => "-").join(","),
  "cobblestone", "resin_block", "none", "suppress_2layer",
  "1,2,3:example%3Aruby:example%3Aruby,glass", "1", "slime_block", "0",
  "slime_block", "honey_block", "1", "0", "0", "east_to_west", "moss_block", "resin_block", "g3",
];
legacySections[1] = legacySections[1].replace("-", "0");
const legacyRaw = (text: string) => `r${Buffer.from(text).toString("base64url")}`;
const legacy = await decodeFullPreset(legacyRaw(legacySections.join("|")));
assert.deepEqual(legacy, {
  blockPreset: { name: "Published preset", selectedBlocks: { ...empty.blockPreset.selectedBlocks, 0: BASE_COLORS[0].blocks[0] } },
  customColors: [{ r: 1, g: 2, b: 3, blocks: ["example:ruby", "glass"] }], selectedBlocksCustom: { 0: "example:ruby" },
  supportFiller: "cobblestone", shadeFiller: "resin_block", supportMode: SupportMode.None, buildMode: BuildMode.Suppress2Layer,
  suppress2LayerLateFillerBlock: "slime_block", proPaletteSeed: false, dominateVoidFillerBlock: "slime_block",
  recessiveVoidFillerBlock: "honey_block", mixSteps: true, buildAtWorldMinY: false, crubTech: false,
  suppressStepDirection: SuppressStepDirection.EastToWest, crubTechShadeBreakableFillerBlock: "moss_block",
  crubTechShadePushableFillerBlock: "resin_block", suppress2LayerLatePairsGap: 3,
});
await roundTrip({ ...standard, ...legacy! });
const published = await decodeFullPreset("zVY3BCsJADER_xZuXEbLbtfUsePcPSluCFtvd0qxKIR8v21apDCSTzAu5vPayO4e4u44sHPUAA-NAqcEgw-wz5HDIU2IdCriNCpzgEmIIlhKSDgmEAoQcx9kvsj-XiIVK_LfO0ibUdccSg2cdWVpf1l1oHurTQp7DMLJIabtq4lHVqHRtzytDf9M9eJ5Wb5SUlCuJZQzlmyVqH0TWdPvnZj4");
assert.equal(published?.blockPreset.name, "Ev's Bot Preset");
assert.equal(published?.blockPreset.selectedBlocks[12], "jungle_leaves[waterlogged=true]");
assert.equal(published?.buildMode, BuildMode.Suppress2Layer);
assert.equal(published?.buildAtWorldMinY, false);
assert.equal(published?.minecraftVersion, undefined);
assert.equal(published && "autoFixInvalidColors" in published, false);
await roundTrip({ ...standard, ...published! });
for (const [id, index, block] of [
  [11, 8, "smooth_stone_slab"], [11, 17, "gravel"],
  [18, 11, "bamboo_mosaic"], [15, 30, "waxed_copper_grate"],
] as const) {
  const selections = BASE_COLORS.map(() => "-"); selections[id] = String(index);
  const decoded = await decodeFullPreset(legacyRaw(`Published ordering|${selections.join(",")}`));
  assert.equal(decoded?.blockPreset.selectedBlocks[id], block);
}
assert.equal(await decodeFullPreset("zHcYhDoNAEAXQ2f93Z03cggWBoJa73IAHNBSoq0CRAeo5KPJLLcKQGnnquZ2Z1xn2X1fS9NOazPM4zKuwoohRJ8AFAlmZ1jSrNYPm8Z0EzAZ0nB46KeBO9CeYWi740Z2bDx48HQSBXRB4EXZ1"), null);
for (const [section, value] of [[1, "999"], [4, "invalid"], [5, "invalid"], [6, "256,2,3::glass"], [6, "1,2,3:%xx:glass"], [12, "invalid"], [15, "invalid"], [18, "g-1"]] as const) {
  const invalid = legacySections.slice(); invalid[section] = value;
  assert.equal(await decodeFullPreset(legacyRaw(invalid.join("|"))), null);
}

for (let length = 0; length < bytes.length; ++length) {
  assert.equal(await decodeFullPreset(raw(bytes.subarray(0, length))), null, `truncated at ${length}`);
}
const flagsOffset = 4 + BASE_COLORS.length + 1;
for (const [offset, value] of [[0, 1], [0, 255], [1, 0], [2, 127], [3, 1], [4, 255], [flagsOffset, 128], [flagsOffset + 8, 255], [flagsOffset + 9, 255]]) {
  const corrupt = bytes.slice(); corrupt[offset] = value;
  assert.equal(await decodeFullPreset(raw(corrupt)), null, `corrupt offset ${offset}`);
}
assert.equal(await decodeFullPreset(raw(Uint8Array.from([...bytes, 0]))), null);
// Invalid lengths, UTF-8, overlong and overflowing varints.
for (const nameBytes of [[255, 255, 255, 255, 127], [128, 0], [1, 255], Array(9).fill(255)]) {
  assert.equal(await decodeFullPreset(raw(Uint8Array.from([...bytes.subarray(0, 3), ...nameBytes, ...bytes.subarray(4)]))), null);
}
for (const malformed of ["", "r%%%", "zAAAA", "xAA", `${emptyEncoded}Z`, `${emptyEncoded}Z3`, `${emptyEncoded}Za`, `${emptyEncoded}-`, `${emptyEncoded}_`, raw(new TextEncoder().encode("Old preset|0,1,2|{}"))]) {
  assert.equal(await decodeFullPreset(malformed), null);
}
for (const invalid of [
  { layerGap: -1 }, { flatWaterDrop: 0.5 }, { darkWaterDrop: Infinity }, { westEastSlopeRise: Number.MAX_SAFE_INTEGER },
  { proPaletteSeed: undefined }, { buildMode: "unknown" }, { minecraftVersion: "unknown" },
  { blockPreset: { ...standard.blockPreset, name: "\ud800" } },
  { customColors: [{ r: 256, g: 0, b: 0, blocks: [] }] },
]) {
  await assert.rejects(encodeFullPreset({ ...standard, ...invalid } as FullPreset));
}

// Local saved presets still use JSON and keep their existing custom colors/states.
const saved = { ...custom.blockPreset, customColors: custom.customColors, selectedBlocksCustom: custom.selectedBlocksCustom };
const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let storedPresets: unknown = [saved];
try {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => key === STORAGE_KEYS.presets ? JSON.stringify(storedPresets) : null,
  } });
  assert.deepEqual(loadPresets().at(-1), saved);
  storedPresets = [null, { name: 42 }, { name: "Broken", selectedBlocks: [] }, saved];
  assert.deepEqual(loadPresets().slice(BUILTIN_PRESET_NAMES.length), [saved], "A malformed record must not discard other saved presets");
  BASE_COLORS.forEach(color => { color.blocks = [...color.blocks].reverse(); });
  EXCLUDED_BLOCKS.forEach((row, id) => { EXCLUDED_BLOCKS[id] = [...row].reverse(); });
  assert.deepEqual(loadPresets().at(-1), saved, "Local presets store names, not catalog positions");
} finally {
  BASE_COLORS.forEach((color, id) => { color.blocks = originalRows[id]; EXCLUDED_BLOCKS[id] = originalExcluded[id]; });
  if (storage) Object.defineProperty(globalThis, "localStorage", storage);
  else Reflect.deleteProperty(globalThis, "localStorage");
}
assert.deepEqual([...seenEscapes].sort(), ["Z0", "Z1", "Z2"]);
console.log(`${roundTrips} preset round-trips, malformed payload rejection, and local JSON storage checks passed.`);
