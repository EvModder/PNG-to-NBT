// Minimal ZIP file generator (no compression, store only)
// Sufficient for bundling small NBT files

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeU16LE(arr: number[], v: number) {
  arr.push(v & 0xFF, (v >> 8) & 0xFF);
}

function writeU32LE(arr: number[], v: number) {
  arr.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF);
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function createZip(entries: ZipEntry[]): Uint8Array {
  const out: number[] = [];
  const centralDir: { offset: number; name: Uint8Array; crc: number; size: number }[] = [];
  const enc = new TextEncoder();

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const offset = out.length;

    // Local file header
    writeU32LE(out, 0x04034B50); // signature
    writeU16LE(out, 20);         // version needed
    writeU16LE(out, 0);          // flags
    writeU16LE(out, 0);          // compression (store)
    writeU16LE(out, 0);          // mod time
    writeU16LE(out, 0);          // mod date
    writeU32LE(out, crc);
    writeU32LE(out, entry.data.length); // compressed size
    writeU32LE(out, entry.data.length); // uncompressed size
    writeU16LE(out, nameBytes.length);
    writeU16LE(out, 0);          // extra field length
    for (const b of nameBytes) out.push(b);
    for (const b of entry.data) out.push(b);

    centralDir.push({ offset, name: nameBytes, crc, size: entry.data.length });
  }

  const cdOffset = out.length;

  for (const cd of centralDir) {
    writeU32LE(out, 0x02014B50); // central dir signature
    writeU16LE(out, 20);         // version made by
    writeU16LE(out, 20);         // version needed
    writeU16LE(out, 0);          // flags
    writeU16LE(out, 0);          // compression
    writeU16LE(out, 0);          // mod time
    writeU16LE(out, 0);          // mod date
    writeU32LE(out, cd.crc);
    writeU32LE(out, cd.size);    // compressed
    writeU32LE(out, cd.size);    // uncompressed
    writeU16LE(out, cd.name.length);
    writeU16LE(out, 0);          // extra
    writeU16LE(out, 0);          // comment
    writeU16LE(out, 0);          // disk
    writeU16LE(out, 0);          // internal attrs
    writeU32LE(out, 0);          // external attrs
    writeU32LE(out, cd.offset);
    for (const b of cd.name) out.push(b);
  }

  const cdSize = out.length - cdOffset;

  // End of central directory
  writeU32LE(out, 0x06054B50);
  writeU16LE(out, 0);             // disk number
  writeU16LE(out, 0);             // cd start disk
  writeU16LE(out, centralDir.length);
  writeU16LE(out, centralDir.length);
  writeU32LE(out, cdSize);
  writeU32LE(out, cdOffset);
  writeU16LE(out, 0);             // comment length

  return new Uint8Array(out);
}
