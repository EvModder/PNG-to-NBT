// PNG → NBT conversion logic

import { BASE_COLORS, SHADE_MULTIPLIERS, WATER_BASE_INDEX, getColorLookup, type ColorMatch } from "../data/mapColors";
import { writeStructureNbt, gzipCompress, type BlockEntry } from "./nbtWriter";
import { createZip, type ZipEntry } from "./zip";
import { isFragileBlock } from "../data/fragileBlocks";

export interface CustomColor {
  r: number;
  g: number;
  b: number;
  block: string;
}

export type BuildMode =
  | "flat"
  | "staircase_northline"
  | "staircase_southline"
  | "staircase_classic"
  | "staircase_grouped"
  | "staircase_valley"
  | "staircase_pro"
  | "suppress_rowsplit"
  | "suppress_checker"
  | "suppress_checker_ew"
  | "suppress_pairs_ew"
  | "suppress_2layer_late_fillers"
  | "suppress_2layer_late_pairs";

export type SupportMode = "none" | "steps" | "all" | "fragile" | "water";

export interface ConversionOptions {
  blockMapping: Record<number, string>;
  fillerBlock: string;
  suppress2LayerDelayedFillerBlock?: string;
  proPaletteSeed?: boolean;
  forceZ129?: boolean;
  customColors: CustomColor[];
  buildMode: BuildMode;
  supportMode: SupportMode;
  baseName: string;
  layerGap?: number;
  columnRange?: [number, number];
  stepRange?: [number, number];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  usedBaseColors: Set<number>;
}

interface CustomColorMatch {
  block: string;
  shade: number; // 0=dark, 1=flat, 2=light
}

function buildCustomColorLookup(customColors: CustomColor[]): Map<string, CustomColorMatch> {
  const lookup = new Map<string, CustomColorMatch>();
  for (const cc of customColors) {
    const block = cc.block?.trim();
    if (!block) continue;
    for (const shade of [0, 1, 2]) {
      const r = Math.floor((cc.r * SHADE_MULTIPLIERS[shade]) / 255);
      const g = Math.floor((cc.g * SHADE_MULTIPLIERS[shade]) / 255);
      const b = Math.floor((cc.b * SHADE_MULTIPLIERS[shade]) / 255);
      const key = `${r},${g},${b}`;
      if (!lookup.has(key)) {
        lookup.set(key, { block, shade });
      }
    }
  }
  return lookup;
}

// Validate a PNG image (only checks size + palette validity)
export function validatePng(imageData: ImageData, customColors: CustomColor[]): ValidationResult {
  const errors: string[] = [];
  const usedBaseColors = new Set<number>();

  if (imageData.width !== 128 || imageData.height !== 128) {
    errors.push(`Image must be 128×128 pixels (got ${imageData.width}×${imageData.height})`);
    return { valid: false, errors, usedBaseColors };
  }

  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(customColors);

  const invalidColors: string[] = [];

  for (let y = 0; y < 128; ++y) {
    for (let x = 0; x < 128; ++x) {
      const idx = (y * 128 + x) * 4;
      const a = imageData.data[idx + 3];
      if (a === 0) continue;

      const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
      const key = `${r},${g},${b}`;

      const match = lookup.get(key);
      if (match) {
        usedBaseColors.add(match.baseIndex);
      } else if (customLookup.has(key)) {
        usedBaseColors.add(-1);
      } else {
        if (!invalidColors.includes(key)) {
          invalidColors.push(key);
        }
      }
    }
  }

  if (invalidColors.length > 0) {
    const shown = invalidColors.slice(0, 10);
    errors.push(
      `Found ${invalidColors.length} color${invalidColors.length === 1 ? "" : "s"} not in Minecraft map palette:\n\n${shown.map(c => `rgb(${c})`).join(", ")}${invalidColors.length > 10 ? "..." : ""}`,
    );
  }

  return { valid: errors.length === 0, errors, usedBaseColors };
}

// Water depth with checkerboard optimization
// Even cells (x+z)%2==0: medium=5, dark=10
// Odd cells: medium=3, dark=7
function getWaterDepth(shade: number, x: number, z: number): number {
  if (shade === 2) return 1; // light always 1
  const even = (x + z) % 2 === 0;
  if (shade === 1) return even ? 5 : 3; // medium
  return even ? 10 : 7; // dark (shade 0 or 3)
}

function normalizeBlockId(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const base = lower.split("[")[0];
  return base.startsWith("minecraft:") ? base.slice("minecraft:".length) : base;
}

const TRANSPARENT_FILLER_BLOCKS = new Set<string>(BASE_COLORS[0].blocks.map(normalizeBlockId));
const DISABLED_FILLER_ALIASES = new Set<string>(["air", "none", "n/a", "na"]);

function hashString32(input: string): number {
  let h = 2166136261 >>> 0; // FNV-1a basis
  for (let i = 0; i < input.length; ++i) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function getProPaletteSeedOffset(blockMapping: Record<number, string>): number {
  const serialized = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => {
    const idx = i + 1;
    return `${idx}:${blockMapping[idx] ?? ""}`;
  }).join("|");
  return hashString32(serialized);
}

export function isFillerDisabled(fillerBlock: string): boolean {
  const normalized = normalizeBlockId(fillerBlock);
  if (!normalized) return false;
  return DISABLED_FILLER_ALIASES.has(normalized);
}

export function isShadeFillerDisabled(fillerBlock: string): boolean {
  const normalized = normalizeBlockId(fillerBlock);
  if (!normalized) return false;
  if (isFillerDisabled(normalized)) return true;
  return TRANSPARENT_FILLER_BLOCKS.has(normalized);
}

