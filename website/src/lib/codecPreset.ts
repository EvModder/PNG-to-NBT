/**
 * Public API:
 * - encodeFullPreset()
 * - decodeFullPreset()
 * - loadPresets()
 *
 * Callers:
 * - src/Index.tsx
 */
import { BASE_COLORS } from "@/data/mapColors";
import { EXCLUDED_BLOCKS } from "@/data/mapColorsExcluded";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import { STORAGE_KEYS } from "@/data/storageKeys";
import { BUILTIN_PRESET_NAMES, getBuiltinPreset, type BlockPreset } from "@/data/presets";
import type { ColorRgb } from "@/types/color";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { SupportMode } from "@/types/ui";
import { decodeUrlParamBytes, encodeUrlParamBytes } from "@/lib/codecUrlParam";
import { getSelectedCustomColorBlock } from "@/utils/customColors";
import { isBlockAvailable } from "@/lib/minecraftVersion";

interface SharedSettings {
  supportFiller: string;
  shadeFiller: string;
  crubTechShadeBreakableFillerBlock: string;
  crubTechShadePushableFillerBlock: string;
  supportMode: SupportMode;
  buildMode: BuildMode;
  suppress2LayerLateFillerBlock: string;
  suppress2LayerLatePairsGap: number;
  proPaletteSeed: boolean;
  mixSteps: boolean;
  buildAtWorldMinY: boolean;
  crubTech: boolean;
  suppressStepDirection: SuppressStepDirection;
  dominateVoidFillerBlock: string;
  recessiveVoidFillerBlock: string;
  layerGap: number;
  vsFillerLoadSpotDirection: SuppressStepDirection;
  lightWaterDrop: number;
  flatWaterDrop: number;
  darkWaterDrop: number;
  // Version is the only shared secret setting; block availability depends on it.
  minecraftVersion: MinecraftVersion;
  westEastSlopeEnabled: boolean;
  westEastSlopeRun: number;
  westEastSlopeRise: number;
}

interface FullPreset extends SharedSettings {
  blockPreset: BlockPreset;
  customColors: ColorRgb[];
  selectedBlocksCustom: Record<number, string>;
}

const FORMAT_VERSION = 1;
// Alphanumeric transport: Z0 = Z, Z1 = -, Z2 = _. Escape Z itself to avoid ambiguity.
const TRANSPORT_ESCAPES = "Z-_";
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Positions are relative to the URL's exact DataVersion, not today's dropdown
// range endpoint. Future-version insertions cannot shift older URLs' indices.
// Reordering/removing existing entries or moving them between lists still breaks
// affected links. Preserve canonical names/color rows; UI adaptations are separate.
function getPresetCatalog(dataVersion: number) {
  const filter = (row: readonly string[]) => row.filter(block => isBlockAvailable(block, dataVersion));
  return { blocks: BASE_COLORS.map(color => filter(color.blocks)), excluded: EXCLUDED_BLOCKS.map(filter) };
}
type PresetCatalog = ReturnType<typeof getPresetCatalog>;

class PresetWriter {
  readonly bytes: number[] = [];

  byte(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error("Invalid preset byte");
    this.bytes.push(value);
  }

  uint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid preset integer");
    while (value >= 128) {
      this.byte((value % 128) | 128);
      value = Math.floor(value / 128);
    }
    this.byte(value);
  }

  text(value: string): void {
    if (typeof value !== "string" || !value.isWellFormed()) throw new Error("Invalid preset string");
    const bytes = TEXT_ENCODER.encode(value);
    this.uint(bytes.length);
    for (const byte of bytes) this.byte(byte);
  }

  block(value: string, catalog: readonly string[], excluded: readonly string[] = []): void {
    if (typeof value !== "string") throw new Error("Invalid preset block");
    const normalIndex = catalog.indexOf(value);
    const index = normalIndex >= 0 ? normalIndex : excluded.indexOf(value);
    // 0: unassigned, 1: literal; 2+: index with a low bit for the hidden list.
    this.uint(value === "" ? 0 : index < 0 ? 1 : 2 + index * 2 + Number(normalIndex < 0));
    if (value !== "" && index < 0) this.text(value);
  }
}

class PresetReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get remaining(): number { return this.bytes.length - this.offset; }

  byte(): number {
    if (!this.remaining) throw new Error("Truncated preset");
    return this.bytes[this.offset++];
  }

  uint(): number {
    let value = 0;
    for (let shift = 0; shift <= 49; shift += 7) {
      const byte = this.byte();
      value += (byte & 127) * 2 ** shift;
      if (!Number.isSafeInteger(value)) break;
      if (byte < 128) {
        if (shift > 0 && byte === 0) break;
        return value;
      }
    }
    throw new Error("Invalid preset integer");
  }

  count(): number {
    const value = this.uint();
    // Every counted item consumes at least one byte. Bound loops before allocating.
    if (value > this.remaining) throw new Error("Invalid preset count");
    return value;
  }

  text(): string {
    const length = this.count();
    const value = TEXT_DECODER.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  block(catalog: readonly string[], excluded: readonly string[] = []): string {
    const token = this.uint();
    if (token === 0) return "";
    if (token === 1) return this.text();
    const block = (token % 2 ? excluded : catalog)[Math.floor((token - 2) / 2)];
    if (block === undefined) throw new Error("Invalid preset block reference");
    return block;
  }
}

type ValueCodec<T> = {
  write: (writer: PresetWriter, value: T, catalog: PresetCatalog) => void;
  read: (reader: PresetReader, catalog: PresetCatalog) => T;
};
const integer: ValueCodec<number> = { write: (writer, value) => writer.uint(value), read: reader => reader.uint() };
const signedInteger: ValueCodec<number> = {
  write: (writer, value) => {
    if (!Number.isSafeInteger(value)) throw new Error("Invalid signed preset integer");
    writer.uint(value < 0 ? -value * 2 - 1 : value * 2);
  },
  read: reader => { const value = reader.uint(); return value % 2 ? -(value + 1) / 2 : value / 2; },
};
const block: ValueCodec<string> = {
  write: (writer, value, catalog) => {
    const id = catalog.blocks.findIndex((row, id) => row.includes(value) || catalog.excluded[id].includes(value));
    writer.uint(value === "" ? 0 : id < 0 ? 1 : id + 2);
    if (value === "") return;
    if (id < 0) writer.text(value);
    else writer.block(value, catalog.blocks[id], catalog.excluded[id]);
  },
  read: (reader, catalog) => {
    const token = reader.uint();
    if (token === 0) return "";
    if (token === 1) return reader.text();
    const id = token - 2;
    if (!catalog.blocks[id]) throw new Error("Invalid preset color reference");
    return reader.block(catalog.blocks[id], catalog.excluded[id]);
  },
};
function enumCodec<T extends string>(values: readonly T[]): ValueCodec<T> {
  return {
    write: (writer, value) => writer.uint(values.indexOf(value)),
    read: reader => {
      const value = values[reader.uint()];
      if (value === undefined) throw new Error("Invalid preset enum");
      return value;
    },
  };
}

type BooleanKey = { [K in keyof SharedSettings]: SharedSettings[K] extends boolean ? K : never }[keyof SharedSettings];
type ValueKey = Exclude<keyof SharedSettings, BooleanKey | "minecraftVersion">;

// Wire schema: retain bit positions, field order and enum order, or bump FORMAT_VERSION.
const BOOLEAN_BITS: Record<BooleanKey, number> = {
  proPaletteSeed: 1,
  mixSteps: 2,
  buildAtWorldMinY: 4,
  crubTech: 8,
  westEastSlopeEnabled: 16,
};
const direction = enumCodec([
  SuppressStepDirection.EastToWest, SuppressStepDirection.WestToEast,
  SuppressStepDirection.NorthToSouth, SuppressStepDirection.SouthToNorth,
]);
const VALUE_CODECS: { [K in ValueKey]: ValueCodec<SharedSettings[K]> } = {
  supportFiller: block,
  shadeFiller: block,
  crubTechShadeBreakableFillerBlock: block,
  crubTechShadePushableFillerBlock: block,
  suppress2LayerLateFillerBlock: block,
  dominateVoidFillerBlock: block,
  recessiveVoidFillerBlock: block,
  supportMode: enumCodec([SupportMode.None, SupportMode.All, SupportMode.Steps, SupportMode.Fragile, SupportMode.Water]),
  buildMode: enumCodec([
    BuildMode.Flat, BuildMode.InclineUp, BuildMode.InclineDown,
    BuildMode.StaircaseNorthline, BuildMode.StaircaseSouthline, BuildMode.StaircaseClassic,
    BuildMode.StaircaseValley, BuildMode.StaircaseGroup, BuildMode.StaircaseParty,
    BuildMode.SuppressSplitRow, BuildMode.SuppressSplitChecker,
    BuildMode.SuppressStepPairs, BuildMode.SuppressStepChecker, BuildMode.Suppress2Layer,
    BuildMode.Suppress2LayerLateFillers, BuildMode.Suppress2LayerLatePairs,
  ]),
  suppressStepDirection: direction,
  vsFillerLoadSpotDirection: direction,
  suppress2LayerLatePairsGap: integer,
  layerGap: integer,
  lightWaterDrop: integer,
  flatWaterDrop: integer,
  darkWaterDrop: integer,
  westEastSlopeRun: integer,
  westEastSlopeRise: signedInteger,
};
const BOOLEAN_KEYS = Object.keys(BOOLEAN_BITS) as BooleanKey[];
const VALUE_KEYS = Object.keys(VALUE_CODECS) as ValueKey[];
const BOOLEAN_MASK = Object.values(BOOLEAN_BITS).reduce((mask, bit) => mask | bit, 0);

