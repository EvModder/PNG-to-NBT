/**
 * Public API:
 * - createZip()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/nbtExport.ts
 */
import { ByteWriter } from "@/utils/byteWriter";

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, crc) => {
  for (let bit = 0; bit < 8; ++bit) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  return crc >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; ++i) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

// Callers:
// - src/Index.tsx
// - src/lib/nbtExport.ts
export function createZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const files = entries.map(entry => ({
    name: enc.encode(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
    offset: 0,
  }));
  // Local headers (30), central headers (46), both names, payloads, and end record (22).
  const size = files.reduce((sum, file) => sum + 76 + file.name.length * 2 + file.data.length, 22);
  const out = new ByteWriter(size, true);

  for (const file of files) {
    file.offset = out.length;

    // Local file header
    out.writeInt(0x04034B50); // signature
    out.writeShort(20);      // version needed
    out.writeShort(0);       // flags
    out.writeShort(0);       // compression (store)
    out.writeShort(0);       // mod time
    out.writeShort(0);       // mod date
    out.writeInt(file.crc);
    out.writeInt(file.data.length); // compressed size
    out.writeInt(file.data.length); // uncompressed size
    out.writeShort(file.name.length);
    out.writeShort(0);       // extra field length
    out.writeBytes(file.name);
    out.writeBytes(file.data);
  }

  const cdOffset = out.length;

  for (const file of files) {
    out.writeInt(0x02014B50); // central dir signature
    out.writeShort(20);      // version made by
    out.writeShort(20);      // version needed
    out.writeShort(0);       // flags
    out.writeShort(0);       // compression
    out.writeShort(0);       // mod time
    out.writeShort(0);       // mod date
    out.writeInt(file.crc);
    out.writeInt(file.data.length); // compressed
    out.writeInt(file.data.length); // uncompressed
    out.writeShort(file.name.length);
    out.writeShort(0);       // extra
    out.writeShort(0);       // comment
    out.writeShort(0);       // disk
    out.writeShort(0);       // internal attrs
    out.writeInt(0);         // external attrs
    out.writeInt(file.offset);
    out.writeBytes(file.name);
  }

  const cdSize = out.length - cdOffset;

  // End of central directory
  out.writeInt(0x06054B50);
  out.writeShort(0);             // disk number
  out.writeShort(0);             // cd start disk
  out.writeShort(files.length);
  out.writeShort(files.length);
  out.writeInt(cdSize);
  out.writeInt(cdOffset);
  out.writeShort(0);             // comment length

  return out.toUint8Array();
}