function resolveBlockName(block: string): string {
  let name: string;
  const props: Record<string, string> = {};

  if (block.includes("[")) {
    const bracketIdx = block.indexOf("[");
    name = block.slice(0, bracketIdx);
    const propsStr = block.slice(bracketIdx + 1, -1);
    for (const part of propsStr.split(",")) {
      const eq = part.indexOf("=");
      if (eq >= 0) props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  } else {
    name = block;
  }

  // Add persistent=true for all leaf blocks (silently in NBT)
  if (name.includes("leaves")) {
    props["persistent"] = "true";
  }

  const fullName = `minecraft:${name}`;
  const propKeys = Object.keys(props);
  if (propKeys.length > 0) {
    return `${fullName}[${propKeys.map(k => `${k}=${props[k]}`).join(",")}]`;
  }
  return fullName;
}

// Strip minecraft: prefix and persistent=true for display
function toDisplayName(blockName: string): string {
  let s = blockName.replace(/^minecraft:/, "");
  if (!s.includes("[")) return s;
  const bracketIdx = s.indexOf("[");
  const name = s.slice(0, bracketIdx);
  const propsStr = s.slice(bracketIdx + 1, -1);
  const props = propsStr.split(",").filter(p => p.trim() !== "persistent=true");
  return props.length > 0 ? `${name}[${props.join(",")}]` : name;
}

function isWaterBlock(blockName: string): boolean {
  return blockName === "minecraft:water" || blockName.includes("waterlogged=true");
}

// Build staircase blocks from image data
function buildStaircaseBlocks(imageData: ImageData, options: ConversionOptions): BlockEntry[] {
  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(options.customColors);

  const blocks: BlockEntry[] = [];
  const BASE_Y = 64;

  interface ColState {
    y: number;
    transparent: boolean;
    waterBottom?: number;
    waterTop?: number;
    waterDepth?: number;
    waterBlockStart?: number;
    waterChain?: { start: number; count: number }[];
  }

  let prevRow: ColState[] = new Array(128).fill(null).map(() => ({
    y: BASE_Y,
    transparent: true,
  }));

  function addBlock(x: number, y: number, z: number, block: string) {
    blocks.push({ x, y, z, blockName: resolveBlockName(block) });
  }

  for (let z = 0; z < 128; ++z) {
    const currRow: ColState[] = new Array(128);

    for (let x = 0; x < 128; ++x) {
      const idx = (z * 128 + x) * 4;
      const a = imageData.data[idx + 3];

      if (a === 0) {
        currRow[x] = { y: prevRow[x].y, transparent: true };
        continue;
      }

      const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
      const key = `${r},${g},${b}`;

      const match = lookup.get(key);
      const customMatch = customLookup.get(key);

      if (!match && !customMatch) {
        currRow[x] = { y: prevRow[x].y, transparent: true };
        continue;
      }

      const northState = prevRow[x];
      const northTransparent = northState.transparent;
      const northY = northState.y;

      if (customMatch) {
        if (customMatch.shade === 1) {
          // Flat: same y as north reference; filler needed if north is transparent.
          if (northTransparent && !isShadeFillerDisabled(options.fillerBlock)) addBlock(x, northY, z - 1, options.fillerBlock);
          addBlock(x, northY, z, customMatch.block);
          currRow[x] = { y: northY, transparent: false };
        } else if (customMatch.shade === 2) {
          // Light: 1 higher than north; no filler needed.
          addBlock(x, northY + 1, z, customMatch.block);
          currRow[x] = { y: northY + 1, transparent: false };
        } else {
          // Dark: 1 lower than north reference (or water-bottom reference for deep water).
          const isDeepWater = northState.waterBottom !== undefined && northState.waterDepth! > 1;
          if (isDeepWater) {
            const darkY = northState.waterBottom!;
            if (northTransparent && !isShadeFillerDisabled(options.fillerBlock)) addBlock(x, darkY + 1, z - 1, options.fillerBlock);
            addBlock(x, darkY, z, customMatch.block);
            currRow[x] = { y: darkY, transparent: false };
          } else {
            const darkRef = northState.waterBottom !== undefined ? northState.waterBottom! : northY;
            if (northTransparent && !isShadeFillerDisabled(options.fillerBlock)) addBlock(x, darkRef, z - 1, options.fillerBlock);
            addBlock(x, darkRef - 1, z, customMatch.block);
            currRow[x] = { y: darkRef - 1, transparent: false };
          }
        }
        continue;
      }

      const { baseIndex, shade } = match as ColorMatch;
      const baseColor = BASE_COLORS[baseIndex];
      const block = options.blockMapping[baseIndex] || baseColor.blocks[0];

      if (!block) {
        currRow[x] = { y: prevRow[x].y, transparent: true };
        continue;
      }

      if (baseIndex === WATER_BASE_INDEX) {
        const depth = getWaterDepth(shade, x, z);
        let bottom: number, top: number;
        if (northState.waterBottom !== undefined) {
          // Adjacent water: align bottoms
          bottom = northState.waterBottom;
          top = bottom + depth - 1;
        } else {
          bottom = northY;
          top = bottom + depth - 1;
        }
        const startIdx = blocks.length;
        for (let d = 0; d < depth; ++d) {
          addBlock(x, bottom + d, z, block);
        }
        const chain = northState.waterChain
          ? [...northState.waterChain, { start: startIdx, count: depth }]
          : [{ start: startIdx, count: depth }];
        // y = top so normal/light blocks south reference the pillar's top
        // Dark blocks south will explicitly use waterBottom instead
        currRow[x] = {
          y: top,
          transparent: false,
          waterBottom: bottom,
          waterTop: top,
          waterDepth: depth,
          waterBlockStart: startIdx,
          waterChain: chain,
        };
      } else {
        if (shade === 1) {
          // Normal: same y as north reference; filler needed if north is transparent
          if (northTransparent && !isShadeFillerDisabled(options.fillerBlock)) addBlock(x, northY, z - 1, options.fillerBlock);
          addBlock(x, northY, z, block);
          currRow[x] = { y: northY, transparent: false };
        } else if (shade === 2) {
          // Light: 1 higher than north; no filler needed
          addBlock(x, northY + 1, z, block);
          currRow[x] = { y: northY + 1, transparent: false };
        } else {
          // Dark (shade 0/3): if north is water with depth > 1, place at same Y as waterBottom;
          // otherwise place 1 lower than reference
          const isDeepWater = northState.waterBottom !== undefined && northState.waterDepth! > 1;
          if (isDeepWater) {
            const darkY = northState.waterBottom!;
            if (northTransparent && !isShadeFillerDisabled(options.fillerBlock)) addBlock(x, darkY + 1, z - 1, options.fillerBlock);
            addBlock(x, darkY, z, block);
            currRow[x] = { y: darkY, transparent: false };
          } else {
            const darkRef = northState.waterBottom !== undefined ? northState.waterBottom! : northY;
            if (northTransparent && !isShadeFillerDisabled(options.fillerBlock)) addBlock(x, darkRef, z - 1, options.fillerBlock);
            addBlock(x, darkRef - 1, z, block);
            currRow[x] = { y: darkRef - 1, transparent: false };
          }
        }
      }
    }

    prevRow = currRow;
  }

  return blocks;
}

// Add support blocks under any block higher than its N or S neighbor ("steps" mode)
function addStepSupport(blocks: BlockEntry[], fillerBlock: string) {
  const topY = new Map<string, number>();
  for (const b of blocks) {
    const key = `${b.x},${b.z}`;
    const cur = topY.get(key);
    if (cur === undefined || b.y > cur) topY.set(key, b.y);
  }

  const occupied = new Set<string>();
  for (const b of blocks) {
    occupied.add(`${b.x},${b.y},${b.z}`);
  }

  const extra: BlockEntry[] = [];
  for (const [key, y] of topY) {
    const [xs, zs] = key.split(",");
    const x = parseInt(xs),
      z = parseInt(zs);
    const northY = topY.get(`${x},${z - 1}`);
    const southY = topY.get(`${x},${z + 1}`);
    const higherThanNorth = northY !== undefined && y > northY;
    const higherThanSouth = southY !== undefined && y > southY;
    if (higherThanNorth || higherThanSouth) {
      if (!occupied.has(`${x},${y - 1},${z}`)) {
        extra.push({ x, y: y - 1, z, blockName: resolveBlockName(fillerBlock) });
      }
    }
  }

  blocks.push(...extra);
}

// Add filler below every block ("all" mode)
function addAllSupport(blocks: BlockEntry[], fillerBlock: string) {
  const occupied = new Set<string>();
  for (const b of blocks) occupied.add(`${b.x},${b.y},${b.z}`);

  const extra: BlockEntry[] = [];
  for (const b of blocks) {
    // For water pillars, place filler below the lowest Y of that column
    const belowKey = `${b.x},${b.y - 1},${b.z}`;
    if (!occupied.has(belowKey)) {
      extra.push({ x: b.x, y: b.y - 1, z: b.z, blockName: resolveBlockName(fillerBlock) });
      occupied.add(belowKey);
    }
  }

  blocks.push(...extra);
}

// Add filler below fragile blocks only ("fragile" mode)
function addFragileSupport(blocks: BlockEntry[], fillerBlock: string) {
  const occupied = new Set<string>();
  for (const b of blocks) occupied.add(`${b.x},${b.y},${b.z}`);

  const extra: BlockEntry[] = [];
  for (const b of blocks) {
    const rawName = b.blockName.replace(/^minecraft:/, "");
    if (isFragileBlock(rawName)) {
      const belowKey = `${b.x},${b.y - 1},${b.z}`;
      if (!occupied.has(belowKey)) {
        extra.push({ x: b.x, y: b.y - 1, z: b.z, blockName: resolveBlockName(fillerBlock) });
        occupied.add(belowKey);
      }
    }
  }

  blocks.push(...extra);
}

// Add filler in empty spots adjacent to or below water blocks ("water" mode)
function addWaterSupport(blocks: BlockEntry[], fillerBlock: string) {
  const occupied = new Set<string>();
  for (const b of blocks) occupied.add(`${b.x},${b.y},${b.z}`);

  const waterPositions: { x: number; y: number; z: number }[] = [];
  for (const b of blocks) {
    if (isWaterBlock(b.blockName)) {
      waterPositions.push({ x: b.x, y: b.y, z: b.z });
    }
  }

  const extra = new Set<string>();
  const fillerName = resolveBlockName(fillerBlock);

  for (const w of waterPositions) {
    // NSEW + below
    const neighbors = [
      { x: w.x, y: w.y, z: w.z - 1 }, // North
      { x: w.x, y: w.y, z: w.z + 1 }, // South
      { x: w.x - 1, y: w.y, z: w.z }, // West
      { x: w.x + 1, y: w.y, z: w.z }, // East
      { x: w.x, y: w.y - 1, z: w.z }, // Below
    ];
    for (const n of neighbors) {
      const key = `${n.x},${n.y},${n.z}`;
      if (!occupied.has(key) && !extra.has(key)) {
        extra.add(key);
        blocks.push({ x: n.x, y: n.y, z: n.z, blockName: fillerName });
        occupied.add(key);
      }
    }
  }
}

// Apply support mode to blocks
function applySupport(blocks: BlockEntry[], options: ConversionOptions) {
  if (isFillerDisabled(options.fillerBlock)) return;
  switch (options.supportMode) {
    case "steps": addStepSupport(blocks, options.fillerBlock); break;
    case "all": addAllSupport(blocks, options.fillerBlock); break;
    case "fragile": addFragileSupport(blocks, options.fillerBlock); break;
    case "water": addWaterSupport(blocks, options.fillerBlock); break;
    case "none": break;
  }
}

// Normalize blocks so min Y=0 and min Z=0, return dimensions
function normalizeAndMeasure(blocks: BlockEntry[], forceZ129 = false): { sizeX: number; sizeY: number; sizeZ: number } {
  if (blocks.length === 0) return { sizeX: 128, sizeY: 1, sizeZ: forceZ129 ? 129 : 128 };

  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of blocks) {
    if (b.y < minY) minY = b.y;
    if (b.y > maxY) maxY = b.y;
    if (b.z < minZ) minZ = b.z;
    if (b.z > maxZ) maxZ = b.z;
  }

  for (const b of blocks) {
    b.y -= minY;
    if (minZ < 0) b.z -= minZ;
  }

  const rawSizeZ = (minZ < 0 ? maxZ - minZ : maxZ) + 1;
  // Ensure Z dimension is at least 128 (full map width) plus filler row if present
  const minSizeZ = minZ < 0 ? 129 : 128;
  let sizeZ = Math.max(rawSizeZ, minSizeZ);
  if (forceZ129 && sizeZ === 128) {
    // Add one empty northern row by shifting all occupied rows south by +1.
    for (const b of blocks) b.z += 1;
    sizeZ = 129;
  }
  return {
    sizeX: 128,
    sizeY: maxY - minY + 1,
    sizeZ,
  };
}

// Add shading-neutral fillers for water-adjacent staircase segments to make in-game
// placement more contiguous. This mirrors the Valley convenience behavior and is now
// shared across staircase modes.
function addStaircaseWaterConvenienceFillers(
  blocks: BlockEntry[],
  imageData: ImageData,
  options: ConversionOptions,
) {
  if (isFillerDisabled(options.fillerBlock)) return;
  if (options.buildMode === "flat" || options.buildMode.startsWith("suppress")) return;

  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(options.customColors);

  const occupied = new Set<string>();
  for (const b of blocks) occupied.add(`${b.x},${b.y},${b.z}`);
  const fillerName = resolveBlockName(options.fillerBlock);

  // Group blocks by x/z with current top/min y snapshots (post-variant positions).
  const columnZ = new Map<number, Map<number, { minY: number; maxY: number }>>();
  for (const b of blocks) {
    if (!columnZ.has(b.x)) columnZ.set(b.x, new Map());
    const zMap = columnZ.get(b.x)!;
    const current = zMap.get(b.z);
    if (!current) zMap.set(b.z, { minY: b.y, maxY: b.y });
    else {
      if (b.y < current.minY) current.minY = b.y;
      if (b.y > current.maxY) current.maxY = b.y;
    }
  }

  for (let x = 0; x < 128; ++x) {
    const zStats = columnZ.get(x);
    if (!zStats) continue;

    const pixelInfo = new Map<number, { shade: number; isWater: boolean }>();
    for (let z = 0; z < 128; ++z) {
      const idx = (z * 128 + x) * 4;
      if (imageData.data[idx + 3] === 0) continue;
      const r = imageData.data[idx], g = imageData.data[idx + 1], b2 = imageData.data[idx + 2];
      const key = `${r},${g},${b2}`;
      const match = lookup.get(key);
      const customMatch = customLookup.get(key);
      if (match) {
        pixelInfo.set(z, { shade: match.shade, isWater: match.baseIndex === WATER_BASE_INDEX });
      } else if (customMatch) {
        pixelInfo.set(z, { shade: customMatch.shade, isWater: false });
      }
    }

    const primaryZ = [...pixelInfo.keys()].sort((a, b) => a - b);
    if (primaryZ.length === 0) continue;

    const waterZ = new Set<number>();
    for (const z of primaryZ) {
      if (pixelInfo.get(z)?.isWater) waterZ.add(z);
    }

    interface Segment {
      zList: number[];
      waterDepth?: number;
    }

    const processed = new Set<number>();
    const segments: Segment[] = [];
    const nonWaterPrimary = primaryZ.filter(z => !waterZ.has(z));

    let i = 0;
    while (i < nonWaterPrimary.length) {
      const startZ = nonWaterPrimary[i];
      const startTop = zStats.get(startZ)?.maxY;
      if (startTop === undefined) {
        ++i;
        continue;
      }

      let j = i + 1;
      while (j < nonWaterPrimary.length) {
        const prevZ = nonWaterPrimary[j - 1];
        const currZ = nonWaterPrimary[j];
        const currTop = zStats.get(currZ)?.maxY;
        if (currZ !== prevZ + 1 || currTop !== startTop) break;
        ++j;
      }

      const zList = nonWaterPrimary.slice(i, j);
      const northZ = zList[0] - 1;
      let depth: number | undefined;
      if (waterZ.has(northZ) && zStats.get(northZ)?.maxY === startTop) {
        const w = zStats.get(northZ)!;
        depth = w.maxY - w.minY + 1;
        zList.unshift(northZ);
      }

      for (const z of zList) processed.add(z);
      segments.push({ zList, waterDepth: depth });
      i = j;
    }

    for (const z of primaryZ) {
      if (waterZ.has(z) && !processed.has(z)) {
        const w = zStats.get(z);
        if (w) segments.push({ zList: [z], waterDepth: w.maxY - w.minY + 1 });
      }
    }

    for (const seg of segments) {
      if (!seg.waterDepth || seg.waterDepth <= 1 || seg.zList.length <= 1) continue;

      const waterPillarZ = seg.zList[0];
      const waterInfo = pixelInfo.get(waterPillarZ);
      if (!waterInfo || !waterInfo.isWater) continue;
      // Light-water pillars are simple enough to build and don't need this extra connector.
      if (waterInfo.shade === 2) continue;

      const southZ = seg.zList[seg.zList.length - 1] + 1;
      const southY = zStats.get(southZ)?.maxY;
      if (southY === undefined) continue;

      const waterBottom = zStats.get(waterPillarZ)?.minY;
      // If the pillar already reaches y=0, this convenience filler is unnecessary in-game.
      if (waterBottom === 0) continue;
      // Match Valley's intended convenience case: water pillar bottom already aligned to southY.
      if (waterBottom === undefined || waterBottom !== southY) continue;

      for (const z of seg.zList) {
        if (z === waterPillarZ) continue;
        const key = `${x},${southY},${z}`;
        if (occupied.has(key)) continue;
        blocks.push({ x, y: southY, z, blockName: fillerName });
        occupied.add(key);
      }
    }
  }
}

