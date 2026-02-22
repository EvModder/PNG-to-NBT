// PNG → NBT conversion logic

import { BASE_COLORS, getColorLookup, type ColorMatch } from "../data/mapColors";
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
  | "staircase_valley"
  | "staircase_classic"
  | "staircase_northline"
  | "staircase_southline"
  | "staircase_cancer"
  | "suppress_checker"
  | "suppress_pairs"
  | "suppress_pairs_ew"
  | "suppress_dual_layer";

export type SupportMode = "none" | "steps" | "all" | "fragile" | "water";

export interface ConversionOptions {
  blockMapping: Record<number, string>;
  fillerBlock: string;
  customColors: CustomColor[];
  buildMode: BuildMode;
  supportMode: SupportMode;
  baseName: string;
  layerGap?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  usedBaseColors: Set<number>;
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
  const customLookup = new Map<string, CustomColor>();
  for (const cc of customColors) {
    customLookup.set(`${cc.r},${cc.g},${cc.b}`, cc);
  }

  const invalidColors: string[] = [];

  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
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

function isFillerDisabled(fillerBlock: string): boolean {
  const lower = fillerBlock.trim().toLowerCase();
  return lower === "air" || lower === "none";
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
    return `${fullName}[${propKeys.map((k) => `${k}=${props[k]}`).join(",")}]`;
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
  const customLookup = new Map<string, CustomColor>();
  for (const cc of options.customColors) {
    customLookup.set(`${cc.r},${cc.g},${cc.b}`, cc);
  }

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

  for (let z = 0; z < 128; z++) {
    const currRow: ColState[] = new Array(128);

    for (let x = 0; x < 128; x++) {
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
        if (northTransparent && !isFillerDisabled(options.fillerBlock)) {
          addBlock(x, northY, z - 1, options.fillerBlock);
        }
        addBlock(x, northY, z, customMatch.block);
        currRow[x] = { y: northY, transparent: false };
        continue;
      }

      const { baseIndex, shade } = match as ColorMatch;
      const baseColor = BASE_COLORS[baseIndex];
      const block = options.blockMapping[baseIndex] || baseColor.blocks[0];

      if (!block) {
        currRow[x] = { y: prevRow[x].y, transparent: true };
        continue;
      }

      if (baseColor.isWater) {
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
        for (let d = 0; d < depth; d++) {
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
          if (northTransparent && !isFillerDisabled(options.fillerBlock)) addBlock(x, northY, z - 1, options.fillerBlock);
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
            if (northTransparent && !isFillerDisabled(options.fillerBlock)) addBlock(x, darkY + 1, z - 1, options.fillerBlock);
            addBlock(x, darkY, z, block);
            currRow[x] = { y: darkY, transparent: false };
          } else {
            const darkRef = northState.waterBottom !== undefined ? northState.waterBottom! : northY;
            if (northTransparent && !isFillerDisabled(options.fillerBlock)) addBlock(x, darkRef, z - 1, options.fillerBlock);
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
function normalizeAndMeasure(blocks: BlockEntry[]): { sizeX: number; sizeY: number; sizeZ: number } {
  if (blocks.length === 0) return { sizeX: 128, sizeY: 1, sizeZ: 128 };

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
  return {
    sizeX: 128,
    sizeY: maxY - minY + 1,
    sizeZ: Math.max(rawSizeZ, minSizeZ),
  };
}

// Convert validated PNG to NBT (returns Uint8Array for .nbt or .zip)
export async function convertToNbt(
  imageData: ImageData,
  options: ConversionOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  if (options.buildMode === "suppress_pairs") {
    return buildSuppressPairs(imageData, options);
  }

  if (options.buildMode === "suppress_pairs_ew") {
    const blocks = buildSuppressPairsEWBlocks(imageData, options);
    applySupport(blocks, options);
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks);
    const nbtData = writeStructureNbt(blocks, sizeX, sizeY, sizeZ);
    return { data: await gzipCompress(nbtData), isZip: false };
  }

  if (options.buildMode === "suppress_dual_layer") {
    const blocks = buildSuppressDualLayerBlocks(imageData, options);
    applySupport(blocks, options);
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks);
    const nbtData = writeStructureNbt(blocks, sizeX, sizeY, sizeZ);
    return { data: await gzipCompress(nbtData), isZip: false };
  }

  const blocks = buildStaircaseBlocks(imageData, options);
  applyStaircaseVariant(blocks, options.buildMode, imageData, options);

  applySupport(blocks, options);

  const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks);
  const nbtData = writeStructureNbt(blocks, sizeX, sizeY, sizeZ);
  return { data: await gzipCompress(nbtData), isZip: false };
}

// Build suppress pairs block lists (two halves)
function buildSuppressPairsBlocks(imageData: ImageData, options: ConversionOptions): [BlockEntry[], BlockEntry[]] {
  const lookup = getColorLookup();
  const customLookup = new Map<string, CustomColor>();
  for (const cc of options.customColors) {
    customLookup.set(`${cc.r},${cc.g},${cc.b}`, cc);
  }

  function buildHalf(startRow: 0 | 1): BlockEntry[] {
    const blocks: BlockEntry[] = [];

    function addBlock(x: number, y: number, z: number, block: string) {
      blocks.push({ x, y, z, blockName: resolveBlockName(block) });
    }

    for (let z = 0; z < 128; z++) {
      const isColorRow = z % 2 === startRow;
      if (!isColorRow) continue; // only process color rows

      for (let x = 0; x < 128; x++) {
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
        if (!customMatch && BASE_COLORS[(match as ColorMatch).baseIndex].isWater) {
          const depth = getWaterDepth((match as ColorMatch).shade, x, z);
          for (let d = 0; d < depth; d++) {
            addBlock(x, d, z, block);
          }
        } else {
          // Color block at y=0
          addBlock(x, 0, z, block);

          // Filler north of this color row (z-1) based on shade
          const shade = customMatch ? 1 : (match as ColorMatch).shade;
          if (shade === 2) {
            // Light: no filler
          } else if (!isFillerDisabled(options.fillerBlock)) {
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

// Suppress (Pairs E→W): generate two NBTs in a zip
async function buildSuppressPairs(
  imageData: ImageData,
  options: ConversionOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const [half0, half1] = buildSuppressPairsBlocks(imageData, options);

  async function toNbt(blocks: BlockEntry[]): Promise<Uint8Array> {
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks);
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

// Post-process blocks to apply staircase variants
function applyStaircaseVariant(
  blocks: BlockEntry[],
  mode: BuildMode,
  imageData?: ImageData,
  options?: ConversionOptions,
) {
  if (mode === "staircase_northline" || mode === "flat" || mode.startsWith("suppress")) return;

  if (mode === "staircase_cancer" && imageData && options) {
    applyCancerMode(blocks, imageData, options);
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
      const customLookup = new Map<string, CustomColor>();
      for (const cc of options.customColors) {
        customLookup.set(`${cc.r},${cc.g},${cc.b}`, cc);
      }

      // Build pixel info from source image (shade truth)
      const pixelShade = new Map<number, { shade: number; isWater: boolean }>();
      for (let z = 0; z < 128; z++) {
        const idx = (z * 128 + x) * 4;
        const a = imageData.data[idx + 3];
        if (a === 0) continue;
        const r = imageData.data[idx], g = imageData.data[idx + 1], b2 = imageData.data[idx + 2];
        const key = `${r},${g},${b2}`;
        const match = lookup.get(key);
        const customMatch = customLookup.get(key);
        if (match) {
          pixelShade.set(z, { shade: match.shade, isWater: BASE_COLORS[match.baseIndex].isWater });
        } else if (customMatch) {
          pixelShade.set(z, { shade: 1, isWater: false });
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
          j++;
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
        const firstNonWaterZ = seg.zList.find((z) => !waterZ.has(z));
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
            // Rest of segment aligned with water top-y, fillers at southY under non-water blocks
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

              // Place filler blocks at southY under all non-water blocks in segment
              if (!isFillerDisabled(options.fillerBlock)) {
                for (const z of seg.zList) {
                  if (z === waterPillarZ) continue;
                  const fillerBlock: BlockEntry = {
                    x,
                    y: southY,
                    z,
                    blockName: resolveBlockName(options.fillerBlock),
                  };
                  if (zToBlocks.has(z)) {
                    zToBlocks.get(z)!.push(fillerBlock);
                  } else {
                    zToBlocks.set(z, [fillerBlock]);
                  }
                  blocks.push(fillerBlock);
                }
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

// Staircase (Cancer): randomize Y positions while preserving shade constraints
function applyCancerMode(blocks: BlockEntry[], imageData: ImageData, options: ConversionOptions) {
  const lookup = getColorLookup();
  const customLookup = new Map<string, CustomColor>();
  for (const cc of options.customColors) {
    customLookup.set(`${cc.r},${cc.g},${cc.b}`, cc);
  }

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
    const rand = mulberry32(x * 7919 + 42);

    // Build pixel info from source image
    const pixelInfo: Map<number, { shade: number; isWater: boolean }> = new Map();
    for (let z = 0; z < 128; z++) {
      const idx = (z * 128 + x) * 4;
      if (imageData.data[idx + 3] === 0) continue;
      const r = imageData.data[idx], g = imageData.data[idx + 1], b2 = imageData.data[idx + 2];
      const key = `${r},${g},${b2}`;
      const match = lookup.get(key);
      const cm = customLookup.get(key);
      if (match) pixelInfo.set(z, { shade: match.shade, isWater: BASE_COLORS[match.baseIndex].isWater });
      else if (cm) pixelInfo.set(z, { shade: 1, isWater: false });
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
    for (const z of primaryZs) {
      const bs = zToBlocks.get(z);
      if (bs) {
        origMaxY.set(z, Math.max(...bs.map(b => b.y)));
        origMinY.set(z, Math.min(...bs.map(b => b.y)));
      }
    }

    // Assign new random Y positions while maintaining shade constraints
    // Use small offsets to keep total spread manageable
    const newTopY = new Map<number, number>();
    let lastNonTransparentY = Math.floor(rand() * 64) + 32; // random start near middle

    for (const z of primaryZs) {
      const info = pixelInfo.get(z)!;

      if (info.isWater) {
        // Water pillar: keep contiguous, place top at a constrained random Y
        const depth = (origMaxY.get(z) ?? 0) - (origMinY.get(z) ?? 0) + 1;
        const waterTop = lastNonTransparentY + Math.floor(rand() * 4);
        const waterBottom = waterTop - depth + 1;
        const finalTop = waterBottom < 0 ? waterTop + -waterBottom : waterTop;
        newTopY.set(z, finalTop);
        lastNonTransparentY = finalTop;
        continue;
      }

      const shade = info.shade;
      let targetY: number;

      if (shade === 2) {
        // Light: must be higher than north
        targetY = lastNonTransparentY + 1 + Math.floor(rand() * 5);
      } else if (shade === 1) {
        // Normal: same as north
        targetY = lastNonTransparentY;
      } else {
        // Dark: must be lower than north
        const drop = 1 + Math.floor(rand() * 5);
        targetY = lastNonTransparentY - drop;
      }

      // No clamping during iteration to preserve shade constraints
      newTopY.set(z, targetY);
      lastNonTransparentY = targetY;
    }

    // Normalize column to fit within 0-128
    const yVals = [...newTopY.values()];
    const minY = Math.min(...yVals);
    const maxY = Math.max(...yVals);
    const span = maxY - minY;
    // Shift so minimum is 0, then scale if spread exceeds 128
    const shift = -minY;
    const scale = span > 128 ? 128 / span : 1;

    const normalizedTopY = new Map<number, number>();
    for (const [z, y] of newTopY) {
      normalizedTopY.set(z, Math.round((y + shift) * scale));
    }

    // Apply deltas to blocks
    const deltaApplied = new Map<number, number>();
    for (const z of primaryZs) {
      const origTop = origMaxY.get(z);
      const newTop = normalizedTopY.get(z);
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
  const customLookup = new Map<string, CustomColor>();
  for (const cc of options.customColors) {
    customLookup.set(`${cc.r},${cc.g},${cc.b}`, cc);
  }

  const steps: BlockEntry[][] = [];

  let anchor = 127, step = 0, baseY = 0;

  while (anchor >= 0) {
    const cols = step === 0 ? [127] : [anchor + 1, anchor];
    const useEvenRows = step % 2 === 0;
    let maxYUsed = baseY;
    const stepBlocks: BlockEntry[] = [];

    function addBlock(x: number, y: number, z: number, block: string) {
      stepBlocks.push({ x, y, z, blockName: resolveBlockName(block) });
    }

    for (const x of cols) {
      for (let z = 0; z < 128; z++) {
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
        if (!customMatch && BASE_COLORS[(match as ColorMatch).baseIndex].isWater) {
          const depth = getWaterDepth((match as ColorMatch).shade, x, z);
          for (let d = 0; d < depth; d++) {
            addBlock(x, baseY + d, z, block);
          }
          if (baseY + depth - 1 > maxYUsed) maxYUsed = baseY + depth - 1;
        } else {
          // Color block at baseY
          addBlock(x, baseY, z, block);

          // Support block under color block if needed
          const needsSupport = !isFillerDisabled(options.fillerBlock) && (
            options.supportMode === "all" ||
            (options.supportMode === "fragile" && isFragileBlock(block)) ||
            options.supportMode === "steps");
          if (needsSupport && baseY > 0) {
            addBlock(x, baseY - 1, z, options.fillerBlock);
          }
          if (needsSupport && baseY > maxYUsed) {
            maxYUsed = Math.max(maxYUsed, baseY);
          }

          // Filler north of color row based on shade
          if (!isFillerDisabled(options.fillerBlock)) {
            const shade = customMatch ? 1 : (match as ColorMatch).shade;
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
    anchor--;
    baseY = maxYUsed + 1;
    step++;
  }

  return steps;
}

// Flatten all steps into a single block list
function buildSuppressPairsEWBlocks(imageData: ImageData, options: ConversionOptions): BlockEntry[] {
  return buildSuppressPairsEWBlocksByStep(imageData, options).flat();
}
// Build suppress dual-layer blocks: two Y-height layers for 3-shade grid shading
// Shade mapping: MC shade 2=light→1st(brightest), 1=normal→2nd(middle), 0/3=dark→3rd(darkest)
// Dominant rows (even z) and submissive rows (odd z) follow different placement rules.
function buildSuppressDualLayerBlocks(imageData: ImageData, options: ConversionOptions): BlockEntry[] {
  const lookup = getColorLookup();
  const customLookup = new Map<string, CustomColor>();
  for (const cc of options.customColors) {
    customLookup.set(`${cc.r},${cc.g},${cc.b}`, cc);
  }

  const blocks: BlockEntry[] = [];
  const L1 = 0; // layer 1 base Y
  const L2 = options.layerGap ?? 5; // layer 2 base Y

  function addBlock(x: number, y: number, z: number, block: string) {
    blocks.push({ x, y, z, blockName: resolveBlockName(block) });
  }

  // 0=transparent, 1=1st(brightest), 2=2nd(middle), 3=3rd(darkest)
  type MappedShade = 0 | 1 | 2 | 3;

  function getPixelInfo(x: number, z: number): { shade: MappedShade; block: string; isWater: boolean; mcShade: number } | null {
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
      : options.blockMapping[(match as ColorMatch).baseIndex] ||
        BASE_COLORS[(match as ColorMatch).baseIndex].blocks[0];
    if (!block) return null;
    const isWater = !customMatch && BASE_COLORS[(match as ColorMatch).baseIndex].isWater;
    const mcShade = customMatch ? 1 : (match as ColorMatch).shade;
    const mapped: MappedShade = mcShade === 2 ? 1 : mcShade === 1 ? 2 : 3;
    return { shade: mapped, block, isWater, mcShade };
  }

  const fillerOff = isFillerDisabled(options.fillerBlock);

  for (let x = 0; x < 128; x++) {
    for (let z = 0; z < 128; z++) {
      const info = getPixelInfo(x, z);
      if (!info) continue;

      // Water: place at layer 1 with appropriate depth
      if (info.isWater) {
        const depth = getWaterDepth(info.mcShade, x, z);
        for (let d = 0; d < depth; d++) {
          addBlock(x, L1 + d, z, info.block);
        }
        continue;
      }

      const isDom = z % 2 === 0; // dominant = even z rows
      const north = getPixelInfo(x, z - 1);
      const south = getPixelInfo(x, z + 1);
      const ns = north ? north.shade : 0; // north shade (0=transparent)
      const ss = south ? south.shade : 0; // south shade (0=transparent)

      if (info.shade === 3) {
        // 3rd shade (darkest)
        if (isDom) {
          addBlock(x, L1, z, info.block);
          if (!fillerOff) {
            if (ns === 1) {
              // North is brightest: filler at layer1, z-1, y+1
              addBlock(x, L1 + 1, z - 1, options.fillerBlock);
            } else {
              // North is 2nd/3rd/transparent: filler at layer2, z-1
              addBlock(x, L2, z - 1, options.fillerBlock);
            }
          }
        } else {
          // Submissive: check exception first
          if (ss === 1 && (ns === 2 || ns === 3)) {
            // Exception: south is 1st AND north is 2nd/3rd → block at layer2
            addBlock(x, L2, z, info.block);
            if (!fillerOff) addBlock(x, L2 + 1, z - 1, options.fillerBlock);
          } else {
            addBlock(x, L1, z, info.block);
            if (!fillerOff) {
              if (ns === 1) {
                addBlock(x, L1 + 1, z - 1, options.fillerBlock);
              } else {
                addBlock(x, L2, z - 1, options.fillerBlock);
              }
            }
          }
        }
      } else if (info.shade === 2) {
        // 2nd shade (middle/normal)
        if (isDom) {
          if (ns === 1) {
            // North is brightest: block at layer1, filler at layer1 z-1
            addBlock(x, L1, z, info.block);
            if (!fillerOff) addBlock(x, L1, z - 1, options.fillerBlock);
          } else if (ns === 2 || ns === 3) {
            // North is 2nd/3rd: block at layer1, no filler
            addBlock(x, L1, z, info.block);
          } else {
            // North is transparent: block at layer2
            addBlock(x, L2, z, info.block);
            if (!fillerOff) {
              // If south is also 2nd shade, filler on layer1; otherwise layer2
              addBlock(x, ss === 2 ? L1 : L2, z - 1, options.fillerBlock);
            }
          }
        } else {
          // Submissive
          if (ns >= 1) {
            // North is any non-transparent: block at layer1
            addBlock(x, L1, z, info.block);
          } else {
            // North is transparent: block at layer2
            addBlock(x, L2, z, info.block);
            if (!fillerOff) {
              addBlock(x, ss === 2 ? L1 : L2, z - 1, options.fillerBlock);
            }
          }
        }
      } else {
        // 1st shade (brightest)
        if (isDom) {
          addBlock(x, L1, z, info.block);
        } else {
          addBlock(x, L2, z, info.block);
        }
      }
    }
  }

  return blocks;
}

// Compute material counts from actual block generation
export function computeMaterialCounts(imageData: ImageData, options: ConversionOptions): Record<string, number> {
  const counts: Record<string, number> = {};
  function countBlocks(blocks: BlockEntry[]) {
    for (const b of blocks) {
      const name = toDisplayName(b.blockName);
      counts[name] = (counts[name] || 0) + 1;
    }
  }

  if (options.buildMode === "suppress_pairs") {
    const [h0, h1] = buildSuppressPairsBlocks(imageData, options);
    countBlocks(h0);
    countBlocks(h1);
  } else if (options.buildMode === "suppress_pairs_ew") {
    // Material count = max occurrence of each block across any single step/segment
    const steps = buildSuppressPairsEWBlocksByStep(imageData, options);
    for (const stepBlocks of steps) {
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
  } else if (options.buildMode === "suppress_dual_layer") {
    const blocks = buildSuppressDualLayerBlocks(imageData, options);
    applySupport(blocks, options);
    countBlocks(blocks);
  } else {
    const blocks = buildStaircaseBlocks(imageData, options);
    applyStaircaseVariant(blocks, options.buildMode, imageData, options);
    applySupport(blocks, options);
    countBlocks(blocks);
  }

  return counts;
}
