/**
 * Public API:
 * - encodeColorGrid()
 * - decodeColorGrid()
 *
 * Callers:
 * - src/Index.tsx
 */
import { BASE_COLORS } from "@/data/mapColors";
import { type ColorGrid, Shade, type ShadedColorRef } from "@/types/color";
import { MAP_SIZE, TRANSPARENT_COLOR } from "@/utils/color";
import { decodeUrlParamBytes, encodeUrlParamBytes } from "@/lib/codecUrlParam";

const DENSE_VARIANT_PREFIX = "d";
const ALIGNED_VARIANT_PREFIX = "a";
const ALIGNED_LEFT_VARIANT_PREFIX = "l";
const ALIGNED_UP_VARIANT_PREFIX = "u";
const PACKED_STATE_SHADE_BITS = 2;
const PACKED_STATE_SHADE_MASK = (1 << PACKED_STATE_SHADE_BITS) - 1;
const HAS_CUSTOM_STATES_FLAG = 1 << 7;
const STATE_ID_BITS_MASK = HAS_CUSTOM_STATES_FLAG - 1;
const BYTE_ALIGNED_CUSTOM_FLAG = 1 << 15;
const BYTE_ALIGNED_MAX_ID = (1 << 13) - 1;

interface ColorGridStateTable {
  states: ShadedColorRef[];
  pixelStateIndexes: number[];
  hasCustomStates: boolean;
  stateIdBits: number;
}

type AlignedFilterMode = "none" | "left" | "up";

function createEmptyColorGrid(): ColorGrid {
  return Array.from({ length: MAP_SIZE }, () => Array<ShadedColorRef>(MAP_SIZE).fill(TRANSPARENT_COLOR));
}

function getStateKey(color: ShadedColorRef): number {
  return color.isCustom
    ? (1 << 20) | (color.id << 2) | color.shade
    : (color.id << 2) | color.shade;
}

function appendUint16(target: Uint8Array, offset: number, value: number): number {
  target[offset] = value & 255;
  target[offset + 1] = (value >> 8) & 255;
  return offset + 2;
}

function readUint16(source: Uint8Array, offset: number): number {
  return source[offset] | (source[offset + 1] << 8);
}

function getBitsRequired(maxValue: number): number {
  return maxValue <= 0 ? 0 : Math.floor(Math.log2(maxValue)) + 1;
}

function getBitsPerStateIndex(stateCount: number): number {
  return getBitsRequired(stateCount - 1);
}

function buildColorGridStateTable(colorGrid: ColorGrid): ColorGridStateTable {
  const stateIndexByKey = new Map<number, number>();
  const states: ShadedColorRef[] = [];
  const pixelStateIndexes: number[] = [];

  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const color = colorGrid[x][z];
      if (color.shade === Shade.Darkest) throw new Error("Darkest shade cannot be shared in color-grid state");
      const key = getStateKey(color);
      let stateIndex = stateIndexByKey.get(key);
      if (stateIndex === undefined) {
        stateIndex = states.length;
        stateIndexByKey.set(key, stateIndex);
        states.push(color);
      }
      pixelStateIndexes.push(stateIndex);
    }
  }

  return {
    states,
    pixelStateIndexes,
    hasCustomStates: states.some(state => state.isCustom),
    stateIdBits: getBitsRequired(Math.max(...states.map(state => state.id))),
  };
}

function writeBitPackedValue(target: Uint8Array, byteOffset: number, bitOffset: number, bitCount: number, value: number): number {
  for (let i = 0; i < bitCount; ++i) {
    if (Math.floor(value / 2 ** i) % 2 === 0) continue;
    const targetBitIndex = bitOffset + i;
    target[byteOffset + (targetBitIndex >> 3)] |= 1 << (targetBitIndex & 7);
  }
  return bitOffset + bitCount;
}

