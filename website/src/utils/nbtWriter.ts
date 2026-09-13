/**
 * Public API:
 * - writeStructureNbt()
 * - gzipCompress()
 *
 * Callers:
 * - src/lib/nbtExport.ts
 */

class NbtWriter {
  private data: number[] = [];
  private encoder = new TextEncoder();
  private strings = new Map<string, Uint8Array>();

  writeByte(v: number) {
    this.data.push(v & 0xFF);
  }

  writeShort(v: number) {
    this.data.push((v >> 8) & 0xFF, v & 0xFF);
  }

  writeInt(v: number) {
    this.data.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF);
  }

  writeString(v: string) {
    let encoded = this.strings.get(v);
    if (!encoded) {
      encoded = this.encoder.encode(v);
      this.strings.set(v, encoded);
    }
    this.writeShort(encoded.length);
    for (const b of encoded) this.data.push(b);
  }

  tagHeader(type: number, name: string) {
    this.writeByte(type);
    this.writeString(name);
  }

  beginCompound(name: string) { this.tagHeader(10, name); }
  endCompound() { this.writeByte(0); }
  intTag(name: string, v: number) { this.tagHeader(3, name); this.writeInt(v); }
  stringTag(name: string, v: string) { this.tagHeader(8, name); this.writeString(v); }

  beginList(name: string, elemType: number, count: number) {
    this.tagHeader(9, name);
    this.writeByte(elemType);
    this.writeInt(count);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.data);
  }
}

const TAG = {
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
  ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
} as const;


// Parse "minecraft:oak_leaves[waterlogged=true]" into name + properties
function parseBlockId(id: string): { name: string; props: Record<string, string> } {
  const bracketIdx = id.indexOf("[");
  if (bracketIdx < 0) return { name: id, props: {} };
  const name = id.slice(0, bracketIdx);
  const propsStr = id.slice(bracketIdx + 1, -1); // remove [ and ]
  const props: Record<string, string> = {};
  for (const part of propsStr.split(",")) {
    const eq = part.indexOf("=");
    if (eq >= 0) props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return { name, props };
}

// Callers:
// - src/lib/nbtExport.ts
export function writeStructureNbt(
  blocks: readonly { x: number; y: number; z: number; state: number }[],
  paletteBlockIds: readonly string[],
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  dataVersion: number,
  author?: string,
): Uint8Array {
  const palette = paletteBlockIds.map(parseBlockId);

  const w = new NbtWriter();

  w.beginCompound("");
  w.intTag("DataVersion", dataVersion);

  w.beginList("size", TAG.Int, 3);
  w.writeInt(sizeX);
  w.writeInt(sizeY);
  w.writeInt(sizeZ);
  if (author) w.stringTag("author", author);

  w.beginList("palette", TAG.Compound, palette.length);
  for (const entry of palette) {
    w.stringTag("Name", entry.name);
    const propKeys = Object.keys(entry.props);
    if (propKeys.length > 0) {
      w.beginCompound("Properties");
      for (const k of propKeys) {
        w.stringTag(k, entry.props[k]);
      }
      w.endCompound();
    }
    w.endCompound();
  }

  w.beginList("blocks", TAG.Compound, blocks.length);
  for (const b of blocks) {
    w.beginList("pos", TAG.Int, 3);
    w.writeInt(b.x);
    w.writeInt(b.y);
    w.writeInt(b.z);
    w.intTag("state", b.state);
    w.endCompound();
  }

  w.beginList("entities", TAG.End, 0);
  w.endCompound();

  return w.toUint8Array();
}

// Callers:
// - src/lib/nbtExport.ts
export async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([data.buffer as ArrayBuffer]);
  const stream = blob.stream();
  const compressed = stream.pipeThrough(new CompressionStream("gzip"));
  const reader = compressed.getReader();
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