function writeSetting<K extends ValueKey>(writer: PresetWriter, preset: SharedSettings, key: K, catalog: PresetCatalog): void {
  VALUE_CODECS[key].write(writer, preset[key], catalog);
}
function readSetting<K extends ValueKey>(reader: PresetReader, preset: SharedSettings, key: K, catalog: PresetCatalog): void {
  preset[key] = VALUE_CODECS[key].read(reader, catalog);
}

// Callers:
// - src/Index.tsx
export async function encodeFullPreset(preset: FullPreset): Promise<string> {
  const dataVersion = MINECRAFT_VERSIONS[preset.minecraftVersion]?.dataVersion;
  if (dataVersion === undefined) throw new Error("Invalid preset Minecraft version");
  const catalog = getPresetCatalog(dataVersion);
  const writer = new PresetWriter();
  writer.byte(FORMAT_VERSION);
  writer.uint(dataVersion);
  writer.text(preset.blockPreset.name);
  catalog.blocks.forEach((row, id) => writer.block(preset.blockPreset.selectedBlocks[id] ?? "", row, catalog.excluded[id]));
  writer.uint(preset.customColors.length);
  preset.customColors.forEach((color, id) => {
    writer.byte(color.r);
    writer.byte(color.g);
    writer.byte(color.b);
    writer.uint(color.blocks.length);
    for (const value of color.blocks) writer.text(value);
    writer.block(getSelectedCustomColorBlock(preset.selectedBlocksCustom, id, preset.customColors), color.blocks);
  });
  let flags = 0;
  for (const key of BOOLEAN_KEYS) {
    if (typeof preset[key] !== "boolean") throw new Error("Invalid preset boolean");
    if (preset[key]) flags |= BOOLEAN_BITS[key];
  }
  writer.byte(flags);
  for (const key of VALUE_KEYS) writeSetting(writer, preset, key, catalog);
  const encoded = await encodeUrlParamBytes(Uint8Array.from(writer.bytes));
  return encoded.replace(/[Z_-]/g, char => `Z${TRANSPORT_ESCAPES.indexOf(char)}`);
}

async function decodeBinaryPreset(encoded: string): Promise<FullPreset | null> {
  try {
    if (!/^[A-Za-z0-9]+$/.test(encoded)) return null;
    const unescaped = encoded.replace(/Z(.)?/g, (_, digit: string) => {
      const index = "012".indexOf(digit);
      if (index < 0) throw new Error("Invalid preset escape");
      return TRANSPORT_ESCAPES[index];
    });
    const bytes = await decodeUrlParamBytes(unescaped);
    if (!bytes) return null;
    const reader = new PresetReader(bytes);
    if (reader.byte() !== FORMAT_VERSION) return null;
    const dataVersion = reader.uint();
    const versions = Object.keys(MINECRAFT_VERSIONS) as MinecraftVersion[];
    if (dataVersion < MINECRAFT_VERSIONS[versions[0]].dataVersion) return null;
    const minecraftVersion = versions.find(version => MINECRAFT_VERSIONS[version].dataVersion >= dataVersion);
    if (!minecraftVersion) return null;
    const catalog = getPresetCatalog(dataVersion);
    const name = reader.text();
    const selectedBlocks = Object.fromEntries(catalog.blocks.map((row, id) => [id, reader.block(row, catalog.excluded[id])]));
    const customColors: ColorRgb[] = [];
    const selectedBlocksCustom: Record<number, string> = {};
    const count = reader.count();
    for (let id = 0; id < count; ++id) {
      const r = reader.byte(), g = reader.byte(), b = reader.byte();
      const blockCount = reader.count();
      const blocks = Array.from({ length: blockCount }, () => reader.text());
      const selected = reader.block(blocks);
      if (selected !== "" && !blocks.includes(selected)) return null;
      customColors.push({ r, g, b, blocks });
      selectedBlocksCustom[id] = selected;
    }
    const flags = reader.byte();
    if (flags & ~BOOLEAN_MASK) return null;
    // Every required field is assigned by the schema before returning.
    const settings = { minecraftVersion } as SharedSettings;
    for (const key of BOOLEAN_KEYS) settings[key] = !!(flags & BOOLEAN_BITS[key]);
    for (const key of VALUE_KEYS) readSetting(reader, settings, key, catalog);
    if (reader.remaining !== 0) return null;
    return { blockPreset: { name, selectedBlocks }, customColors, selectedBlocksCustom, ...settings };
  } catch {
    return null;
  }
}