function readBitPackedValue(source: Uint8Array, byteOffset: number, bitOffset: number, bitCount: number): number {
  let value = 0;
  for (let i = 0; i < bitCount; ++i) {
    const sourceBitIndex = bitOffset + i;
    const sourceByte = source[byteOffset + (sourceBitIndex >> 3)] ?? 0;
    const sourceBit = (sourceByte >> (sourceBitIndex & 7)) & 1;
    value += sourceBit * 2 ** i;
  }
  return value;
}

function writeBitPackedValues(target: Uint8Array, byteOffset: number, bitOffset: number, values: readonly number[], bitsPerValue: number): number {
  if (bitsPerValue === 0) return bitOffset;

  for (const value of values) {
    bitOffset = writeBitPackedValue(target, byteOffset, bitOffset, bitsPerValue, value);
  }

  return bitOffset;
}

function packColorState(id: number, shade: Shade, isCustom: boolean, stateIdBits: number, hasCustomStates: boolean): number {
  return ((hasCustomStates && isCustom) ? 2 ** (stateIdBits + PACKED_STATE_SHADE_BITS) : 0) + (id * 2 ** PACKED_STATE_SHADE_BITS) + shade;
}

function writeStateHeader(target: Uint8Array, stateIdBits: number, hasCustomStates: boolean, stateCount: number): number {
  let offset = 0;
  target[offset++] = stateIdBits | (hasCustomStates ? HAS_CUSTOM_STATES_FLAG : 0);
  return appendUint16(target, offset, stateCount);
}

function readStateHeader(bytes: Uint8Array): { stateIdBits: number; hasCustomStates: boolean; stateCount: number } | null {
  if (bytes.length < 3) return null;
  const stateHeader = bytes[0];
  const stateIdBits = stateHeader & STATE_ID_BITS_MASK;
  const hasCustomStates = (stateHeader & HAS_CUSTOM_STATES_FLAG) !== 0;
  const stateCount = readUint16(bytes, 1);
  return stateCount === 0 ? null : { stateIdBits, hasCustomStates, stateCount };
}

function parsePackedColorState(packedState: number, stateIdBits: number, hasCustomStates: boolean): ShadedColorRef | null {
  const shade = (packedState & PACKED_STATE_SHADE_MASK) as Shade;
  if (shade === Shade.Darkest) return null;
  const isCustom = hasCustomStates && Math.floor(packedState / 2 ** (stateIdBits + PACKED_STATE_SHADE_BITS)) !== 0;
  const id = stateIdBits === 0
    ? 0
    : Math.floor(packedState / 2 ** PACKED_STATE_SHADE_BITS) % 2 ** stateIdBits;
  if (!isCustom && id >= BASE_COLORS.length) return null;
  return { isCustom, id, shade };
}

function encodeDenseColorGridBytes(colorGridStateTable: ColorGridStateTable): Uint8Array {
  const { states, pixelStateIndexes, stateIdBits, hasCustomStates } = colorGridStateTable;
  const stateBits = (hasCustomStates ? 1 : 0) + stateIdBits + PACKED_STATE_SHADE_BITS;
  const packedStates = states.map(state => packColorState(state.id, state.shade, state.isCustom, stateIdBits, hasCustomStates));
  const bitsPerIndex = getBitsPerStateIndex(states.length);
  const headerLength = 3;
  const totalBitLength = packedStates.length * stateBits + pixelStateIndexes.length * bitsPerIndex;
  const bytes = new Uint8Array(headerLength + Math.ceil(totalBitLength / 8));
  const offset = writeStateHeader(bytes, stateIdBits, hasCustomStates, states.length);

  let bitOffset = 0;
  bitOffset = writeBitPackedValues(bytes, offset, bitOffset, packedStates, stateBits);
  writeBitPackedValues(bytes, offset, bitOffset, pixelStateIndexes, bitsPerIndex);

  return bytes;
}

