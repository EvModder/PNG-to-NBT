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

const PACKED_STATE_SHADE_BITS = 2;
const PACKED_STATE_SHADE_MASK = (1 << PACKED_STATE_SHADE_BITS) - 1;

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

function getCombinedStateId(color: ShadedColorRef): number {
  return color.isCustom ? BASE_COLORS.length + color.id : color.id;
}

function getBitsRequired(maxValue: number): number {
  return maxValue <= 0 ? 0 : Math.floor(Math.log2(maxValue)) + 1;
}

function getBitsPerStateIndex(stateCount: number): number {
  return getBitsRequired(stateCount - 1);
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

function packColorState(combinedStateId: number, shade: Shade): number {
  return combinedStateId * 2 ** PACKED_STATE_SHADE_BITS + shade;
}

function encodeColorGridBytes(colorGrid: ColorGrid): Uint8Array {
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

  const combinedStateIds = states.map(getCombinedStateId);
  const stateIdBits = getBitsRequired(Math.max(...combinedStateIds));
  const stateBits = stateIdBits + PACKED_STATE_SHADE_BITS;
  const packedStates = states.map((state, index) => packColorState(combinedStateIds[index], state.shade));
  const bitsPerIndex = getBitsPerStateIndex(states.length);
  const headerLength = 3;
  const totalBitLength = packedStates.length * stateBits + pixelStateIndexes.length * bitsPerIndex;
  const bytes = new Uint8Array(headerLength + Math.ceil(totalBitLength / 8));
  let offset = 0;

  offset = appendUint16(bytes, offset, states.length);
  bytes[offset++] = stateIdBits;

  let bitOffset = 0;
  bitOffset = writeBitPackedValues(bytes, offset, bitOffset, packedStates, stateBits);
  writeBitPackedValues(bytes, offset, bitOffset, pixelStateIndexes, bitsPerIndex);

  return bytes;
}

function decodeColorGridBytes(bytes: Uint8Array): ColorGrid | null {
  if (bytes.length < 3) return null;

  let offset = 0;
  const stateCount = readUint16(bytes, offset);
  offset += 2;
  if (stateCount === 0) return null;
  const stateIdBits = bytes[offset++];
  const stateBits = stateIdBits + PACKED_STATE_SHADE_BITS;
  const pixelCount = MAP_SIZE * MAP_SIZE;
  const bitsPerIndex = getBitsPerStateIndex(stateCount);
  const expectedLength = 3 + Math.ceil((stateCount * stateBits + pixelCount * bitsPerIndex) / 8);
  if (bytes.length !== expectedLength) return null;

  const states: ShadedColorRef[] = [];
  let bitOffset = 0;
  for (let i = 0; i < stateCount; ++i) {
    const packedState = readBitPackedValue(bytes, offset, bitOffset, stateBits);
    bitOffset += stateBits;
    const shade = (packedState & PACKED_STATE_SHADE_MASK) as Shade;
    if (shade === Shade.Darkest) return null;
    const combinedId = Math.floor(packedState / 2 ** PACKED_STATE_SHADE_BITS);
    const isCustom = combinedId >= BASE_COLORS.length;
    const id = isCustom ? combinedId - BASE_COLORS.length : combinedId;
    if (!isCustom && id >= BASE_COLORS.length) return null;
    states.push({
      isCustom,
      id,
      shade,
    });
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

export async function encodeColorGrid(colorGrid: ColorGrid): Promise<string> {
  return encodeUrlParamBytes(encodeColorGridBytes(colorGrid));
}

export async function decodeColorGrid(encoded: string): Promise<ColorGrid | null> {
  if (!encoded) return null;

  try {
    const bytes = await decodeUrlParamBytes(encoded);
    return bytes ? decodeColorGridBytes(bytes) : null;
  } catch {
    return null;
  }
}