function buildStaircaseModeBlocks(
  imageData: ImageData,
  options: ConversionOptions,
  includeWaterConvenienceFillers = true,
): BlockEntry[] {
  if (options.buildMode === "staircase_grouped") {
    // Grouped reuses Valley geometry/water-convenience behavior, then applies non-water grouping lifts.
    const blocks = buildStaircaseBlocks(imageData, options);
    applyStaircaseVariant(blocks, "staircase_valley", imageData, options);
    if (includeWaterConvenienceFillers) {
      addStaircaseWaterConvenienceFillers(blocks, imageData, { ...options, buildMode: "staircase_valley" });
    }
    applyGroupedModePostProcess(blocks, imageData, options);
    return blocks;
  }

  const blocks = buildStaircaseBlocks(imageData, options);
  applyStaircaseVariant(blocks, options.buildMode, imageData, options);
  if (includeWaterConvenienceFillers) {
    addStaircaseWaterConvenienceFillers(blocks, imageData, options);
  }
  return blocks;
}

// Convert validated PNG to NBT (returns Uint8Array for .nbt or .zip)
export async function convertToNbt(
  imageData: ImageData,
  options: ConversionOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  if (options.buildMode === "suppress_rowsplit") {
    return buildRowSplit(imageData, options);
  }
  if (options.buildMode === "suppress_checker") {
    return buildCheckerSplit(imageData, options);
  }

  if (options.buildMode === "suppress_pairs_ew" || options.buildMode === "suppress_checker_ew") {
    const blocks =
      options.buildMode === "suppress_checker_ew"
        ? buildSuppressCheckerEWBlocks(imageData, options)
        : buildSuppressPairsEWBlocks(imageData, options);
    applySupport(blocks, options);
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options.forceZ129 === true);
    const nbtData = writeStructureNbt(blocks, sizeX, sizeY, sizeZ);
    return { data: await gzipCompress(nbtData), isZip: false };
  }

  if (options.buildMode === "suppress_2layer_late_fillers" || options.buildMode === "suppress_2layer_late_pairs") {
    const variant = options.buildMode === "suppress_2layer_late_pairs" ? "late_flat_vs" : "classic";
    const blocks = buildSuppressDualLayerBlocks(imageData, options, variant);
    applySupport(blocks, options);
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options.forceZ129 === true);
    const nbtData = writeStructureNbt(blocks, sizeX, sizeY, sizeZ);
    return { data: await gzipCompress(nbtData), isZip: false };
  }

  const blocks = buildStaircaseModeBlocks(imageData, options);
  applySupport(blocks, options);

  const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options.forceZ129 === true);
  const nbtData = writeStructureNbt(blocks, sizeX, sizeY, sizeZ);
  return { data: await gzipCompress(nbtData), isZip: false };
}

// Build suppress pairs block lists (two halves)
function buildSuppressRowSplitBlocks(imageData: ImageData, options: ConversionOptions): [BlockEntry[], BlockEntry[]] {
  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(options.customColors);

  function buildHalf(startRow: 0 | 1): BlockEntry[] {
    const blocks: BlockEntry[] = [];

    function addBlock(x: number, y: number, z: number, block: string) {
      blocks.push({ x, y, z, blockName: resolveBlockName(block) });
    }

    for (let z = 0; z < 128; ++z) {
      const isColorRow = z % 2 === startRow;
      if (!isColorRow) continue; // only process color rows

      for (let x = 0; x < 128; ++x) {
        const idx = (z * 128 + x) * 4;
        const a = imageData.data[idx + 3];
        if (a === 0) continue;

        const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
        const key = `${r},${g},${b}`;

        const match = lookup.get(key);
        const customMatch = customLookup.get(key);
        if (!match && !customMatch) continue;

        const block = customMatch
          ? customMatch.block
          : options.blockMapping[(match as ColorMatch).baseIndex] ||
            BASE_COLORS[(match as ColorMatch).baseIndex].blocks[0];
        if (!block) continue;

        // Water: stack from y=0 up by depth, no filler needed
        if (!customMatch && (match as ColorMatch).baseIndex === WATER_BASE_INDEX) {
          const depth = getWaterDepth((match as ColorMatch).shade, x, z);
          for (let d = 0; d < depth; ++d) {
            addBlock(x, d, z, block);
          }
        } else {
          // Color block at y=0
          addBlock(x, 0, z, block);

          // Filler north of this color row (z-1) based on shade
          const shade = customMatch ? customMatch.shade : (match as ColorMatch).shade;
          if (shade === 2) {
            // Light: no filler
          } else if (!isShadeFillerDisabled(options.fillerBlock)) {
            if (shade === 1) {
              // Normal: filler at y=0
              addBlock(x, 0, z - 1, options.fillerBlock);
            } else {
              // Dark: filler at y=1
              addBlock(x, 1, z - 1, options.fillerBlock);
              if (options.supportMode === "steps" || options.supportMode === "all") {
                addBlock(x, 0, z - 1, options.fillerBlock);
              }
            }
          }
        }
      }
    }

    if (options.supportMode !== "none") {
      applySupport(blocks, options);
    }

    return blocks;
  }

  return [buildHalf(0), buildHalf(1)];
}

// Build checker suppress block lists (dominant/recessive halves).
// Dominant cells are (x+z)%2===1, recessive are (x+z)%2===0.
function buildSuppressCheckerBlocks(imageData: ImageData, options: ConversionOptions): [BlockEntry[], BlockEntry[]] {
  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(options.customColors);

  function buildHalf(useDominant: boolean): BlockEntry[] {
    const blocks: BlockEntry[] = [];

    function addBlock(x: number, y: number, z: number, block: string) {
      blocks.push({ x, y, z, blockName: resolveBlockName(block) });
    }

    for (let z = 0; z < 128; ++z) {
      for (let x = 0; x < 128; ++x) {
        const isDominant = (x + z) % 2 === 1;
        if (isDominant !== useDominant) continue;

        const idx = (z * 128 + x) * 4;
        const a = imageData.data[idx + 3];
        if (a === 0) continue;

        const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
        const key = `${r},${g},${b}`;

        const match = lookup.get(key);
        const customMatch = customLookup.get(key);
        if (!match && !customMatch) continue;

        const block = customMatch
          ? customMatch.block
          : options.blockMapping[(match as ColorMatch).baseIndex] ||
            BASE_COLORS[(match as ColorMatch).baseIndex].blocks[0];
        if (!block) continue;

        if (!customMatch && (match as ColorMatch).baseIndex === WATER_BASE_INDEX) {
          // Checker suppress: water top is always y=-1 relative to solid color blocks at y=0.
          const depth = getWaterDepth((match as ColorMatch).shade, x, z);
          for (let d = 0; d < depth; ++d) {
            addBlock(x, -1 - d, z, block);
          }
        } else {
          // Primary color block at y=0.
          addBlock(x, 0, z, block);

          // Shade filler north at z-1, y or y+1 for flat/dark respectively.
          const shade = customMatch ? customMatch.shade : (match as ColorMatch).shade;
          if (shade !== 2 && !isShadeFillerDisabled(options.fillerBlock)) {
            if (shade === 1) {
              addBlock(x, 0, z - 1, options.fillerBlock);
            } else {
              addBlock(x, 1, z - 1, options.fillerBlock);
              if (options.supportMode === "steps" || options.supportMode === "all") {
                addBlock(x, 0, z - 1, options.fillerBlock);
              }
            }
          }
        }
      }
    }

    if (options.supportMode !== "none") {
      applySupport(blocks, options);
    }

    return blocks;
  }

  // Zip order: dominant first, recessive second.
  return [buildHalf(true), buildHalf(false)];
}

// Suppress (Row-split): generate two NBTs in a zip
async function buildRowSplit(
  imageData: ImageData,
  options: ConversionOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const [half0, half1] = buildSuppressRowSplitBlocks(imageData, options);

  async function toNbt(blocks: BlockEntry[]): Promise<Uint8Array> {
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options.forceZ129 === true);
    const nbtData = writeStructureNbt(blocks, sizeX, sizeY, sizeZ);
    return gzipCompress(nbtData);
  }

  const [oddData, evenData] = await Promise.all([toNbt(half0), toNbt(half1)]);

  const zipEntries: ZipEntry[] = [
    { name: `${options.baseName}-odd_rows.nbt`, data: oddData },
    { name: `${options.baseName}-even_rows.nbt`, data: evenData },
  ];

  return { data: createZip(zipEntries), isZip: true };
}

// Suppress (Checker): dominant + recessive NBTs in one zip.
async function buildCheckerSplit(
  imageData: ImageData,
  options: ConversionOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const [dominant, recessive] = buildSuppressCheckerBlocks(imageData, options);

  async function toNbt(blocks: BlockEntry[]): Promise<Uint8Array> {
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options.forceZ129 === true);
    const nbtData = writeStructureNbt(blocks, sizeX, sizeY, sizeZ);
    return gzipCompress(nbtData);
  }

  const [dominantData, recessiveData] = await Promise.all([toNbt(dominant), toNbt(recessive)]);

  const zipEntries: ZipEntry[] = [
    { name: `${options.baseName}-dominant.nbt`, data: dominantData },
    { name: `${options.baseName}-recessive.nbt`, data: recessiveData },
  ];

  return { data: createZip(zipEntries), isZip: true };
}