type ImportedPreset = Pick<FullPreset, "blockPreset" | "customColors" | "selectedBlocksCustom"> & Partial<SharedSettings>;

// TEMP: read the published pipe-delimited format during the binary URL rollout.
// Remove this fallback after migration; unpushed binary revisions are unsupported.
// Restore positions from the published catalog before slabs, mosaic and grates
// moved to hidden lists. These entries are legacy-only, never binary URL indices.
const LEGACY_HIDDEN_POSITIONS: Partial<Record<number, [number, string][]>> = {
  2: [[2, "sandstone_slab"], [4, "cut_sandstone_slab"], [6, "smooth_sandstone_slab"], [12, "end_stone_brick_slab"], [20, "birch_slab"]],
  10: [[3, "granite_slab"], [5, "polished_granite_slab"], [12, "jungle_slab"]],
  11: [[1, "cobblestone_slab"], [3, "mossy_cobblestone_slab"], [5, "stone_slab"], [8, "smooth_stone_slab"], [10, "stone_brick_slab"], [12, "mossy_stone_brick_slab"], [14, "andesite_slab"], [16, "polished_andesite_slab"]],
  13: [[5, "oak_slab"]],
  14: [[3, "smooth_quartz_slab"], [5, "quartz_slab"], [7, "diorite_slab"], [9, "polished_diorite_slab"], [13, "pale_oak_slab"]],
  15: [[11, "acacia_slab"], [19, "red_sandstone_slab"], [21, "cut_red_sandstone_slab"], [23, "smooth_red_sandstone_slab"], [29, "waxed_cut_copper_slab"], [30, "waxed_copper_grate"]],
  16: [[9, "purpur_slab"]],
  18: [[10, "bamboo_slab"], [11, "bamboo_mosaic"], [12, "bamboo_mosaic_slab"], [19, "sulfur_slab"], [21, "polished_sulfur_slab"], [23, "sulfur_brick_slab"]],
  23: [[8, "prismarine_slab"]],
  26: [[12, "dark_oak_slab"]],
  28: [[8, "brick_slab"], [19, "mangrove_slab"], [23, "cinnabar_slab"], [25, "polished_cinnabar_slab"], [27, "cinnabar_brick_slab"]],
  29: [[11, "blackstone_slab"], [13, "polished_blackstone_slab"], [16, "polished_blackstone_brick_slab"]],
  31: [[2, "prismarine_brick_slab"], [4, "dark_prismarine_slab"]],
  34: [[6, "spruce_slab"]],
  35: [[2, "nether_brick_slab"], [4, "red_nether_brick_slab"]],
  36: [[5, "cherry_slab"]],
  37: [[4, "resin_brick_slab"]],
  43: [[3, "tuff_slab"], [5, "polished_tuff_slab"], [7, "tuff_brick_slab"]],
  44: [[3, "waxed_exposed_cut_copper_slab"], [5, "mud_brick_slab"], [6, "waxed_exposed_copper_grate"]],
  53: [[3, "crimson_slab"]],
  55: [[3, "waxed_oxidized_cut_copper_slab"], [4, "waxed_oxidized_copper_grate"], [7, "oxidized_cut_copper_slab"], [8, "oxidized_copper_grate"]],
  56: [[3, "warped_slab"], [7, "waxed_weathered_cut_copper_slab"], [8, "waxed_weathered_copper_grate"]],
  59: [[2, "cobbled_deepslate_slab"], [4, "polished_deepslate_slab"], [6, "deepslate_brick_slab"], [8, "deepslate_tile_slab"]],
};

