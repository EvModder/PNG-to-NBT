// Binary NBT writer for Minecraft structure format
// All values are big-endian

export class NbtWriter {
  private data: number[] = [];

  writeByte(v: number) {
    this.data.push(v & 0xFF);
  }

  writeShort(v: number) {
    this.data.push((v >> 8) & 0xFF, v & 0xFF);
  }

  writeInt(v: number) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, v, false);
    const bytes = new Uint8Array(buf);
    for (const b of bytes) this.data.push(b);
  }

  writeString(v: string) {
    const encoded = new TextEncoder().encode(v);
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

  endCompoundElement() { this.writeByte(0); }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.data);
  }
}

export const TAG = {
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
  ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
} as const;

export interface BlockEntry {
  x: number;
  y: number;
  z: number;
  blockName: string; // e.g. "minecraft:stone" or "minecraft:oak_leaves[waterlogged=true]"
}

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

export function writeStructureNbt(
  blocks: BlockEntry[],
  sizeX: number,
  sizeY: number,
  sizeZ: number
): Uint8Array {
  // Build palette with properties support
  // Key is the full blockName string (including properties)
  const paletteMap = new Map<string, number>();
  const palette: { name: string; props: Record<string, string> }[] = [];
  for (const b of blocks) {
    if (!paletteMap.has(b.blockName)) {
      paletteMap.set(b.blockName, palette.length);
      palette.push(parseBlockId(b.blockName));
    }
  }

  const w = new NbtWriter();

  w.beginCompound("");
  w.intTag("DataVersion", 3837);

  w.beginList("size", TAG.Int, 3);
  w.writeInt(sizeX);
  w.writeInt(sizeY);
  w.writeInt(sizeZ);

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
    w.endCompoundElement();
  }

  w.beginList("blocks", TAG.Compound, blocks.length);
  for (const b of blocks) {
    w.beginList("pos", TAG.Int, 3);
    w.writeInt(b.x);
    w.writeInt(b.y);
    w.writeInt(b.z);
    w.intTag("state", paletteMap.get(b.blockName)!);
    w.endCompoundElement();
  }

  w.beginList("entities", TAG.End, 0);
  w.endCompound();

  return w.toUint8Array();
}

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
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