// Post-process blocks to apply staircase variants
function applyGroupedModePostProcess(blocks: BlockEntry[], imageData: ImageData, options: ConversionOptions) {
  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(options.customColors);

  type PixelInfo = { shade: number; isWater: boolean };
  const pixelByColumn = new Map<number, Map<number, PixelInfo>>();
  for (let x = 0; x < 128; ++x) {
    const zInfo = new Map<number, PixelInfo>();
    for (let z = 0; z < 128; ++z) {
      const idx = (z * 128 + x) * 4;
      if (imageData.data[idx + 3] === 0) continue;
      const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
      const key = `${r},${g},${b}`;
      const match = lookup.get(key);
      const customMatch = customLookup.get(key);
      if (match) {
        zInfo.set(z, { shade: match.shade, isWater: match.baseIndex === WATER_BASE_INDEX });
      } else if (customMatch) {
        zInfo.set(z, { shade: customMatch.shade, isWater: false });
      }
    }
    if (zInfo.size > 0) pixelByColumn.set(x, zInfo);
  }

  const columnZBlocks = new Map<number, Map<number, BlockEntry[]>>();
  for (const b of blocks) {
    if (!columnZBlocks.has(b.x)) columnZBlocks.set(b.x, new Map<number, BlockEntry[]>());
    const zMap = columnZBlocks.get(b.x)!;
    if (!zMap.has(b.z)) zMap.set(b.z, []);
    zMap.get(b.z)!.push(b);
  }

  let valleyMaxY = -Infinity;
  for (const b of blocks) valleyMaxY = Math.max(valleyMaxY, b.y);
  if (!Number.isFinite(valleyMaxY)) return;

  interface GroupedSegment {
    zList: number[]; // non-water primary z rows in this segment
    minY: number; // lowest y among segment primary rows
  }

  // Per request: process columns after the first.
  for (let x = 1; x < 128; ++x) {
    const primaryInfo = pixelByColumn.get(x);
    const zToBlocks = columnZBlocks.get(x);
    if (!primaryInfo || !zToBlocks) continue;

    const allPrimaryZ = [...primaryInfo.keys()].sort((a, b) => a - b);
    const topY = new Map<number, number>();
    const minY = new Map<number, number>();
    for (const z of allPrimaryZ) {
      const bs = zToBlocks.get(z);
      if (!bs || bs.length === 0) continue;
      let zMin = Infinity, zMax = -Infinity;
      for (const b of bs) {
        if (b.y < zMin) zMin = b.y;
        if (b.y > zMax) zMax = b.y;
      }
      minY.set(z, zMin);
      topY.set(z, zMax);
    }

    const primaryZ = allPrimaryZ.filter(z => topY.has(z) && minY.has(z));
    if (primaryZ.length === 0) continue;

    const waterZ = new Set<number>();
    for (const z of primaryZ) {
      if (primaryInfo.get(z)?.isWater) waterZ.add(z);
    }

    const segments: GroupedSegment[] = [];
    const nonWaterPrimary = primaryZ.filter(z => !waterZ.has(z));

    let i = 0;
    while (i < nonWaterPrimary.length) {
      const startZ = nonWaterPrimary[i];
      const runTop = topY.get(startZ)!;
      let j = i + 1;
      while (
        j < nonWaterPrimary.length &&
        nonWaterPrimary[j] === nonWaterPrimary[j - 1] + 1 &&
        topY.get(nonWaterPrimary[j]) === runTop
      ) {
        ++j;
      }
      const zList = nonWaterPrimary.slice(i, j);

      let segMin = Infinity;
      for (const z of zList) segMin = Math.min(segMin, minY.get(z)!);
      segments.push({ zList, minY: segMin });
      i = j;
    }

    // Process from highest segment downward (per request: descending min-Y).
    segments.sort((a, b) => b.minY - a.minY);

    for (const seg of segments) {
      const primaryRowsToShift = new Set<number>(seg.zList.filter(z => primaryInfo.has(z)));
      const allRowsToShift = new Set<number>(seg.zList);

      // Shift filler-only row north of each moved primary row by same delta.
      for (const z of seg.zList) {
        const fillerZ = z - 1;
        if (primaryInfo.has(fillerZ)) continue;
        if (zToBlocks.has(fillerZ)) allRowsToShift.add(fillerZ);
      }

      let movingMaxY = -Infinity;
      for (const z of allRowsToShift) {
        const bs = zToBlocks.get(z);
        if (!bs) continue;
        for (const b of bs) movingMaxY = Math.max(movingMaxY, b.y);
      }
      if (!Number.isFinite(movingMaxY)) continue;

      const maxLift = valleyMaxY - movingMaxY;
      if (maxLift <= 0) continue;

      const neighborMinY = new Set<number>();
      for (const z of seg.zList) {
        for (const nx of [x - 1, x + 1]) {
          if (nx < 0 || nx >= 128) continue;
          const neighborPrimary = pixelByColumn.get(nx);
          if (!neighborPrimary?.has(z)) continue;
          const neighborCol = columnZBlocks.get(nx);
          if (!neighborCol) continue;
          const bs = neighborCol.get(z);
          if (!bs) continue;
          let zMin = Infinity;
          for (const b of bs) zMin = Math.min(zMin, b.y);
          if (Number.isFinite(zMin)) neighborMinY.add(zMin);
        }
      }

      const deltas = [...neighborMinY]
        .map(y => y - seg.minY)
        .filter(d => d > 0 && d <= maxLift)
        .sort((a, b) => a - b);
      if (deltas.length === 0) continue;

      const isColumnShadeSafe = (delta: number): boolean => {
        for (const z of primaryZ) {
          const info = primaryInfo.get(z);
          if (!info || info.isWater) continue;
          const northZ = z - 1;
          if (!primaryInfo.has(northZ)) continue;
          const y = topY.get(z)! + (primaryRowsToShift.has(z) ? delta : 0);
          const northY = topY.get(northZ)! + (primaryRowsToShift.has(northZ) ? delta : 0);
          if (info.shade === 2) {
            if (!(y > northY)) return false;
          } else if (info.shade === 1) {
            if (y !== northY) return false;
          } else {
            if (!(y < northY)) return false;
          }
        }
        return true;
      };

      let chosenDelta = 0;
      for (const d of deltas) {
        if (isColumnShadeSafe(d)) {
          chosenDelta = d;
          break;
        }
      }
      if (chosenDelta <= 0) continue;

      for (const z of allRowsToShift) {
        const bs = zToBlocks.get(z);
        if (!bs) continue;
        for (const b of bs) b.y += chosenDelta;
      }

      for (const z of primaryRowsToShift) {
        if (topY.has(z)) topY.set(z, topY.get(z)! + chosenDelta);
        if (minY.has(z)) minY.set(z, minY.get(z)! + chosenDelta);
      }

      seg.minY += chosenDelta;
    }
  }
}

function applyStaircaseVariant(
  blocks: BlockEntry[],
  mode: BuildMode,
  imageData?: ImageData,
  options?: ConversionOptions,
) {
  if (mode === "staircase_northline" || mode === "flat" || mode.startsWith("suppress")) return;

  if (mode === "staircase_pro" && imageData && options) {
    applyProMode(blocks, imageData, options);
    return;
  }

  // Group blocks by x column
  const columns = new Map<number, BlockEntry[]>();
  for (const b of blocks) {
    if (!columns.has(b.x)) columns.set(b.x, []);
    columns.get(b.x)!.push(b);
  }

  for (const [x, colBlocks] of columns) {
    if (mode === "staircase_classic") {
      const minY = colBlocks.reduce((m, b) => Math.min(m, b.y), Infinity);
      for (const b of colBlocks) b.y -= minY;
    } else if (mode === "staircase_southline") {
      let maxZ = -Infinity, southY = 0;
      for (const b of colBlocks) {
        if (b.z > maxZ) {
          maxZ = b.z;
          southY = b.y;
        }
      }
      for (const b of colBlocks) b.y -= southY;
    } else if (mode === "staircase_valley" && imageData && options) {
      // Valley mode: process segments from lowest top-y upward.
      // Water pillars can join a segment as its northernmost block.
      // Movement: if south is transparent/water/light → target topY=0;
      // otherwise → south's current maxY + 1.
      // Water pillar bottoms must not go below y=0.
      // Shade is always read from the source image, not current block positions.

      const lookup = getColorLookup();
      const customLookup = buildCustomColorLookup(options.customColors);

      // Build pixel info from source image (shade truth)
      const pixelShade = new Map<number, { shade: number; isWater: boolean }>();
      for (let z = 0; z < 128; ++z) {
        const idx = (z * 128 + x) * 4;
        const a = imageData.data[idx + 3];
        if (a === 0) continue;
        const r = imageData.data[idx], g = imageData.data[idx + 1], b2 = imageData.data[idx + 2];
        const key = `${r},${g},${b2}`;
        const match = lookup.get(key);
        const customMatch = customLookup.get(key);
        if (match) {
          pixelShade.set(z, { shade: match.shade, isWater: match.baseIndex === WATER_BASE_INDEX });
        } else if (customMatch) {
          pixelShade.set(z, { shade: customMatch.shade, isWater: false });
        }
      }

      // Group blocks by z
      const zToBlocks = new Map<number, BlockEntry[]>();
      for (const b of colBlocks) {
        if (!zToBlocks.has(b.z)) zToBlocks.set(b.z, []);
        zToBlocks.get(b.z)!.push(b);
      }

      const zValues = [...zToBlocks.keys()].sort((a, b) => a - b);

      // Identify primary z-rows and water z-rows
      const waterZ = new Set<number>();
      const primaryZ: number[] = [];
      for (const z of zValues) {
        const info = pixelShade.get(z);
        if (info) {
          primaryZ.push(z);
          if (info.isWater) waterZ.add(z);
        }
      }

      // Snapshot original maxY and minY per primary z (before any mutations)
      const origMaxY = new Map<number, number>();
      const origMinY = new Map<number, number>();
      for (const z of primaryZ) {
        const bs = zToBlocks.get(z)!;
        origMaxY.set(z, Math.max(...bs.map(b => b.y)));
        origMinY.set(z, Math.min(...bs.map(b => b.y)));
      }

      // Track current maxY (updated as segments are moved)
      const currentMaxY = new Map<number, number>(origMaxY);

      // Track per-primary-z delta applied (for filler shifting later)
      const deltaApplied = new Map<number, number>();
      for (const z of primaryZ) deltaApplied.set(z, 0);

      // Build segments: contiguous non-water z-runs with same maxY,
      // optionally preceded by a water pillar whose top-y matches.
      interface ValleySegment {
        zList: number[];
        topY: number;
        waterDepth?: number; // depth of water pillar if segment includes one
      }

      const processed = new Set<number>();
      const segments: ValleySegment[] = [];
      const nonWaterPrimary = primaryZ.filter(z => !waterZ.has(z));

      let i = 0;
      while (i < nonWaterPrimary.length) {
        const startZ = nonWaterPrimary[i];
        const y = origMaxY.get(startZ)!;
        let j = i + 1;
        while (
          j < nonWaterPrimary.length &&
          nonWaterPrimary[j] === nonWaterPrimary[j - 1] + 1 &&
          origMaxY.get(nonWaterPrimary[j])! === y
        ) {
          ++j;
        }
        const zList = nonWaterPrimary.slice(i, j);

        // Check if the z immediately north is a water pillar whose top-y matches
        const northZ = zList[0] - 1;
        let wDepth: number | undefined;
        if (waterZ.has(northZ) && origMaxY.get(northZ) === y) {
          wDepth = origMaxY.get(northZ)! - origMinY.get(northZ)! + 1;
          zList.unshift(northZ);
          processed.add(northZ);
        }

        for (const z of zList) processed.add(z);
        segments.push({ zList, topY: y, waterDepth: wDepth });
        i = j;
      }

      // Remaining water pillars not attached to a segment
      for (const z of primaryZ) {
        if (waterZ.has(z) && !processed.has(z)) {
          const depth = origMaxY.get(z)! - origMinY.get(z)! + 1;
          segments.push({ zList: [z], topY: origMaxY.get(z)!, waterDepth: depth });
          processed.add(z);
        }
      }

      // Sort by topY ascending (process lowest first)
      segments.sort((a, b) => a.topY - b.topY);

      // Process each segment
      for (const seg of segments) {
        const southZ = seg.zList[seg.zList.length - 1] + 1;
        const southInfo = pixelShade.get(southZ); // shade from source image

        let targetTopY: number;
        if (!southInfo || southInfo.isWater || southInfo.shade === 2) {
          targetTopY = 0;
        } else {
          // Dark shade south → stack above south's current maxY
          const southY = currentMaxY.get(southZ);
          targetTopY = southY !== undefined ? southY + 1 : 0;
        }

        // Enforce north constraint: segment's own shade dictates relationship to north
        const firstNonWaterZ = seg.zList.find(z => !waterZ.has(z));
        if (firstNonWaterZ !== undefined) {
          const northOfSegZ = firstNonWaterZ - 1;
          // Skip if northOfSegZ is part of this segment (e.g. the included water pillar)
          const isInSegment = seg.zList.includes(northOfSegZ);
          const segInfo = pixelShade.get(firstNonWaterZ);
          if (segInfo && !isInSegment && currentMaxY.has(northOfSegZ)) {
            const northY = currentMaxY.get(northOfSegZ)!;
            if (segInfo.shade === 2) {
              // Light: this segment must be strictly higher than its north neighbor
              targetTopY = Math.max(targetTopY, northY + 1);
            } else if (segInfo.shade === 1) {
              // Normal: this segment must be at same height as its north neighbor
              targetTopY = Math.max(targetTopY, northY);
            }
            // Dark (shade 0/3): segment should be lower than north, no min constraint
          }
        }

        // Constrain: if segment has a water pillar, its bottom must not go below 0
        if (seg.waterDepth !== undefined && seg.waterDepth > 1) {
          const waterBottom = targetTopY - (seg.waterDepth - 1);
          if (waterBottom < 0) {
            targetTopY += -waterBottom; // raise so bottom lands at 0
          }
        }

        // Special water pillar handling for dark/medium shaded water
        const waterPillarZ = seg.waterDepth !== undefined ? seg.zList[0] : undefined;
        const waterShade = waterPillarZ !== undefined ? pixelShade.get(waterPillarZ) : undefined;
        const isDarkMediumWater =
          waterShade && (waterShade.shade === 0 || waterShade.shade === 1 || waterShade.shade === 3);

        if (isDarkMediumWater && seg.waterDepth !== undefined && seg.waterDepth > 1) {
          const waterBottomAfter = targetTopY - (seg.waterDepth - 1);

          if (seg.zList.length === 1) {
            // Case 1: Single-block water-only segment, south is dark shade
            const southShade = pixelShade.get(southZ);
            if (southShade && (southShade.shade === 0 || southShade.shade === 3) && waterBottomAfter !== 0) {
              const southY = currentMaxY.get(southZ);
              if (southY !== undefined) {
                targetTopY = southY + (seg.waterDepth - 1);
              }
            }
          } else if (waterBottomAfter !== 0) {
            // Case 2: Multi-block segment with water as northmost block
            // Keep water pillar height, place its bottom-y at southY
            // Rest of segment aligned with water top-y; shared post-pass adds convenience fillers.
            const southY = currentMaxY.get(southZ);
            if (southY !== undefined) {
              // Water pillar keeps its depth, bottom placed at southY
              const newTargetTopY = southY + (seg.waterDepth - 1);
              const delta = newTargetTopY - seg.topY;

              // Apply delta to all blocks (moves segment so water top = newTargetTopY)
              for (const z of seg.zList) {
                if (zToBlocks.has(z)) {
                  for (const b of zToBlocks.get(z)!) b.y += delta;
                }
                currentMaxY.set(z, currentMaxY.get(z)! + delta);
                deltaApplied.set(z, (deltaApplied.get(z) || 0) + delta);
              }
              continue; // skip the generic delta application below
            }
          }
        }

        const delta = targetTopY - seg.topY;
        if (delta !== 0) {
          for (const z of seg.zList) {
            if (zToBlocks.has(z)) {
              for (const b of zToBlocks.get(z)!) b.y += delta;
            }
            currentMaxY.set(z, currentMaxY.get(z)! + delta);
            deltaApplied.set(z, (deltaApplied.get(z) || 0) + delta);
          }
        }
      }

      // Shift filler-only z-rows by the same delta as their supported primary z (z+1)
      for (const z of zValues) {
        if (pixelShade.has(z)) continue; // skip primary rows
        const supportedZ = z + 1;
        const d = deltaApplied.get(supportedZ);
        if (d !== undefined && d !== 0) {
          for (const b of zToBlocks.get(z)!) b.y += d;
        } else if (d === undefined) {
          // Orphan filler, shift to y=0
          const bs = zToBlocks.get(z)!;
          const minY = Math.min(...bs.map(b => b.y));
          for (const b of bs) b.y -= minY;
        }
      }
    }
  }
}