async function decodeLegacyPreset(encoded: string): Promise<ImportedPreset | null> {
  try {
    const bytes = await decodeUrlParamBytes(encoded);
    if (!bytes) return null;
    const sections = TEXT_DECODER.decode(bytes).split("|");
    if (sections.length < 2 || sections.length > 19) return null;
    const selections = sections[1].split(",");
    if (selections.length !== BASE_COLORS.length) return null;
    const selectedBlocks = Object.fromEntries(selections.map((part, id) => {
      if (part === "-" || part === "") return [id, ""];
      if (part.startsWith("=")) return [id, part.slice(1)];
      const row = BASE_COLORS[id].blocks.slice();
      for (const [index, block] of LEGACY_HIDDEN_POSITIONS[id] ?? []) row.splice(index, 0, block);
      if (!/^\d+$/.test(part) || !row[Number(part)]) throw new Error("Invalid legacy block");
      return [id, row[Number(part)]];
    }));
    const customColors: ColorRgb[] = [];
    const selectedBlocksCustom: Record<number, string> = {};
    for (const entry of sections[6] ? sections[6].split(";") : []) {
      const parts = entry.split(":");
      if (parts.length !== 3) return null;
      const rgb = parts[0].split(",").map(Number);
      if (rgb.length !== 3 || rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
      const blocks = parts[2].split(",").filter(Boolean).map(decodeURIComponent);
      const selected = decodeURIComponent(parts[1]);
      if (selected !== "" && !blocks.includes(selected)) return null;
      selectedBlocksCustom[customColors.length] = selected;
      customColors.push({ r: rgb[0], g: rgb[1], b: rgb[2], blocks });
    }
    const settings: Partial<SharedSettings> = {};
    for (const [key, index] of [
      ["supportFiller", 2], ["shadeFiller", 3], ["suppress2LayerLateFillerBlock", 8],
      ["dominateVoidFillerBlock", 10], ["recessiveVoidFillerBlock", 11],
      ["crubTechShadeBreakableFillerBlock", 16], ["crubTechShadePushableFillerBlock", 17],
    ] as const) {
      if (sections[index] !== undefined) settings[key] = sections[index];
    }
    for (const [key, index] of [["proPaletteSeed", 9], ["mixSteps", 12], ["buildAtWorldMinY", 13], ["crubTech", 14]] as const) {
      if (sections[index] === "0" || sections[index] === "1") settings[key] = sections[index] === "1";
      else if (sections[index]) return null;
    }
    if (sections[4]) {
      if (!Object.values(SupportMode).includes(sections[4] as SupportMode)) return null;
      settings.supportMode = sections[4] as SupportMode;
    }
    if (sections[5]) {
      if (!Object.values(BuildMode).includes(sections[5] as BuildMode)) return null;
      settings.buildMode = sections[5] as BuildMode;
    }
    if (sections[15]) {
      if (!Object.values(SuppressStepDirection).includes(sections[15] as SuppressStepDirection)) return null;
      settings.suppressStepDirection = sections[15] as SuppressStepDirection;
    }
    if (sections[18]) {
      if (!/^g\d+$/.test(sections[18])) return null;
      settings.suppress2LayerLatePairsGap = Number(sections[18].slice(1));
      if (!Number.isSafeInteger(settings.suppress2LayerLatePairsGap)) return null;
    }
    // Do not restore the retired import-policy field (section 7) or invent values
    // for settings absent from the old format, including Minecraft version.
    return { blockPreset: { name: sections[0], selectedBlocks }, customColors, selectedBlocksCustom, ...settings };
  } catch {
    return null;
  }
}

// Callers:
// - src/Index.tsx
export async function decodeFullPreset(encoded: string): Promise<ImportedPreset | null> {
  return await decodeBinaryPreset(encoded) ?? await decodeLegacyPreset(encoded);
}

// Callers:
// - src/Index.tsx
export function loadPresets(): BlockPreset[] {
  const builtins = BUILTIN_PRESET_NAMES.flatMap(name => {
    const builtin = getBuiltinPreset(name);
    return builtin ? [builtin] : [];
  });
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.presets);
    if (!raw) return builtins;
    const parsed = JSON.parse(raw) as BlockPreset[];
    return [
      ...builtins,
      ...parsed
        .filter(preset => !getBuiltinPreset(preset.name))
        .map(({ name, selectedBlocks, customColors, selectedBlocksCustom }) => ({
          name,
          selectedBlocks: selectedBlocks ?? {},
          customColors,
          selectedBlocksCustom,
        })),
    ];
  } catch {
    /* ignore */
  }
  return builtins;
}