function packByteAlignedColorState(state: ShadedColorRef): number {
  if (state.id > BYTE_ALIGNED_MAX_ID) throw new Error("Color-grid state id exceeds byte-aligned payload capacity");
  return (state.isCustom ? BYTE_ALIGNED_CUSTOM_FLAG : 0) | (state.id << PACKED_STATE_SHADE_BITS) | state.shade;
}

function getAlignedFilterBase(
  pixelStateIndexes: readonly number[], x: number, z: number, filterMode: AlignedFilterMode,
): number {
  if (filterMode === "left") return x > 0 ? pixelStateIndexes[z * MAP_SIZE + (x - 1)] : 0;
  if (filterMode === "up") return z > 0 ? pixelStateIndexes[(z - 1) * MAP_SIZE + x] : 0;
  return 0;
}

function encodeAlignedPixelIndexes(
  target: Uint8Array, offset: number, pixelStateIndexes: readonly number[], useUint16Indexes: boolean, filterMode: AlignedFilterMode,
): void {
  const mask = useUint16Indexes ? 0xffff : 0xff;

  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const pixelOffset = z * MAP_SIZE + x;
      const stateIndex = pixelStateIndexes[pixelOffset];
      const base = getAlignedFilterBase(pixelStateIndexes, x, z, filterMode);
      const filtered = (stateIndex - base) & mask;
      if (useUint16Indexes) offset = appendUint16(target, offset, filtered);
      else target[offset++] = filtered;
    }
  }
}

function encodeAlignedColorGridBytes(colorGridStateTable: ColorGridStateTable, filterMode: AlignedFilterMode): Uint8Array | null {
  const { states, pixelStateIndexes, stateIdBits, hasCustomStates } = colorGridStateTable;
  if (stateIdBits > 13) return null;

  const useUint16Indexes = states.length > 256;
  const bytes = new Uint8Array(3 + states.length * 2 + pixelStateIndexes.length * (useUint16Indexes ? 2 : 1));
  let offset = writeStateHeader(bytes, stateIdBits, hasCustomStates, states.length);

  for (const state of states) {
    offset = appendUint16(bytes, offset, packByteAlignedColorState(state));
  }

  encodeAlignedPixelIndexes(bytes, offset, pixelStateIndexes, useUint16Indexes, filterMode);
  return bytes;
}

function decodeDenseColorGridBytes(bytes: Uint8Array): ColorGrid | null {
  const header = readStateHeader(bytes);
  if (!header) return null;

  const { stateIdBits, hasCustomStates, stateCount } = header;
  const stateBits = (hasCustomStates ? 1 : 0) + stateIdBits + PACKED_STATE_SHADE_BITS;
  const pixelCount = MAP_SIZE * MAP_SIZE;
  const bitsPerIndex = getBitsPerStateIndex(stateCount);
  const expectedLength = 3 + Math.ceil((stateCount * stateBits + pixelCount * bitsPerIndex) / 8);
  if (bytes.length !== expectedLength) return null;

  const states: ShadedColorRef[] = [];
  const offset = 3;
  let bitOffset = 0;
  for (let i = 0; i < stateCount; ++i) {
    const packedState = readBitPackedValue(bytes, offset, bitOffset, stateBits);
    bitOffset += stateBits;
    const state = parsePackedColorState(packedState, stateIdBits, hasCustomStates);
    if (!state) return null;
    states.push(state);
  }

  const colorGrid = createEmptyColorGrid();
  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const stateIndex = bitsPerIndex === 0
        ? 0
        : readBitPackedValue(bytes, offset, bitOffset, bitsPerIndex);
      bitOffset += bitsPerIndex;
      const state = states[stateIndex];
      if (!state) return null;
      colorGrid[x][z] = state;
    }
  }

  return colorGrid;
}