// Staircase (Pro Version): randomize Y positions while preserving shade constraints
function applyProMode(blocks: BlockEntry[], imageData: ImageData, options: ConversionOptions) {
  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(options.customColors);
  const seedBase = options.proPaletteSeed ? (42 ^ getProPaletteSeedOffset(options.blockMapping)) >>> 0 : 42;

  // Simple seeded RNG for reproducibility per column
  function mulberry32(seed: number) {
    return () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const columns = new Map<number, BlockEntry[]>();
  for (const b of blocks) {
    if (!columns.has(b.x)) columns.set(b.x, []);
    columns.get(b.x)!.push(b);
  }

  for (const [x, colBlocks] of columns) {
    const rand = mulberry32((x * 7919 + seedBase) >>> 0);
    const randomInt = (lo: number, hi: number): number => {
      if (hi <= lo) return lo;
      return lo + Math.floor(rand() * (hi - lo + 1));
    };
    const sampleUniqueSorted = (lo: number, hi: number, count: number): number[] => {
      if (count <= 0 || hi < lo) return [];
      const span = hi - lo + 1;
      if (count >= span) return Array.from({ length: span }, (_, i) => lo + i);
      const pool = Array.from({ length: span }, (_, i) => lo + i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, count).sort((a, b) => a - b);
    };

    // Build pixel info from source image
    const pixelInfo: Map<number, { shade: number; isWater: boolean }> = new Map();
    for (let z = 0; z < 128; ++z) {
      const idx = (z * 128 + x) * 4;
      if (imageData.data[idx + 3] === 0) continue;
      const r = imageData.data[idx], g = imageData.data[idx + 1], b2 = imageData.data[idx + 2];
      const key = `${r},${g},${b2}`;
      const match = lookup.get(key);
      const cm = customLookup.get(key);
      if (match) pixelInfo.set(z, { shade: match.shade, isWater: match.baseIndex === WATER_BASE_INDEX });
      else if (cm) pixelInfo.set(z, { shade: cm.shade, isWater: false });
    }

    // Group blocks by z
    const zToBlocks = new Map<number, BlockEntry[]>();
    for (const b of colBlocks) {
      if (!zToBlocks.has(b.z)) zToBlocks.set(b.z, []);
      zToBlocks.get(b.z)!.push(b);
    }

    // Get primary z values (pixels that exist in source image)
    const primaryZs = [...pixelInfo.keys()].sort((a, b) => a - b);
    if (primaryZs.length === 0) continue;

    // Snapshot original maxY per z
    const origMaxY = new Map<number, number>();
    const origMinY = new Map<number, number>();
    const depthByZ = new Map<number, number>();
    for (const z of primaryZs) {
      const bs = zToBlocks.get(z);
      if (bs) {
        origMaxY.set(z, Math.max(...bs.map(b => b.y)));
        origMinY.set(z, Math.min(...bs.map(b => b.y)));
        depthByZ.set(z, Math.max(...bs.map(b => b.y)) - Math.min(...bs.map(b => b.y)) + 1);
      }
    }

    const lowerBound = (z: number): number => (pixelInfo.get(z)?.isWater ? (depthByZ.get(z) ?? 1) - 1 : 0);
    const upperBound = (_z: number): number => 127;
    const hasPrimary = (z: number): boolean => pixelInfo.has(z);

    // Edge relation for north(z)->south(z+1):
    // +1: south must be higher (light), -1: south must be lower (dark), 0: equal (flat), null: no strict dependency.
    const edgeRel = (northZ: number): -1 | 0 | 1 | null => {
      const southZ = northZ + 1;
      const north = pixelInfo.get(northZ);
      const south = pixelInfo.get(southZ);
      if (!north || !south) return null;
      if (south.isWater) return null;
      if (south.shade === 2) return 1;
      if (south.shade === 1) return 0;
      return -1;
    };

    const isColumnValid = (topY: Map<number, number>): boolean => {
      for (const z of primaryZs) {
        const y = topY.get(z);
        if (y === undefined) return false;
        if (y < lowerBound(z) || y > upperBound(z)) return false;
      }
      for (let northZ = 0; northZ < 127; ++northZ) {
        const rel = edgeRel(northZ);
        if (rel === null) continue;
        const southZ = northZ + 1;
        const yN = topY.get(northZ);
        const yS = topY.get(southZ);
        if (yN === undefined || yS === undefined) continue;
        if (rel === 0) {
          if (yS !== yN) return false;
        } else if (rel === 1) {
          if (!(yS > yN)) return false;
        } else {
          // Dark dependency is strictly relative to the north column top-Y.
          if (!(yS < yN)) {
            return false;
          }
        }
      }
      return true;
    };

    interface Segment {
      start: number;
      end: number;
      dir: -1 | 1;
    }
    const segments: Segment[] = [];
    const endpointHints: { zList: number[]; type: "lower" | "upper" }[] = [];
    const prefTopY = new Map<number, number>();

    // Build monotonic segments directly across contiguous primary rows.
    // Flats stay in-segment; strict direction flips split segments at local extrema.
    let segStart: number | null = null;
    let segDir: -1 | 1 | null = null;
    let prevZ: number | null = null;
    const flush = (endZ: number | null) => {
      if (segStart !== null && segDir !== null && endZ !== null && endZ > segStart) {
        segments.push({ start: segStart, end: endZ, dir: segDir });
      }
      segStart = null;
      segDir = null;
    };

    for (let z = 0; z < 128; ++z) {
      if (!hasPrimary(z)) {
        flush(prevZ);
        prevZ = null;
        continue;
      }
      if (prevZ === null) {
        prevZ = z;
        continue;
      }
      if (z !== prevZ + 1) {
        flush(prevZ);
        prevZ = z;
        continue;
      }

      const rel = edgeRel(prevZ);
      if (rel === null) {
        flush(prevZ);
        prevZ = z;
        continue;
      }
      if (rel === 0) {
        if (segStart === null) segStart = prevZ;
        prevZ = z;
        continue;
      }

      const strictDir: -1 | 1 = rel;
      if (segStart === null) {
        segStart = prevZ;
        segDir = strictDir;
      } else if (segDir === null) {
        segDir = strictDir;
      } else if (strictDir !== segDir) {
        if (prevZ > segStart) segments.push({ start: segStart, end: prevZ, dir: segDir });
        segStart = prevZ; // pivot becomes first element of the new segment
        segDir = strictDir;
      }
      prevZ = z;
    }
    flush(prevZ);

    const applySegmentPreference = (seg: Segment) => {
      const path: number[] = [];
      if (seg.dir === 1) {
        for (let z = seg.start; z <= seg.end; ++z) path.push(z);
      } else {
        for (let z = seg.end; z >= seg.start; z--) path.push(z);
      }
      if (path.length < 2) return;

      const groups: number[][] = [[path[0]]];
      for (let i = 1; i < path.length; ++i) {
        const a = path[i - 1];
        const b = path[i];
        const rel = a < b ? edgeRel(a) : edgeRel(b);
        if (rel === 0) groups[groups.length - 1].push(b);
        else groups.push([b]);
      }

      if (groups.length < 2) return;
      const lowGroup = groups[0];
      const highGroup = groups[groups.length - 1];
      let lowY = Math.max(...lowGroup.map(z => lowerBound(z)));
      const highY = Math.min(...highGroup.map(z => upperBound(z)));

      const minGap = groups.length - 1;
      if (highY - lowY < minGap) {
        // Keep solvable under integer Y while still biasing to extreme endpoints.
        lowY = Math.max(lowY, highY - minGap);
      }

      // Strict-step framing:
      // groups = strictSteps + 1, first group fixed at lowY, last group fixed at highY.
      const strictSteps = groups.length - 1;
      const randomInteriorCount = Math.max(0, strictSteps - 1);
      const interior = sampleUniqueSorted(lowY + 1, highY - 1, randomInteriorCount);
      let values: number[];
      if (interior.length === randomInteriorCount) values = [lowY, ...interior, highY];
      else values = Array.from({ length: groups.length }, (_, i) => Math.min(highY, lowY + i));

      for (let i = 0; i < groups.length; ++i) {
        const y = values[i];
        for (const z of groups[i]) {
          prefTopY.set(z, y);
        }
      }

      endpointHints.push({ zList: [...lowGroup], type: "lower" });
      endpointHints.push({ zList: [...highGroup], type: "upper" });
    };

    for (const seg of segments) applySegmentPreference(seg);

    // Freestanding/default prefs.
    for (const z of primaryZs) {
      if (prefTopY.has(z)) continue;
      prefTopY.set(z, randomInt(lowerBound(z), upperBound(z)));
    }

    // Backward feasible intervals so forward assignment doesn't dead-end.
    const minFeas = new Map<number, number>();
    const maxFeas = new Map<number, number>();
    for (const z of primaryZs) {
      minFeas.set(z, lowerBound(z));
      maxFeas.set(z, upperBound(z));
    }

    for (let northZ = 126; northZ >= 0; northZ--) {
      if (!hasPrimary(northZ)) continue;
      let lo = minFeas.get(northZ) ?? lowerBound(northZ);
      let hi = maxFeas.get(northZ) ?? upperBound(northZ);
      const southZ = northZ + 1;
      const rel = edgeRel(northZ);
      if (rel !== null && hasPrimary(southZ)) {
        const sLo = minFeas.get(southZ) ?? lowerBound(southZ);
        const sHi = maxFeas.get(southZ) ?? upperBound(southZ);
        if (rel === 0) {
          lo = Math.max(lo, sLo);
          hi = Math.min(hi, sHi);
        } else if (rel === 1) {
          hi = Math.min(hi, sHi - 1);
        } else {
          lo = Math.max(lo, sLo + 1);
        }
      }
      if (lo > hi) {
        const p = prefTopY.get(northZ) ?? lowerBound(northZ);
        const clamped = Math.min(Math.max(p, lowerBound(northZ)), upperBound(northZ));
        lo = clamped;
        hi = clamped;
      }
      minFeas.set(northZ, lo);
      maxFeas.set(northZ, hi);
    }

    // Forward assignment honoring prefs while preserving constraints.
    const assignedTopY = new Map<number, number>();
    for (let z = 0; z < 128; ++z) {
      if (!hasPrimary(z)) continue;
      let lo = minFeas.get(z) ?? lowerBound(z);
      let hi = maxFeas.get(z) ?? upperBound(z);

      const northZ = z - 1;
      if (northZ >= 0 && hasPrimary(northZ) && assignedTopY.has(northZ)) {
        const rel = edgeRel(northZ);
        if (rel !== null) {
          const yN = assignedTopY.get(northZ)!;
          if (rel === 0) {
            lo = Math.max(lo, yN);
            hi = Math.min(hi, yN);
          } else if (rel === 1) {
            lo = Math.max(lo, yN + 1);
          } else {
            hi = Math.min(hi, yN - 1);
          }
        }
      }

      let y: number;
      if (lo > hi) {
        y = Math.min(Math.max(prefTopY.get(z) ?? lo, lowerBound(z)), upperBound(z));
      } else {
        const pref = prefTopY.get(z) ?? randomInt(lo, hi);
        if (pref < lo || pref > hi) y = Math.min(Math.max(pref, lo), hi);
        else y = pref;
      }
      assignedTopY.set(z, y);
    }

    // Endpoint revisit pass: nudge endpoints inward while preserving validity.
    const uniqueEndpoints = new Map<string, { zList: number[]; type: "lower" | "upper" }>();
    for (const ep of endpointHints) {
      const key = `${ep.type}:${[...ep.zList].sort((a, b) => a - b).join(",")}`;
      uniqueEndpoints.set(key, ep);
    }

    for (const ep of uniqueEndpoints.values()) {
      const zList = ep.zList.filter(z => assignedTopY.has(z));
      if (zList.length === 0) continue;
      const snapshot = new Map<number, number>();
      for (const z of zList) snapshot.set(z, assignedTopY.get(z)!);

      const minY = Math.max(...zList.map(z => lowerBound(z)));
      const maxY = Math.min(...zList.map(z => upperBound(z)));

      if (ep.type === "upper") {
        let maxDown = 0;
        const currTop = Math.min(...zList.map(z => snapshot.get(z)!));
        for (let d = 1; currTop - d >= minY; ++d) {
          for (const z of zList) assignedTopY.set(z, snapshot.get(z)! - d);
          if (isColumnValid(assignedTopY)) maxDown = d;
          else break;
        }
        const chosen = randomInt(0, maxDown);
        for (const z of zList) assignedTopY.set(z, snapshot.get(z)! - chosen);
      } else {
        let maxUp = 0;
        const currBottom = Math.max(...zList.map(z => snapshot.get(z)!));
        for (let d = 1; currBottom + d <= maxY; ++d) {
          for (const z of zList) assignedTopY.set(z, snapshot.get(z)! + d);
          if (isColumnValid(assignedTopY)) maxUp = d;
          else break;
        }
        const chosen = randomInt(0, maxUp);
        for (const z of zList) assignedTopY.set(z, snapshot.get(z)! + chosen);
      }
    }

    // Safety net: if endpoint pass created any invalid state, restore forward assignment.
    if (!isColumnValid(assignedTopY)) {
      assignedTopY.clear();
      for (let z = 0; z < 128; ++z) {
        if (!hasPrimary(z)) continue;
        let lo = minFeas.get(z) ?? lowerBound(z);
        let hi = maxFeas.get(z) ?? upperBound(z);
        const northZ = z - 1;
        if (northZ >= 0 && hasPrimary(northZ) && assignedTopY.has(northZ)) {
          const rel = edgeRel(northZ);
          if (rel !== null) {
            const yN = assignedTopY.get(northZ)!;
            if (rel === 0) lo = hi = yN;
            else if (rel === 1) lo = Math.max(lo, yN + 1);
            else hi = Math.min(hi, yN - 1);
          }
        }
        if (lo > hi) assignedTopY.set(z, Math.min(Math.max(prefTopY.get(z) ?? lo, lowerBound(z)), upperBound(z)));
        else assignedTopY.set(z, randomInt(lo, hi));
      }
    }
    if (!isColumnValid(assignedTopY)) {
      // Absolute safety fallback: preserve original valid staircase tops.
      assignedTopY.clear();
      for (const z of primaryZs) {
        const y = origMaxY.get(z);
        if (y !== undefined) assignedTopY.set(z, y);
      }
    }

    // Apply deltas to blocks
    const deltaApplied = new Map<number, number>();
    for (const z of primaryZs) {
      const origTop = origMaxY.get(z);
      const newTop = assignedTopY.get(z);
      if (origTop === undefined || newTop === undefined) continue;
      const delta = newTop - origTop;
      deltaApplied.set(z, delta);
      const bs = zToBlocks.get(z);
      if (bs) for (const b of bs) b.y += delta;
    }

    // Shift filler rows (z values not in pixelInfo) by their supported primary z (z+1)
    const allZs = [...zToBlocks.keys()].sort((a, b) => a - b);
    for (const z of allZs) {
      if (pixelInfo.has(z)) continue;
      const supportedZ = z + 1;
      const d = deltaApplied.get(supportedZ);
      if (d !== undefined && d !== 0) {
        for (const b of zToBlocks.get(z)!) b.y += d;
      }
    }
  }
}

// Build suppress pairs E→W: zigzag from east to west, returning blocks grouped by step
function buildSuppressPairsEWBlocksByStep(imageData: ImageData, options: ConversionOptions): BlockEntry[][] {
  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(options.customColors);

  const steps: BlockEntry[][] = [];

  let anchor = 127;
  let step = 0;
  let baseY = 0;

  const emitStep = (cols: number[], useEvenRows: boolean) => {
    let maxYUsed = baseY;
    const stepBlocks: BlockEntry[] = [];

    function addBlock(x: number, y: number, z: number, block: string) {
      stepBlocks.push({ x, y, z, blockName: resolveBlockName(block) });
    }

    for (const x of cols) {
      for (let z = 0; z < 128; ++z) {
        const isColorRow = useEvenRows ? z % 2 === 1 : z % 2 === 0;
        if (!isColorRow) continue;

        const idx = (z * 128 + x) * 4;
        const a = imageData.data[idx + 3];
        if (a === 0) continue;

        const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
        const key = `${r},${g},${b}`;

        const match = lookup.get(key);
        const customMatch = customLookup.get(key);
        if (!match && !customMatch) continue;

        const block = customMatch
          ? customMatch.block
          : options.blockMapping[(match as ColorMatch).baseIndex] ||
            BASE_COLORS[(match as ColorMatch).baseIndex].blocks[0];
        if (!block) continue;

        // Water: stack from baseY upward by depth
        if (!customMatch && (match as ColorMatch).baseIndex === WATER_BASE_INDEX) {
          const depth = getWaterDepth((match as ColorMatch).shade, x, z);
          for (let d = 0; d < depth; ++d) {
            addBlock(x, baseY + d, z, block);
          }
          if (baseY + depth - 1 > maxYUsed) maxYUsed = baseY + depth - 1;
        } else {
          // Color block at baseY
          addBlock(x, baseY, z, block);

          // Support block under color block if needed
          const needsSupport =
            !isFillerDisabled(options.fillerBlock) &&
            (options.supportMode === "all" ||
              (options.supportMode === "fragile" && isFragileBlock(block)) ||
              options.supportMode === "steps");
          if (needsSupport && baseY > 0) {
            addBlock(x, baseY - 1, z, options.fillerBlock);
          }
          if (needsSupport && baseY > maxYUsed) {
            maxYUsed = Math.max(maxYUsed, baseY);
          }

          // Filler north of color row based on shade
          if (!isShadeFillerDisabled(options.fillerBlock)) {
            const shade = customMatch ? customMatch.shade : (match as ColorMatch).shade;
            if (shade === 1) {
              // Medium: filler at same level north
              addBlock(x, baseY, z - 1, options.fillerBlock);
            } else if (shade !== 2) {
              // Dark (shade 0 or 3): filler 1 higher north
              addBlock(x, baseY + 1, z - 1, options.fillerBlock);
              if (baseY + 1 > maxYUsed) maxYUsed = baseY + 1;
              if (options.supportMode === "steps" || options.supportMode === "all") {
                addBlock(x, baseY, z - 1, options.fillerBlock);
              }
            }
          }
        }
      }
    }

    steps.push(stepBlocks);
    baseY = maxYUsed + 1;
  };

  while (anchor >= 0) {
    const cols = step === 0 ? [127] : [anchor + 1, anchor];
    const useEvenRows = step % 2 === 0;
    emitStep(cols, useEvenRows);
    --anchor;
    ++step;
  }

  // West-edge cap step: fill the opposite checker parity for x=0 that is missed by the final 2-col pass.
  emitStep([0], step % 2 === 0);

  return steps;
}

// Build suppress checker E→W: overlapping 4-column steps.
// In each 4-column step:
// - Eastern 2 columns place dominant cells only ((x+z)%2===1)
// - Western 2 columns place recessive cells only ((x+z)%2===0)
// Consecutive steps shift 2 columns west, so overlap columns are completed in the next step.
function buildSuppressCheckerEWBlocksByStep(imageData: ImageData, options: ConversionOptions): BlockEntry[][] {
  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(options.customColors);

  const steps: BlockEntry[][] = [];
  let baseY = 0;

  const emitStep = (cols: number[], dominantCols: Set<number>, recessiveCols: Set<number>) => {
    let maxYUsed = baseY;
    const stepBlocks: BlockEntry[] = [];
    function addBlock(x: number, y: number, z: number, block: string) {
      stepBlocks.push({ x, y, z, blockName: resolveBlockName(block) });
    }

    for (const x of cols) {
      if (x < 0 || x >= 128) continue;
      for (let z = 0; z < 128; ++z) {
        const isDominant = ((x + z) & 1) === 1;
        if (isDominant) {
          if (!dominantCols.has(x)) continue;
        } else if (!recessiveCols.has(x)) {
          continue;
        }

        const idx = (z * 128 + x) * 4;
        const a = imageData.data[idx + 3];
        if (a === 0) continue;

        const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
        const key = `${r},${g},${b}`;
        const match = lookup.get(key);
        const customMatch = customLookup.get(key);
        if (!match && !customMatch) continue;

        const block = customMatch
          ? customMatch.block
          : options.blockMapping[(match as ColorMatch).baseIndex] ||
            BASE_COLORS[(match as ColorMatch).baseIndex].blocks[0];
        if (!block) continue;

        if (!customMatch && (match as ColorMatch).baseIndex === WATER_BASE_INDEX) {
          const depth = getWaterDepth((match as ColorMatch).shade, x, z);
          for (let d = 0; d < depth; ++d) addBlock(x, baseY + d, z, block);
          if (baseY + depth - 1 > maxYUsed) maxYUsed = baseY + depth - 1;
          continue;
        }

        addBlock(x, baseY, z, block);

        const needsSupport =
          !isFillerDisabled(options.fillerBlock) &&
          (options.supportMode === "all" ||
            (options.supportMode === "fragile" && isFragileBlock(block)) ||
            options.supportMode === "steps");
        if (needsSupport && baseY > 0) addBlock(x, baseY - 1, z, options.fillerBlock);
        if (needsSupport && baseY > maxYUsed) maxYUsed = Math.max(maxYUsed, baseY);

        if (!isShadeFillerDisabled(options.fillerBlock)) {
          const shade = customMatch ? customMatch.shade : (match as ColorMatch).shade;
          if (shade === 1) {
            addBlock(x, baseY, z - 1, options.fillerBlock);
          } else if (shade !== 2) {
            addBlock(x, baseY + 1, z - 1, options.fillerBlock);
            if (baseY + 1 > maxYUsed) maxYUsed = baseY + 1;
            if (options.supportMode === "steps" || options.supportMode === "all") {
              addBlock(x, baseY, z - 1, options.fillerBlock);
            }
          }
        }
      }
    }

    steps.push(stepBlocks);
    baseY = maxYUsed + 1;
  };

  // Edge bootstrap to cover easternmost recessive cells, then overlap by 2 columns per step.
  emitStep([127, 126], new Set<number>(), new Set<number>([127, 126]));
  for (let start = 124; start >= 0; start -= 2) {
    const cols = [start + 3, start + 2, start + 1, start];
    emitStep(cols, new Set<number>([start + 3, start + 2]), new Set<number>([start + 1, start]));
  }
  // Edge cap to cover westernmost dominant cells.
  emitStep([1, 0], new Set<number>([1, 0]), new Set<number>());

  return steps;
}

// Flatten all steps into a single block list
function buildSuppressPairsEWBlocks(imageData: ImageData, options: ConversionOptions): BlockEntry[] {
  return buildSuppressPairsEWBlocksByStep(imageData, options).flat();
}
function buildSuppressCheckerEWBlocks(imageData: ImageData, options: ConversionOptions): BlockEntry[] {
  return buildSuppressCheckerEWBlocksByStep(imageData, options).flat();
}
// Build suppress dual-layer blocks using dominant/recessive checkerboard mechanics.
// Recessive cells are (x+z)%2==0 (same parity as the top-left pixel), dominant are the other half.
// Primary solids/water are placed first, then shade-casting fillers are added while avoiding collisions.
function buildSuppressDualLayerBlocks(
  imageData: ImageData,
  options: ConversionOptions,
  variant: "classic" | "late_flat_vs" = "classic",
): BlockEntry[] {
  const lookup = getColorLookup();
  const customLookup = buildCustomColorLookup(options.customColors);

  interface PixelInfo {
    shade: number; // MC shade: 0=dark, 1=flat, 2=light, 3=darkest(in table)
    block: string;
    isWater: boolean;
  }

  const pixelGrid: (PixelInfo | null)[][] = Array.from({ length: 128 }, () => new Array<PixelInfo | null>(128).fill(null));
  const topYGrid: (number | undefined)[][] = Array.from({ length: 128 }, () => new Array<number | undefined>(128).fill(undefined));
  const blocks: BlockEntry[] = [];
  const occupied = new Set<string>();
  const fillerOff = isShadeFillerDisabled(options.fillerBlock);
  const lowerY = 0;
  const upperY = Math.max(1, options.layerGap ?? 5);
  const lateY = upperY + 2;
  const loweredRecessive = new Set<string>();
  const lateDominant = new Set<string>();

  const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const cellKey = (x: number, z: number) => `${x},${z}`;
  const isRecessive = (x: number, z: number) => (x + z) % 2 === 0;
  const isDominant = (x: number, z: number) => !isRecessive(x, z);
  const isDarkShade = (shade: number) => shade === 0 || shade === 3;
  const shadeDeltaFromSouth = (shade: number) => (shade === 2 ? 1 : shade === 1 ? 0 : -1);

  function addBlock(x: number, y: number, z: number, block: string) {
    const key = keyOf(x, y, z);
    if (occupied.has(key)) return;
    blocks.push({ x, y, z, blockName: resolveBlockName(block) });
    occupied.add(key);
  }

  function getPixelInfo(x: number, z: number): PixelInfo | null {
    if (z < 0 || z >= 128 || x < 0 || x >= 128) return null;
    const idx = (z * 128 + x) * 4;
    if (imageData.data[idx + 3] === 0) return null;
    const r = imageData.data[idx], g = imageData.data[idx + 1], b = imageData.data[idx + 2];
    const key = `${r},${g},${b}`;
    const match = lookup.get(key);
    const customMatch = customLookup.get(key);
    if (!match && !customMatch) return null;
    const block = customMatch
      ? customMatch.block
      : options.blockMapping[(match as ColorMatch).baseIndex] || BASE_COLORS[(match as ColorMatch).baseIndex].blocks[0];
    if (!block) return null;
    return {
      shade: customMatch ? customMatch.shade : (match as ColorMatch).shade,
      block,
      isWater: !customMatch && (match as ColorMatch).baseIndex === WATER_BASE_INDEX,
    };
  }

  // Snapshot source pixel data up front.
  for (let x = 0; x < 128; ++x) {
    for (let z = 0; z < 128; ++z) {
      pixelGrid[x][z] = getPixelInfo(x, z);
    }
  }

  // Optimization: certain recessive pixels can drop to the dominant layer when they replace
  // the north filler of the dominant-flat pixel directly south.
  for (let x = 0; x < 128; ++x) {
    for (let recZ = 0; recZ < 127; ++recZ) {
      if (!isRecessive(x, recZ)) continue;
      const domZ = recZ + 1;
      if (!isDominant(x, domZ)) continue;

      const dom = pixelGrid[x][domZ];
      const rec = pixelGrid[x][recZ];
      if (!dom || !rec) continue;
      if (dom.isWater || rec.isWater) continue;

      // Only when replacing the filler for a flat dominant pixel directly south.
      if (dom.shade !== 1) continue;

      const northZ = recZ - 1;
      const north = northZ >= 0 ? pixelGrid[x][northZ] : null;

      let canLower = false;
      if (isDarkShade(rec.shade)) {
        // Dark recessive can only drop at top row; it still requires +1Y north filler.
        canLower = recZ === 0;
      } else if (rec.shade === 1) {
        // Flat recessive can drop at top row, or if north is a regular dominant block.
        const hasRegularNorthDominant = northZ >= 0 && isDominant(x, northZ) && !!north && !north.isWater;
        canLower = recZ === 0 || hasRegularNorthDominant;
      } else if (rec.shade === 2) {
        // Light recessive can drop only if north pixel is transparent.
        canLower = !north;
      }

      if (canLower) loweredRecessive.add(cellKey(x, recZ));
    }
  }

  // Place solids and water pillars first (south -> north per column).
  for (let x = 0; x < 128; ++x) {
    for (let z = 127; z >= 0; z--) {
      const info = pixelGrid[x][z];
      if (!info) continue;

      if (info.isWater) {
        const south = z < 127 ? pixelGrid[x][z + 1] : null;
        const southTopY = z < 127 ? topYGrid[x][z + 1] : undefined;
        let topY = lowerY - 1;

        // Recessive-water may need to provide shading for its dominant south neighbor.
        // Dominant-water can stay at the standard lowered position.
        if (isRecessive(x, z) && south && !south.isWater && southTopY !== undefined) {
          topY = southTopY + shadeDeltaFromSouth(info.shade);
        }

        const depth = getWaterDepth(info.shade, x, z);
        for (let d = 0; d < depth; ++d) {
          addBlock(x, topY - d, z, info.block);
        }
        topYGrid[x][z] = topY;
        continue;
      }

      let y = isDominant(x, z) || loweredRecessive.has(cellKey(x, z)) ? lowerY : upperY;
      // Late-Flat-VS variant: flat-shaded dominant pixels south of void are moved to the top late layer.
      if (
        variant === "late_flat_vs" &&
        isDominant(x, z) &&
        info.shade === 1 &&
        z > 0 &&
        !pixelGrid[x][z - 1]
      ) {
        y = lateY;
        lateDominant.add(cellKey(x, z));
      }
      addBlock(x, y, z, info.block);
      topYGrid[x][z] = y;
    }
  }

  if (fillerOff) return blocks;

  // Add shade-casting fillers after primary placement.
  const fillerPlacements = new Map<string, string>();
  const resolvedNormal = resolveBlockName(options.fillerBlock);
  const resolvedDelayed = resolveBlockName(options.suppress2LayerDelayedFillerBlock || options.fillerBlock);

  for (let x = 0; x < 128; ++x) {
    for (let z = 0; z < 128; ++z) {
      const info = pixelGrid[x][z];
      if (!info || info.isWater || info.shade === 2) continue; // light shade needs no north filler

      const topY = topYGrid[x][z];
      if (topY === undefined) continue;
      const fillY = topY + (isDarkShade(info.shade) ? 1 : 0);
      const fillZ = z - 1;
      const posKey = keyOf(x, fillY, fillZ);

      // Do not overwrite primary blocks (especially water pillars).
      if (occupied.has(posKey)) continue;

      const isDelayedDominantVoidShadow = isDominant(x, z) && fillZ >= 0 && !pixelGrid[x][fillZ];

      if (isDelayedDominantVoidShadow) {
        if (variant === "late_flat_vs") {
          // In Late-Flat-VS, all delayed placements are moved to a single top late layer.
          const latePosKey = keyOf(x, lateY, fillZ);
          if (!occupied.has(latePosKey)) fillerPlacements.set(latePosKey, resolvedNormal);
        } else {
          // Classic 2-layer keeps delayed fillers in-grid and allows a separate late-filler block.
          fillerPlacements.set(posKey, resolvedDelayed);
        }
        continue;
      }

      fillerPlacements.set(posKey, resolvedNormal);
    }
  }

  if (variant === "late_flat_vs") {
    // If a recessive pixel was lowered and its north dominant was moved late, preserve recessive flat shading
    // during the first map update by adding an in-phase north filler at recessive Y.
    for (const key of loweredRecessive) {
      const [xs, zs] = key.split(",");
      const x = parseInt(xs);
      const z = parseInt(zs);
      const info = pixelGrid[x][z];
      if (!info || info.isWater || info.shade !== 1) continue;
      const northZ = z - 1;
      if (northZ < 0) continue;
      if (!lateDominant.has(cellKey(x, northZ))) continue;
      const recY = topYGrid[x][z];
      if (recY === undefined) continue;
      const posKey = keyOf(x, recY, northZ);
      if (!occupied.has(posKey)) fillerPlacements.set(posKey, resolvedNormal);
    }
  }

  for (const [posKey, blockName] of fillerPlacements.entries()) {
    if (occupied.has(posKey)) continue;
    const [xs, ys, zs] = posKey.split(",");
    blocks.push({
      x: parseInt(xs),
      y: parseInt(ys),
      z: parseInt(zs),
      blockName,
    });
    occupied.add(posKey);
  }

  return blocks;
}

// Filter blocks by column range if specified
function filterByColumnRange(blocks: BlockEntry[], range?: [number, number]): BlockEntry[] {
  if (!range) return blocks;
  const [start, end] = range;
  return blocks.filter(b => b.x >= start && b.x <= end);
}

// Compute material counts from actual block generation
export function computeMaterialCounts(imageData: ImageData, options: ConversionOptions): Record<string, number> {
  const counts: Record<string, number> = {};
  const range = options.columnRange;
  function countBlocks(blocks: BlockEntry[]) {
    for (const b of filterByColumnRange(blocks, range)) {
      const name = toDisplayName(b.blockName);
      counts[name] = (counts[name] || 0) + 1;
    }
  }

  if (options.buildMode === "suppress_rowsplit") {
    const [h0, h1] = buildSuppressRowSplitBlocks(imageData, options);
    countBlocks(h0);
    countBlocks(h1);
  } else if (options.buildMode === "suppress_checker") {
    const [dominant, recessive] = buildSuppressCheckerBlocks(imageData, options);
    countBlocks(dominant);
    countBlocks(recessive);
  } else if (options.buildMode === "suppress_pairs_ew" || options.buildMode === "suppress_checker_ew") {
    // Material count = max occurrence of each block across any single step/segment
    const steps =
      options.buildMode === "suppress_checker_ew"
        ? buildSuppressCheckerEWBlocksByStep(imageData, options)
        : buildSuppressPairsEWBlocksByStep(imageData, options);
    const [sStart, sEnd] = options.stepRange ?? [0, steps.length - 1];
    for (let i = sStart; i <= sEnd && i < steps.length; ++i) {
      const stepBlocks = steps[i];
      applySupport(stepBlocks, options);
      const stepCounts: Record<string, number> = {};
      for (const b of stepBlocks) {
        const name = toDisplayName(b.blockName);
        stepCounts[name] = (stepCounts[name] || 0) + 1;
      }
      for (const [name, c] of Object.entries(stepCounts)) {
        counts[name] = Math.max(counts[name] || 0, c);
      }
    }
  } else if (options.buildMode === "suppress_2layer_late_fillers" || options.buildMode === "suppress_2layer_late_pairs") {
    const variant = options.buildMode === "suppress_2layer_late_pairs" ? "late_flat_vs" : "classic";
    const blocks = buildSuppressDualLayerBlocks(imageData, options, variant);
    applySupport(blocks, options);
    countBlocks(blocks);
  } else {
    const blocks = buildStaircaseModeBlocks(imageData, options);
    applySupport(blocks, options);
    countBlocks(blocks);
  }

  return counts;
}

function canonicalBlockSignature(blocks: BlockEntry[], forceZ129 = false): string {
  const clone = blocks.map(b => ({ ...b }));
  const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(clone, forceZ129);
  clone.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z || a.blockName.localeCompare(b.blockName));
  return [
    `${sizeX},${sizeY},${sizeZ},${clone.length}`,
    ...clone.map(b => `${b.x},${b.y},${b.z},${b.blockName}`),
  ].join("|");
}

