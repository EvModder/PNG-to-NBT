#!/usr/bin/env bun
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

import {
  DEFAULT_ACTIVE_PRESET_NAME,
  DEFAULT_APPLY_SUPPORT_FLOOR_YS,
  DEFAULT_BELOW_PLATFORM_WATER,
  DEFAULT_BUILD_MODE,
  DEFAULT_CONVERT_UNSUPPORTED,
  DEFAULT_DARK_WATER_DROP,
  DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK,
  DEFAULT_FLAT_WATER_DROP,
  DEFAULT_FORCE_Z129,
  DEFAULT_LAYER_GAP,
  DEFAULT_LIGHT_WATER_DROP,
  DEFAULT_MIX_STEPS,
  DEFAULT_PALETTE_SEED,
  DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK,
  DEFAULT_SHADE_FILLER_BLOCK,
  DEFAULT_SUPPORT_FILLER_BLOCK,
  DEFAULT_SUPPORT_MODE,
  DEFAULT_SUPPRESS_STEP_DIRECTION,
  DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK,
} from "@/data/defaultSettings";
import { BASE_COLORS, TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX, Shade } from "@/data/mapColors";
import { getBuiltinPreset, type BlockPreset } from "@/data/presets";
import { normalizeBlockId, sanitizeUserBlockEntry } from "@/utils/blockId";
import { computeColorGridStats, hasStepMixOpportunity } from "@/lib/colorGridAnalysis";
import { convertImageToColorGrid } from "@/lib/colorGridParsing";
import { getPaletteSeedOffset } from "@/lib/paletteSeed";
import {
  buildModeUsesPaletteSeed,
  isSuppressStepsBuildMode,
} from "@/utils/conversion";
import type { ColorRgbCustom } from "@/types/color";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { createFillerAssignments, isFillerDisabled } from "@/lib/fillerRules";
import { convertToNbt } from "@/lib/nbtExport";
import { hasNonWaterColorHeightVariance } from "@/lib/shapeAnalysis";
import { generateShapeMap } from "@/lib/shapeGeneration";
import { SupportMode } from "@/types/ui";

const TEST_ROOT = import.meta.dir;
const CASES_ROOT = path.join(TEST_ROOT, "cases");
const FAILURE_ROOT = path.join(TEST_ROOT, "failures");
const WATER_DROP_INPUT_ORDER = [Shade.Light, Shade.Flat, Shade.Dark] as const;
type WaterDropShade = typeof WATER_DROP_INPUT_ORDER[number];
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

if (typeof globalThis.ImageData === "undefined") {
  class PolyfilledImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;

    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }

  Object.assign(globalThis, { ImageData: PolyfilledImageData });
}

type FixtureWaterDropOverrides = Partial<Record<"dark" | "flat" | "light", number>>;

type ExportFixtureSettings = {
  preset: string;
  buildMode: BuildMode;
  supportMode: SupportMode;
  supportFillerBlock: string;
  shadeFillerBlock: string;
  suppress2LayerLateFillerBlock: string;
  dominateVoidFillerBlock: string;
  recessiveVoidFillerBlock: string;
  suppressStepDirection: SuppressStepDirection;
  proPaletteSeed: boolean;
  layerGap: number;
  mixSteps: boolean;
  lightWaterDrop: number;
  flatWaterDrop: number;
  darkWaterDrop: number;
  applySupportFloorYs: boolean;
  forceZ129: boolean;
  belowPlatformWater: boolean;
  convertUnsupported: boolean;
  customColors: ColorRgbCustom[];
  presetOverrides: Record<string, string>;
};

type RawFixtureCustomColor = {
  r: number;
  g: number;
  b: number;
  block?: string;
  blocks?: string[];
};

type FixtureCaseFile = {
  input: string;
  output: string;
  settings?: Partial<ExportFixtureSettings> & {
    waterDrops?: FixtureWaterDropOverrides;
  };
};

type DiscoveredCase = {
  caseFilePath: string;
  caseName: string;
};

type ResolvedCase = {
  discovered: DiscoveredCase;
  inputPath: string;
  outputPath: string;
  outputExtension: ".nbt" | ".zip";
  baseName: string;
  preset: BlockPreset;
  settings: ExportFixtureSettings;
};

type FailurePayload = {
  title: string;
  report: Record<string, unknown>;
  actualData?: Uint8Array;
  actualExt?: string;
};

function resolveEffectiveFillerBlock(rawValue: string, defaultValue: string): string {
  return rawValue.trim() || defaultValue;
}