function decodeAlignedColorGridBytes(bytes: Uint8Array, filterMode: AlignedFilterMode): ColorGrid | null {
  const header = readStateHeader(bytes);
  if (!header) return null;

  const { hasCustomStates, stateCount } = header;
  const pixelCount = MAP_SIZE * MAP_SIZE;
  const useUint16Indexes = stateCount > 256;
  const expectedLength = 3 + stateCount * 2 + pixelCount * (useUint16Indexes ? 2 : 1);
  if (bytes.length !== expectedLength) return null;

  let offset = 3;
  const states: ShadedColorRef[] = [];
  for (let i = 0; i < stateCount; ++i) {
    const packedState = readUint16(bytes, offset);
    offset += 2;
    const shade = (packedState & PACKED_STATE_SHADE_MASK) as Shade;
    if (shade === Shade.Darkest) return null;
    const isCustom = (packedState & BYTE_ALIGNED_CUSTOM_FLAG) !== 0;
    if (isCustom && !hasCustomStates) return null;
    const id = (packedState >> PACKED_STATE_SHADE_BITS) & BYTE_ALIGNED_MAX_ID;
    if (!isCustom && id >= BASE_COLORS.length) return null;
    states.push({ isCustom, id, shade });
  }

  const colorGrid = createEmptyColorGrid();
  const stateIndexes = new Array<number>(pixelCount);
  const mask = useUint16Indexes ? 0xffff : 0xff;
  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const filtered = useUint16Indexes ? readUint16(bytes, offset) : bytes[offset];
      offset += useUint16Indexes ? 2 : 1;
      const pixelOffset = z * MAP_SIZE + x;
      const base = getAlignedFilterBase(stateIndexes, x, z, filterMode);
      const stateIndex = (filtered + base) & mask;
      const state = states[stateIndex];
      if (!state) return null;
      stateIndexes[pixelOffset] = stateIndex;
      colorGrid[x][z] = state;
    }
  }

  return colorGrid;
}

// Callers:
// - src/Index.tsx
export async function encodeColorGrid(colorGrid: ColorGrid): Promise<string> {
  const colorGridStateTable = buildColorGridStateTable(colorGrid);
  const variants: [string, Uint8Array][] = [
    [DENSE_VARIANT_PREFIX, encodeDenseColorGridBytes(colorGridStateTable)],
  ];

  const alignedBytes = encodeAlignedColorGridBytes(colorGridStateTable, "none");
  if (alignedBytes) variants.push([ALIGNED_VARIANT_PREFIX, alignedBytes]);
  const alignedLeftBytes = encodeAlignedColorGridBytes(colorGridStateTable, "left");
  if (alignedLeftBytes) variants.push([ALIGNED_LEFT_VARIANT_PREFIX, alignedLeftBytes]);
  const alignedUpBytes = encodeAlignedColorGridBytes(colorGridStateTable, "up");
  if (alignedUpBytes) variants.push([ALIGNED_UP_VARIANT_PREFIX, alignedUpBytes]);

  let best: string | null = null;
  for (const [variantPrefix, bytes] of variants) {
    const encoded = `${variantPrefix}${await encodeUrlParamBytes(bytes)}`;
    if (best === null || encoded.length < best.length) best = encoded;
  }

  return best ?? "";
}

// Callers:
// - src/Index.tsx
export async function decodeColorGrid(encoded: string): Promise<ColorGrid | null> {
  if (!encoded) return null;

  try {
    const variantPrefix = encoded[0];
    const bytes = await decodeUrlParamBytes(encoded.slice(1));
    if (!bytes) return null;
    switch (variantPrefix) {
      case DENSE_VARIANT_PREFIX:
        return decodeDenseColorGridBytes(bytes);
      case ALIGNED_VARIANT_PREFIX:
        return decodeAlignedColorGridBytes(bytes, "none");
      case ALIGNED_LEFT_VARIANT_PREFIX:
        return decodeAlignedColorGridBytes(bytes, "left");
      case ALIGNED_UP_VARIANT_PREFIX:
        return decodeAlignedColorGridBytes(bytes, "up");
      default:
        return null;
    }
  } catch {
    return null;
  }
}
