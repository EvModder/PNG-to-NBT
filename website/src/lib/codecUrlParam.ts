/**
 * Public API:
 * - encodeUrlParamBytes()
 * - decodeUrlParamBytes()
 * - encodeUrlParamText()
 * - decodeUrlParamText()
 *
 * Callers:
 * - src/lib/codecColorGrid.ts
 * - src/lib/codecPreset.ts
 */
const RAW_PREFIX = "r";
const PACKED_PREFIX = "p";
const COMPRESSED_PREFIX = "z";
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  let normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function packBytes(bytes: Uint8Array): Uint8Array {
  const packed: number[] = [];
  let i = 0;

  while (i < bytes.length) {
    let runLength = 1;
    while (i + runLength < bytes.length && bytes[i + runLength] === bytes[i] && runLength < 130) ++runLength;

    if (runLength >= 3) {
      packed.push(0x80 | (runLength - 3), bytes[i]);
      i += runLength;
      continue;
    }

    const literalStart = i;
    let literalLength = 0;
    while (i < bytes.length && literalLength < 128) {
      runLength = 1;
      while (i + runLength < bytes.length && bytes[i + runLength] === bytes[i] && runLength < 130) ++runLength;
      if (runLength >= 3) break;
      ++i;
      ++literalLength;
    }

    packed.push(literalLength - 1);
    for (let j = literalStart; j < literalStart + literalLength; ++j) packed.push(bytes[j]);
  }

  return Uint8Array.from(packed);
}

function unpackBytes(bytes: Uint8Array): Uint8Array | null {
  const unpacked: number[] = [];
  let i = 0;

  while (i < bytes.length) {
    const control = bytes[i++];
    if ((control & 0x80) !== 0) {
      if (i >= bytes.length) return null;
      const runLength = (control & 0x7f) + 3;
      const value = bytes[i++];
      for (let j = 0; j < runLength; ++j) unpacked.push(value);
      continue;
    }

    const literalLength = control + 1;
    if (i + literalLength > bytes.length) return null;
    for (let j = 0; j < literalLength; ++j) unpacked.push(bytes[i++]);
  }

  return Uint8Array.from(unpacked);
}

async function readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function compressBytes(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream(format));
    return await readStreamBytes(stream);
  } catch {
    return null;
  }
}

async function decompressBytes(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream(format));
    return await readStreamBytes(stream);
  } catch {
    return null;
  }
}

async function encodeSingleUrlParamBytes(bytes: Uint8Array): Promise<string> {
  let bestPrefix = RAW_PREFIX;
  let bestBytes = bytes;

  const packed = packBytes(bytes);
  if (packed.length < bestBytes.length) {
    bestPrefix = PACKED_PREFIX;
    bestBytes = packed;
  }

  const deflated = await compressBytes(bytes, "deflate-raw");
  if (deflated && deflated.length < bestBytes.length) {
    bestPrefix = COMPRESSED_PREFIX;
    bestBytes = deflated;
  }

  return `${bestPrefix}${bytesToBase64Url(bestBytes)}`;
}

// Callers:
// - src/lib/codecColorGrid.ts
export async function encodeUrlParamBytes(bytes: Uint8Array): Promise<string> {
  return encodeSingleUrlParamBytes(bytes);
}

// Callers:
// - src/lib/codecColorGrid.ts
export async function decodeUrlParamBytes(encoded: string): Promise<Uint8Array | null> {
  if (!encoded) return null;
  try {
    const prefix = encoded[0];
    const payload = base64UrlToBytes(encoded.slice(1));
    switch (prefix) {
      case RAW_PREFIX:
        return payload;
      case PACKED_PREFIX:
        return unpackBytes(payload);
      case COMPRESSED_PREFIX:
        return await decompressBytes(payload, "deflate-raw");
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// Callers:
// - src/lib/codecPreset.ts
export async function encodeUrlParamText(text: string): Promise<string> {
  return encodeUrlParamBytes(TEXT_ENCODER.encode(text));
}

// Callers:
// - src/lib/codecPreset.ts
export async function decodeUrlParamText(encoded: string): Promise<string | null> {
  const bytes = await decodeUrlParamBytes(encoded);
  if (!bytes) return null;
  try {
    return TEXT_DECODER.decode(bytes);
  } catch {
    return null;
  }
}
