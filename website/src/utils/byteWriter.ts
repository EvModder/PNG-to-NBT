/**
 * Public API:
 * - ByteWriter
 *
 * Callers:
 * - src/utils/nbtWriter.ts
 * - src/utils/zip.ts
 */
export class ByteWriter {
  private data: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(capacity = 1024, private littleEndian = false) {
    this.data = new Uint8Array(capacity);
    this.view = new DataView(this.data.buffer);
  }

  get length(): number { return this.offset; }

  private reserve(size: number): void {
    if (this.offset + size <= this.data.length) return;
    const data = new Uint8Array(Math.max(this.offset + size, this.data.length * 2));
    data.set(this.data.subarray(0, this.offset));
    this.data = data;
    this.view = new DataView(data.buffer);
  }

  writeByte(value: number): void {
    this.reserve(1);
    this.data[this.offset++] = value;
  }

  writeShort(value: number): void {
    this.reserve(2);
    this.view.setUint16(this.offset, value, this.littleEndian);
    this.offset += 2;
  }

  writeInt(value: number): void {
    this.reserve(4);
    this.view.setUint32(this.offset, value, this.littleEndian);
    this.offset += 4;
  }

  writeBytes(value: Uint8Array): void {
    this.reserve(value.length);
    this.data.set(value, this.offset);
    this.offset += value.length;
  }

  toUint8Array(): Uint8Array {
    // Exports use the backing buffer, so omit unused capacity, not just a view of it.
    return this.offset === this.data.length ? this.data : this.data.slice(0, this.offset);
  }
}