function normalizeUsedWaterDrops(
  rawDrops: Record<WaterDropShade, number>,
  usedWaterShades: ReadonlySet<Shade>,
  preferredFirstShade?: WaterDropShade,
): readonly [dark: number, flat: number, light: number] {
  const next: [number, number, number] = [
    Math.max(0, rawDrops[Shade.Dark] || 0),
    Math.max(0, rawDrops[Shade.Flat] || 0),
    Math.max(0, rawDrops[Shade.Light] || 0),
  ];
  const usedValues = new Set<number>();
  const orderedShades = preferredFirstShade === undefined
    ? WATER_DROP_INPUT_ORDER
    : [preferredFirstShade, ...WATER_DROP_INPUT_ORDER.filter(shade => shade !== preferredFirstShade)];

  for (const shade of orderedShades) {
    if (!usedWaterShades.has(shade)) continue;
    let value = next[shade];
    while (usedValues.has(value)) ++value;
    next[shade] = value;
    usedValues.add(value);
  }

  return next;
}

function deriveImageStatsViews(imageStats: ReturnType<typeof computeColorGridStats>) {
  const usedShadesByBase = new Map<number, Set<Shade>>();
  let hasTransparency = false;

  for (const [colorKey, shadeFrequencyMap] of imageStats.colorFrequencyMap) {
    if (colorKey.isCustom) {
      continue;
    }

    if (colorKey.id === TRANSPARENCY_BASE_INDEX) {
      if ((shadeFrequencyMap.get(Shade.Dark) ?? 0) > 0) hasTransparency = true;
      continue;
    }

    const shades = new Set<Shade>();
    for (const shade of shadeFrequencyMap.keys()) {
      shades.add(shade);
    }
    usedShadesByBase.set(colorKey.id, shades);
  }

  const usedWaterShades = usedShadesByBase.get(WATER_BASE_INDEX) ?? new Set<Shade>();
  return {
    allSameShade: imageStats.allSameShade,
    hasTransparency,
    imageHasWater: usedWaterShades.size > 0,
    imageHasNonLightWater: usedWaterShades.has(Shade.Dark) || usedWaterShades.has(Shade.Flat),
    usedWaterShades,
  };
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function firstDiffOffset(a: Uint8Array, b: Uint8Array): number {
  const commonLength = Math.min(a.length, b.length);
  for (let i = 0; i < commonLength; ++i) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : commonLength;
}

async function gunzipIfPossible(data: Uint8Array): Promise<Uint8Array | null> {
  if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) return null;
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readPngChunks(bytes: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  for (let i = 0; i < PNG_SIGNATURE.length; ++i) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("Not a PNG file");
  }

  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
    offset += 4;
    const type = Buffer.from(bytes.subarray(offset, offset + 4)).toString("ascii");
    offset += 4;
    const data = bytes.slice(offset, offset + length);
    offset += length + 4;
    chunks.push({ type, data });
    if (type === "IEND") break;
  }
  return chunks;
}