// Build-mode structural signature for duplicate-trimming UI logic.
export function computeBuildModeSignature(imageData: ImageData, options: ConversionOptions): string {
  if (options.buildMode === "suppress_rowsplit") {
    const [h0, h1] = buildSuppressRowSplitBlocks(imageData, options);
    return `${canonicalBlockSignature(h0, options.forceZ129 === true)}||${canonicalBlockSignature(h1, options.forceZ129 === true)}`;
  }
  if (options.buildMode === "suppress_checker") {
    const [dominant, recessive] = buildSuppressCheckerBlocks(imageData, options);
    return `${canonicalBlockSignature(dominant, options.forceZ129 === true)}||${canonicalBlockSignature(recessive, options.forceZ129 === true)}`;
  }

  if (options.buildMode === "suppress_pairs_ew" || options.buildMode === "suppress_checker_ew") {
    const blocks =
      options.buildMode === "suppress_checker_ew"
        ? buildSuppressCheckerEWBlocks(imageData, options)
        : buildSuppressPairsEWBlocks(imageData, options);
    applySupport(blocks, options);
    return canonicalBlockSignature(blocks, options.forceZ129 === true);
  }

  if (options.buildMode === "suppress_2layer_late_fillers" || options.buildMode === "suppress_2layer_late_pairs") {
    const variant = options.buildMode === "suppress_2layer_late_pairs" ? "late_flat_vs" : "classic";
    const blocks = buildSuppressDualLayerBlocks(imageData, options, variant);
    applySupport(blocks, options);
    return canonicalBlockSignature(blocks, options.forceZ129 === true);
  }

  const blocks = buildStaircaseModeBlocks(imageData, options);
  applySupport(blocks, options);
  return canonicalBlockSignature(blocks, options.forceZ129 === true);
}

export interface FillerNeedStats {
  total: number;
  inGrid: number; // z>=0
  north: number; // z<0
  delayedTotal: number;
  delayedInGrid: number;
  northIsSingleLine: boolean;
}

// Analyze where shading fillers are required by the current build mode.
// Uses sentinel block IDs and ignores optional support-mode fillers.
export function analyzeFillerNeeds(imageData: ImageData, options: ConversionOptions): FillerNeedStats {
  const sentinel = "__filler_analysis__";
  const delayedSentinel = "__filler_analysis_delayed__";
  const resolvedSentinel = resolveBlockName(sentinel);
  const resolvedDelayed = resolveBlockName(delayedSentinel);

  const analysisOptions: ConversionOptions = {
    ...options,
    fillerBlock: sentinel,
    suppress2LayerDelayedFillerBlock: delayedSentinel,
    supportMode: "none",
  };

  const allBlocks: BlockEntry[] = [];

  if (analysisOptions.buildMode === "suppress_rowsplit") {
    const [h0, h1] = buildSuppressRowSplitBlocks(imageData, analysisOptions);
    allBlocks.push(...h0, ...h1);
  } else if (analysisOptions.buildMode === "suppress_checker") {
    const [dominant, recessive] = buildSuppressCheckerBlocks(imageData, analysisOptions);
    allBlocks.push(...dominant, ...recessive);
  } else if (analysisOptions.buildMode === "suppress_pairs_ew" || analysisOptions.buildMode === "suppress_checker_ew") {
    allBlocks.push(
      ...(analysisOptions.buildMode === "suppress_checker_ew"
        ? buildSuppressCheckerEWBlocks(imageData, analysisOptions)
        : buildSuppressPairsEWBlocks(imageData, analysisOptions)),
    );
  } else if (analysisOptions.buildMode === "suppress_2layer_late_fillers" || analysisOptions.buildMode === "suppress_2layer_late_pairs") {
    const variant = analysisOptions.buildMode === "suppress_2layer_late_pairs" ? "late_flat_vs" : "classic";
    allBlocks.push(...buildSuppressDualLayerBlocks(imageData, analysisOptions, variant));
  } else {
    const blocks = buildStaircaseModeBlocks(imageData, analysisOptions, false);
    allBlocks.push(...blocks);
  }

  let total = 0;
  let inGrid = 0;
  let north = 0;
  let delayedTotal = 0;
  let delayedInGrid = 0;
  const northY = new Set<number>();
  const northZ = new Set<number>();
  for (const b of allBlocks) {
    if (b.blockName === resolvedSentinel || b.blockName === resolvedDelayed) {
      ++total;
      const isDelayed = b.blockName === resolvedDelayed;
      if (isDelayed) ++delayedTotal;
      if (b.z >= 0) {
        ++inGrid;
        if (isDelayed) ++delayedInGrid;
      } else {
        ++north;
        northY.add(b.y);
        northZ.add(b.z);
      }
    }
  }

  const northIsSingleLine = north === 0 || (northY.size === 1 && northZ.size === 1);
  return { total, inGrid, north, delayedTotal, delayedInGrid, northIsSingleLine };
}