function unfilterPngScanlines(
  data: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
  bytesPerRow: number,
): Uint8Array {
  const stride = bytesPerRow + 1;
  const expectedLength = stride * height;
  if (data.length !== expectedLength) {
    throw new Error(`Unexpected inflated PNG size: got ${data.length}, expected ${expectedLength}`);
  }

  const result = new Uint8Array(bytesPerRow * height);
  let inOffset = 0;
  let outOffset = 0;
  for (let y = 0; y < height; ++y) {
    const filter = data[inOffset++];
    const row = result.subarray(outOffset, outOffset + bytesPerRow);
    const prevRow = y === 0 ? null : result.subarray(outOffset - bytesPerRow, outOffset);

    switch (filter) {
      case 0:
        row.set(data.subarray(inOffset, inOffset + bytesPerRow));
        break;
      case 1:
        for (let x = 0; x < bytesPerRow; ++x) {
          const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
          row[x] = (data[inOffset + x] + left) & 0xff;
        }
        break;
      case 2:
        for (let x = 0; x < bytesPerRow; ++x) {
          const up = prevRow ? prevRow[x] : 0;
          row[x] = (data[inOffset + x] + up) & 0xff;
        }
        break;
      case 3:
        for (let x = 0; x < bytesPerRow; ++x) {
          const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
          const up = prevRow ? prevRow[x] : 0;
          row[x] = (data[inOffset + x] + ((left + up) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let x = 0; x < bytesPerRow; ++x) {
          const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
          const up = prevRow ? prevRow[x] : 0;
          const upLeft = prevRow && x >= bytesPerPixel ? prevRow[x - bytesPerPixel] : 0;
          row[x] = (data[inOffset + x] + paethPredictor(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        throw new Error(`Unsupported PNG filter type: ${filter}`);
    }

    inOffset += bytesPerRow;
    outOffset += bytesPerRow;
  }

  return result;
}

async function loadImageData(inputPath: string): Promise<ImageData> {
  const bytes = new Uint8Array(await readFile(inputPath));
  const chunks = readPngChunks(bytes);
  const ihdr = chunks.find(chunk => chunk.type === "IHDR");
  if (!ihdr) throw new Error(`PNG missing IHDR: ${inputPath}`);

  const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = ihdrView.getUint32(0, false);
  const height = ihdrView.getUint32(4, false);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}: ${inputPath}`);
  if (interlace !== 0) throw new Error(`Interlaced PNGs are not supported: ${inputPath}`);

  const palette = chunks.find(chunk => chunk.type === "PLTE")?.data ?? null;
  const transparency = chunks.find(chunk => chunk.type === "tRNS")?.data ?? null;
  const idat = Buffer.concat(chunks.filter(chunk => chunk.type === "IDAT").map(chunk => Buffer.from(chunk.data)));
  if (idat.length === 0) throw new Error(`PNG missing IDAT: ${inputPath}`);

  let channels: number;
  switch (colorType) {
    case 0:
    case 3:
      channels = 1;
      break;
    case 2:
      channels = 3;
      break;
    case 4:
      channels = 2;
      break;
    case 6:
      channels = 4;
      break;
    default:
      throw new Error(`Unsupported PNG color type ${colorType}: ${inputPath}`);
  }

  const raw = unfilterPngScanlines(
    inflateSync(idat),
    width,
    height,
    channels,
    width * channels,
  );
  const rgba = new Uint8ClampedArray(width * height * 4);

  if (colorType === 6) {
    rgba.set(raw);
    return new ImageData(rgba, width, height);
  }

  let rawOffset = 0;
  let outOffset = 0;
  const transparentGray = transparency
    ? new DataView(transparency.buffer, transparency.byteOffset, transparency.byteLength).getUint16(0, false)
    : -1;
  const transparencyView =
    transparency && transparency.length >= 6
      ? new DataView(transparency.buffer, transparency.byteOffset, transparency.byteLength)
      : null;

  for (let i = 0; i < width * height; ++i) {
    switch (colorType) {
      case 0: {
        const gray = raw[rawOffset++];
        rgba[outOffset++] = gray;
        rgba[outOffset++] = gray;
        rgba[outOffset++] = gray;
        rgba[outOffset++] = gray === transparentGray ? 0 : 255;
        break;
      }
      case 2: {
        const r = raw[rawOffset++];
        const g = raw[rawOffset++];
        const b = raw[rawOffset++];
        let a = 255;
        if (
          transparencyView &&
          r === transparencyView.getUint16(0, false) &&
          g === transparencyView.getUint16(2, false) &&
          b === transparencyView.getUint16(4, false)
        ) {
          a = 0;
        }
        rgba[outOffset++] = r;
        rgba[outOffset++] = g;
        rgba[outOffset++] = b;
        rgba[outOffset++] = a;
        break;
      }
      case 3: {
        if (!palette) throw new Error(`Indexed PNG missing PLTE: ${inputPath}`);
        const idx = raw[rawOffset++];
        const base = idx * 3;
        rgba[outOffset++] = palette[base] ?? 0;
        rgba[outOffset++] = palette[base + 1] ?? 0;
        rgba[outOffset++] = palette[base + 2] ?? 0;
        rgba[outOffset++] = transparency?.[idx] ?? 255;
        break;
      }
      case 4: {
        const gray = raw[rawOffset++];
        const alpha = raw[rawOffset++];
        rgba[outOffset++] = gray;
        rgba[outOffset++] = gray;
        rgba[outOffset++] = gray;
        rgba[outOffset++] = alpha;
        break;
      }
      default:
        throw new Error(`Unhandled PNG color type ${colorType}: ${inputPath}`);
    }
  }

  return new ImageData(rgba, width, height);
}

function isBuildMode(raw: unknown): raw is BuildMode {
  return Object.values(BuildMode).includes(raw as BuildMode);
}

function isSupportMode(raw: unknown): raw is SupportMode {
  return Object.values(SupportMode).includes(raw as SupportMode);
}

function isSuppressStepDirection(raw: unknown): raw is SuppressStepDirection {
  return Object.values(SuppressStepDirection).includes(raw as SuppressStepDirection);
}

function sanitizeCaseName(caseName: string): string {
  return caseName.replace(/[\\/]/g, "__");
}

type ParsedZipEntry = {
  name: string;
  data: Uint8Array;
};

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
}

function parseStoredZipEntries(data: Uint8Array): ParsedZipEntry[] {
  const entries: ParsedZipEntry[] = [];
  let offset = 0;
  while (offset + 4 <= data.length) {
    const signature = readU32LE(data, offset);
    if (signature === 0x04034b50) {
      const compression = readU16LE(data, offset + 8);
      if (compression !== 0) {
        throw new Error("Only stored ZIP entries are supported in fixture comparison");
      }
      const compressedSize = readU32LE(data, offset + 18);
      const nameLength = readU16LE(data, offset + 26);
      const extraLength = readU16LE(data, offset + 28);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      const name = Buffer.from(data.subarray(nameStart, nameStart + nameLength)).toString("utf8");
      entries.push({ name, data: data.slice(dataStart, dataEnd) });
      offset = dataEnd;
      continue;
    }
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    throw new Error(`Unsupported ZIP structure at offset ${offset}`);
  }
  return entries;
}

async function compareFixtureOutput(
  expectedOutput: Uint8Array,
  actualOutput: Uint8Array,
  extension: ".nbt" | ".zip",
): Promise<
  | { matches: true }
  | {
      matches: false;
      rawDiffOffset: number;
      outputGunzip?: Uint8Array | null;
      actualGunzip?: Uint8Array | null;
      uncompressedDiffOffset?: number | null;
      zipEntrySummaries?: Array<{ outputName: string; actualName: string; outputSha256: string; actualSha256: string }>;
    }
> {
  if (extension === ".nbt") {
    const outputGunzip = await gunzipIfPossible(expectedOutput);
    const actualGunzip = await gunzipIfPossible(actualOutput);
    if (outputGunzip && actualGunzip) {
      const uncompressedDiffOffset = firstDiffOffset(outputGunzip, actualGunzip);
      if (uncompressedDiffOffset === -1) return { matches: true };
      return {
        matches: false,
        rawDiffOffset: firstDiffOffset(expectedOutput, actualOutput),
        outputGunzip,
        actualGunzip,
        uncompressedDiffOffset,
      };
    }
  }

  if (extension === ".zip") {
    const sortEntries = (entries: ParsedZipEntry[]) =>
      [...entries].sort((a, b) => {
        const hashCompare = sha256(a.data).localeCompare(sha256(b.data));
        return hashCompare !== 0 ? hashCompare : a.data.length - b.data.length;
      });

    const outputEntries = sortEntries(parseStoredZipEntries(expectedOutput));
    const actualEntries = sortEntries(parseStoredZipEntries(actualOutput));
    if (outputEntries.length === actualEntries.length) {
      const zipEntrySummaries = outputEntries.map((entry, index) => ({
        outputName: entry.name,
        actualName: actualEntries[index]?.name ?? "",
        outputSha256: sha256(entry.data),
        actualSha256: actualEntries[index] ? sha256(actualEntries[index].data) : "",
      }));
      const allMatch = outputEntries.every((entry, index) => {
        const other = actualEntries[index];
        return !!other && firstDiffOffset(entry.data, other.data) === -1;
      });
      if (allMatch) return { matches: true };
      return {
        matches: false,
        rawDiffOffset: firstDiffOffset(expectedOutput, actualOutput),
        zipEntrySummaries,
      };
    }
  }

  const rawDiffOffset = firstDiffOffset(expectedOutput, actualOutput);
  return rawDiffOffset === -1 ? { matches: true } : { matches: false, rawDiffOffset };
}

async function persistFailureArtifacts(caseName: string, payload: FailurePayload): Promise<string> {
  const targetDir = path.join(FAILURE_ROOT, sanitizeCaseName(caseName));
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, "report.json"), JSON.stringify(payload.report, null, 2));
  await writeFile(path.join(targetDir, "summary.txt"), `${payload.title}\n`);
  if (payload.actualData && payload.actualExt) {
    await writeFile(path.join(targetDir, `actual${payload.actualExt}`), payload.actualData);
  }
  return targetDir;
}

async function findFixtureCaseJsons(rootDir: string): Promise<DiscoveredCase[]> {
  const discovered: DiscoveredCase[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        discovered.push({
          caseFilePath: fullPath,
          caseName: path.relative(rootDir, fullPath).replace(/\.json$/i, ""),
        });
      }
    }
  }

  await walk(rootDir);
  return discovered.sort((a, b) => a.caseName.localeCompare(b.caseName));
}

function parseFixtureCaseFile(raw: unknown, sourcePath: string): FixtureCaseFile {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Fixture config must be a JSON object: ${sourcePath}`);
  }

  const parsed = raw as Record<string, unknown>;
  if (typeof parsed.input !== "string" || parsed.input.length === 0) {
    throw new Error(`Fixture config is missing required string field "input": ${sourcePath}`);
  }
  if (typeof parsed.output !== "string" || parsed.output.length === 0) {
    throw new Error(`Fixture config is missing required string field "output": ${sourcePath}`);
  }
  if (
    parsed.settings !== undefined &&
    (typeof parsed.settings !== "object" || parsed.settings === null || Array.isArray(parsed.settings))
  ) {
    throw new Error(`Fixture config field "settings" must be an object: ${sourcePath}`);
  }
  return parsed as FixtureCaseFile;
}

function buildPreset(presetName: string, presetOverrides: Record<string, string>): BlockPreset {
  const basePreset = getBuiltinPreset(presetName);
  if (!basePreset) throw new Error(`Unknown builtin preset "${presetName}"`);

  const blocks = { ...basePreset.blocks };
  for (const [rawBaseIndex, rawBlock] of Object.entries(presetOverrides)) {
    const baseIndex = Number(rawBaseIndex);
    if (!Number.isInteger(baseIndex) || baseIndex < 0 || baseIndex >= BASE_COLORS.length) {
      throw new Error(`Invalid preset override key "${rawBaseIndex}"`);
    }
    if (typeof rawBlock !== "string") {
      throw new Error(`Preset override for base color ${rawBaseIndex} must be a string`);
    }
    blocks[baseIndex] = sanitizeUserBlockEntry(rawBlock);
  }

  return { name: basePreset.name, blocks };
}

function resolveFixtureSettings(rawSettings: FixtureCaseFile["settings"]): ExportFixtureSettings {
  const settings = rawSettings ?? {};
  const preset = settings.preset ?? DEFAULT_ACTIVE_PRESET_NAME;
  if (typeof preset !== "string" || preset.length === 0) {
    throw new Error(`preset must be a non-empty string`);
  }

  const buildMode = settings.buildMode ?? DEFAULT_BUILD_MODE;
  if (!isBuildMode(buildMode)) throw new Error(`Invalid buildMode: ${String(settings.buildMode)}`);

  const supportMode = settings.supportMode ?? DEFAULT_SUPPORT_MODE;
  if (!isSupportMode(supportMode)) throw new Error(`Invalid supportMode: ${String(settings.supportMode)}`);

  const suppressStepDirection = settings.suppressStepDirection ?? DEFAULT_SUPPRESS_STEP_DIRECTION;
  if (!isSuppressStepDirection(suppressStepDirection)) {
    throw new Error(`Invalid suppressStepDirection: ${String(settings.suppressStepDirection)}`);
  }

  const rawCustomColors = settings.customColors ?? [];
  if (!Array.isArray(rawCustomColors)) throw new Error(`customColors must be an array`);
  const customColors = rawCustomColors.map((color, index): ColorRgbCustom => {
    const rawColor = color as RawFixtureCustomColor;
    const blocks = Array.isArray(rawColor.blocks)
      ? rawColor.blocks
      : typeof rawColor.block === "string"
        ? [rawColor.block]
        : [];
    if (typeof rawColor.r !== "number" || typeof rawColor.g !== "number" || typeof rawColor.b !== "number") {
      throw new Error(`customColors[${index}] must include numeric r, g, b values`);
    }
    return { r: rawColor.r, g: rawColor.g, b: rawColor.b, blocks };
  });

  const presetOverrides = settings.presetOverrides ?? {};
  if (typeof presetOverrides !== "object" || presetOverrides === null || Array.isArray(presetOverrides)) {
    throw new Error(`presetOverrides must be an object`);
  }

  const waterDrops = settings.waterDrops ?? {};
  if (typeof waterDrops !== "object" || waterDrops === null || Array.isArray(waterDrops)) {
    throw new Error(`waterDrops must be an object`);
  }

  return {
    preset,
    buildMode,
    supportMode,
    supportFillerBlock: settings.supportFillerBlock ?? "",
    shadeFillerBlock: settings.shadeFillerBlock ?? "",
    suppress2LayerLateFillerBlock: settings.suppress2LayerLateFillerBlock ?? "",
    dominateVoidFillerBlock: settings.dominateVoidFillerBlock ?? "",
    recessiveVoidFillerBlock: settings.recessiveVoidFillerBlock ?? "",
    suppressStepDirection,
    proPaletteSeed: settings.proPaletteSeed ?? DEFAULT_PALETTE_SEED,
    layerGap: settings.layerGap ?? DEFAULT_LAYER_GAP,
    mixSteps: settings.mixSteps ?? DEFAULT_MIX_STEPS,
    lightWaterDrop: waterDrops.light ?? settings.lightWaterDrop ?? DEFAULT_LIGHT_WATER_DROP,
    flatWaterDrop: waterDrops.flat ?? settings.flatWaterDrop ?? DEFAULT_FLAT_WATER_DROP,
    darkWaterDrop: waterDrops.dark ?? settings.darkWaterDrop ?? DEFAULT_DARK_WATER_DROP,
    applySupportFloorYs: settings.applySupportFloorYs ?? DEFAULT_APPLY_SUPPORT_FLOOR_YS,
    forceZ129: settings.forceZ129 ?? DEFAULT_FORCE_Z129,
    belowPlatformWater: settings.belowPlatformWater ?? DEFAULT_BELOW_PLATFORM_WATER,
    convertUnsupported: settings.convertUnsupported ?? DEFAULT_CONVERT_UNSUPPORTED,
    customColors,
    presetOverrides: presetOverrides as Record<string, string>,
  };
}

async function loadFixtureCase(discovered: DiscoveredCase): Promise<ResolvedCase> {
  const raw = await readFile(discovered.caseFilePath, "utf8");
  const parsed = parseFixtureCaseFile(JSON.parse(raw), discovered.caseFilePath);
  const settings = resolveFixtureSettings(parsed.settings);
  const preset = buildPreset(settings.preset, settings.presetOverrides);
  const inputPath = path.resolve(CASES_ROOT, parsed.input);
  const outputPath = path.resolve(CASES_ROOT, parsed.output);
  const outputExtension = path.extname(outputPath);
  if (outputExtension !== ".nbt" && outputExtension !== ".zip") {
    throw new Error(`Output artifact must be .nbt or .zip: ${outputPath}`);
  }

  return {
    discovered,
    inputPath,
    outputPath,
    outputExtension,
    baseName: path.basename(parsed.input, path.extname(parsed.input)),
    preset,
    settings,
  };
}

async function runFixtureCase(
  testCase: ResolvedCase,
  options: { updateExpected: boolean },
): Promise<{ ok: true; updated?: boolean } | { ok: false; reason: string; artifactsDir?: string }> {
  const imageData = await loadImageData(testCase.inputPath);
  const analysis = convertImageToColorGrid(
    imageData,
    testCase.settings.customColors,
    testCase.settings.convertUnsupported,
  );
  if (analysis.hasBlockingIssue) {
    const artifactsDir = await persistFailureArtifacts(testCase.discovered.caseName, {
      title: `Blocking image parsing issue in ${testCase.discovered.caseName}`,
      report: {
        caseName: testCase.discovered.caseName,
        inputPath: testCase.inputPath,
        outputPath: testCase.outputPath,
        paletteNotices: analysis.paletteNotices,
        hasBlockingIssue: analysis.hasBlockingIssue,
        settings: testCase.settings,
      },
    });
    return {
      ok: false,
      reason: `Image parsing produced a blocking issue for ${testCase.discovered.caseName}\nartifacts: ${artifactsDir}`,
      artifactsDir,
    };
  }

  const colorGrid = analysis.colorGrid;
  const imageStats = computeColorGridStats(colorGrid);
  const derivedImageStats = deriveImageStatsViews(imageStats);
  const usedWaterShades = derivedImageStats.usedWaterShades;
  const imageHasWater = derivedImageStats.imageHasWater;
  const imageHasNonLightWater = derivedImageStats.imageHasNonLightWater;
  const selectedWaterBlock = testCase.preset.blocks[WATER_BASE_INDEX] || BASE_COLORS[WATER_BASE_INDEX].blocks[0] || "";
  const usesWaterForWater = normalizeBlockId(selectedWaterBlock) === "water";
  const usesIceForWater = normalizeBlockId(selectedWaterBlock) === "ice";

  const effectiveSupportFillerBlock = resolveEffectiveFillerBlock(
    testCase.settings.supportFillerBlock,
    DEFAULT_SUPPORT_FILLER_BLOCK,
  );
  const effectiveShadeFillerBlock = resolveEffectiveFillerBlock(
    testCase.settings.shadeFillerBlock,
    DEFAULT_SHADE_FILLER_BLOCK,
  );
  const effectiveSuppress2LayerLateFillerBlock = resolveEffectiveFillerBlock(
    testCase.settings.suppress2LayerLateFillerBlock,
    DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK,
  );
  const effectiveDominateVoidFillerBlock = resolveEffectiveFillerBlock(
    testCase.settings.dominateVoidFillerBlock,
    DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK,
  );
  const effectiveRecessiveVoidFillerBlock = resolveEffectiveFillerBlock(
    testCase.settings.recessiveVoidFillerBlock,
    DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK,
  );
  const supportFillerDisabled = isFillerDisabled(effectiveSupportFillerBlock);
  const waterDrops = normalizeUsedWaterDrops(
    {
      [Shade.Dark]: testCase.settings.darkWaterDrop,
      [Shade.Flat]: testCase.settings.flatWaterDrop,
      [Shade.Light]: testCase.settings.lightWaterDrop,
    },
    usedWaterShades,
  );
  const activeWaterDrops = testCase.settings.belowPlatformWater && imageHasWater ? waterDrops : undefined;

  const showMixStepsToggle =
    isSuppressStepsBuildMode(testCase.settings.buildMode) &&
    hasStepMixOpportunity(colorGrid, {
      waterDrops: activeWaterDrops,
    });

  const paletteSeedOffset =
    buildModeUsesPaletteSeed(testCase.settings.buildMode) && testCase.settings.proPaletteSeed
      ? getPaletteSeedOffset(testCase.preset.blocks)
      : 0;

  const twoLayerHasLateVoidNeed = (imageStats.voidShadowStats.dominant ?? 0) > 0;

  const shapeMap = generateShapeMap(
    colorGrid,
    derivedImageStats.allSameShade,
    imageHasWater,
    derivedImageStats.hasTransparency,
    twoLayerHasLateVoidNeed,
    {
      layerGap: testCase.settings.layerGap,
      mixSteps: showMixStepsToggle && testCase.settings.mixSteps,
      paletteSeed: paletteSeedOffset,
      waterDrops: activeWaterDrops,
      selectedMode: testCase.settings.buildMode,
      selectedStepDirection: testCase.settings.suppressStepDirection,
    },
  );

  const northlineShape = shapeMap[BuildMode.StaircaseNorthline] ?? null;
  const isFlatShape = !!northlineShape && !hasNonWaterColorHeightVariance(northlineShape);
  const effectiveBuildMode = isFlatShape ? BuildMode.Flat : testCase.settings.buildMode;
  const effectiveShape =
    effectiveBuildMode === BuildMode.Flat
      ? northlineShape
      : (shapeMap[effectiveBuildMode] ?? null);

  const reportBase = {
    caseName: testCase.discovered.caseName,
    inputPath: testCase.inputPath,
    outputPath: testCase.outputPath,
    baseName: testCase.baseName,
    preset: testCase.preset.name,
    selectedWaterBlock,
    usesWaterForWater,
    usesIceForWater,
    belowPlatformWater: testCase.settings.belowPlatformWater,
    supportFillerDisabled,
    waterDrops,
    imageStats: {
      allSameShade: derivedImageStats.allSameShade,
      hasWater: imageHasWater,
      hasNonLightWater: imageHasNonLightWater,
      hasTransparency: derivedImageStats.hasTransparency,
      voidShadowStats: imageStats.voidShadowStats,
    },
    requestedSettings: testCase.settings,
    derived: {
      paletteSeedOffset,
      showMixStepsToggle,
      effectiveBuildMode,
      isFlatShape,
      twoLayerHasLateVoidNeed,
    },
  };

  if (!effectiveShape) {
    const artifactsDir = await persistFailureArtifacts(testCase.discovered.caseName, {
      title: `No generated shape for ${testCase.discovered.caseName}`,
      report: reportBase,
    });
    return {
      ok: false,
      reason: `No generated shape available for build mode ${effectiveBuildMode} in ${testCase.discovered.caseName}\nartifacts: ${artifactsDir}`,
      artifactsDir,
    };
  }

  const fillerAssignments = createFillerAssignments(
    effectiveSupportFillerBlock,
    effectiveShadeFillerBlock,
    effectiveDominateVoidFillerBlock,
    effectiveRecessiveVoidFillerBlock,
    effectiveSuppress2LayerLateFillerBlock,
    testCase.settings.supportMode,
    usesWaterForWater,
    usesIceForWater,
  );

  const generated = await convertToNbt(effectiveShape, {
    blockMapping: testCase.preset.blocks,
    fillerAssignments,
    applySupportFloorYs: testCase.settings.applySupportFloorYs,
    forceZ129: testCase.settings.forceZ129,
    customColors: testCase.settings.customColors,
    baseName: testCase.baseName,
  });

  if (generated.isZip !== (testCase.outputExtension === ".zip")) {
    const artifactsDir = await persistFailureArtifacts(testCase.discovered.caseName, {
      title: `Artifact type mismatch in ${testCase.discovered.caseName}`,
      report: {
        ...reportBase,
        outputExtension: testCase.outputExtension,
        actualExtension: generated.isZip ? ".zip" : ".nbt",
      },
      actualData: generated.data,
      actualExt: generated.isZip ? ".zip" : ".nbt",
    });
    return {
      ok: false,
      reason: `Generated ${generated.isZip ? ".zip" : ".nbt"} but fixture expects ${testCase.outputExtension} for ${testCase.discovered.caseName}\nartifacts: ${artifactsDir}`,
      artifactsDir,
    };
  }

  let outputData: Uint8Array | null = null;
  try {
    outputData = new Uint8Array(await readFile(testCase.outputPath));
  } catch (error) {
    if (!options.updateExpected) throw error;
  }
  if (!outputData) {
    await mkdir(path.dirname(testCase.outputPath), { recursive: true });
    await writeFile(testCase.outputPath, generated.data);
    return { ok: true, updated: true };
  }

  const comparison = await compareFixtureOutput(outputData, generated.data, testCase.outputExtension);
  if (!comparison.matches) {
    if (options.updateExpected) {
      await writeFile(testCase.outputPath, generated.data);
      return { ok: true, updated: true };
    }
    const artifactsDir = await persistFailureArtifacts(testCase.discovered.caseName, {
      title: `Byte mismatch in ${testCase.discovered.caseName}`,
      report: {
        ...reportBase,
        outputExtension: testCase.outputExtension,
        actualExtension: generated.isZip ? ".zip" : ".nbt",
        outputBytes: outputData.length,
        actualBytes: generated.data.length,
        outputSha256: sha256(outputData),
        actualSha256: sha256(generated.data),
        firstRawDiffOffset: comparison.rawDiffOffset,
        outputUncompressedBytes: comparison.outputGunzip?.length ?? null,
        actualUncompressedBytes: comparison.actualGunzip?.length ?? null,
        outputUncompressedSha256: comparison.outputGunzip ? sha256(comparison.outputGunzip) : null,
        actualUncompressedSha256: comparison.actualGunzip ? sha256(comparison.actualGunzip) : null,
        firstUncompressedDiffOffset: comparison.uncompressedDiffOffset ?? null,
        zipEntrySummaries: comparison.zipEntrySummaries ?? null,
      },
      actualData: generated.data,
      actualExt: testCase.outputExtension,
    });
    return {
      ok: false,
      reason: [
        `Byte mismatch in ${testCase.discovered.caseName}`,
        `output: ${testCase.outputPath}`,
        `artifacts: ${artifactsDir}`,
      ].join("\n"),
      artifactsDir,
    };
  }

  return { ok: true };
}

async function main(): Promise<number> {
  const rawArgs = process.argv.slice(2);
  const updateExpected = rawArgs.includes("--update");
  const requestedCases = new Set(rawArgs.filter(arg => arg !== "--update"));
  const discovered = await findFixtureCaseJsons(CASES_ROOT);
  if (discovered.length === 0) {
    console.log(`No export fixture cases found under ${CASES_ROOT}`);
    return 0;
  }

  const selected = requestedCases.size === 0
    ? discovered
    : discovered.filter(testCase => requestedCases.has(testCase.caseName));

  if (requestedCases.size > 0) {
    const matched = new Set(selected.map(testCase => testCase.caseName));
    const missing = [...requestedCases].filter(name => !matched.has(name));
    if (missing.length > 0) {
      console.error(`Unknown fixture case(s): ${missing.join(", ")}`);
      return 1;
    }
  }

  let failures = 0;
  for (const discoveredCase of selected) {
    const testCase = await loadFixtureCase(discoveredCase);
    process.stdout.write(`Running ${discoveredCase.caseName} ... `);
    const result = await runFixtureCase(testCase, { updateExpected });
    if (result.ok) {
      console.log(result.updated ? "updated" : "ok");
      continue;
    }
    ++failures;
    console.log("FAIL");
    console.error(result.reason);
  }

  if (failures > 0) {
    console.error(`\n${failures} fixture test(s) failed.`);
    return 1;
  }

  console.log(`\n${selected.length} fixture test(s) passed.`);
  return 0;
}

process.exit(await main());
