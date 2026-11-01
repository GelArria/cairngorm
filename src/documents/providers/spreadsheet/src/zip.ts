// Browser-native ZIP for XLSX packages. Reading inflates entries on demand; writing copies
// every unchanged entry's compressed bytes as they are and deflates only replaced parts, so
// a save never re-encodes styles, charts, images or sheets nobody touched.

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  time: number;
  date: number;
  crc: number;
  compressed: Uint8Array;
  size: number;
}

const MAX_PART_BYTES = 64 * 1024 * 1024;
const utf8 = new TextEncoder();

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  const data = view(bytes);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (data.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    throw new Error("This is not an Excel workbook (no ZIP directory).");
  }
  const count = data.getUint16(end + 10, true);
  let at = data.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) {
    throw new Error("Very large (ZIP64) workbooks are not supported.");
  }
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (data.getUint32(at, true) !== 0x02014b50) {
      throw new Error("The workbook's ZIP directory is damaged.");
    }
    const nameLength = data.getUint16(at + 28, true);
    const extraLength = data.getUint16(at + 30, true);
    const commentLength = data.getUint16(at + 32, true);
    const compressedSize = data.getUint32(at + 20, true);
    const local = data.getUint32(at + 42, true);
    const start = local + 30 + data.getUint16(local + 26, true) + data.getUint16(local + 28, true);
    if (data.getUint32(local, true) !== 0x04034b50 || start + compressedSize > bytes.length) {
      throw new Error("The workbook's ZIP entries are damaged.");
    }
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      flags: data.getUint16(at + 8, true),
      method: data.getUint16(at + 10, true),
      time: data.getUint16(at + 12, true),
      date: data.getUint16(at + 14, true),
      crc: data.getUint32(at + 16, true),
      size: data.getUint32(at + 24, true),
      compressed: bytes.subarray(start, start + compressedSize),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream) {
  const output = new Blob([bytes.slice()]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

export async function entryText(entry: ZipEntry): Promise<string> {
  if (entry.size > MAX_PART_BYTES) {
    throw new Error(`${entry.name} is too large to open here.`);
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`${entry.name} uses an unsupported compression method.`);
  }
  const raw =
    entry.method === 0
      ? entry.compressed
      : await pipe(entry.compressed, new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(raw);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A replacement for one part; every other entry is copied unchanged. */
export async function replacedEntry(original: ZipEntry, text: string): Promise<ZipEntry> {
  const raw = utf8.encode(text);
  return {
    ...original,
    method: 8,
    // No data descriptor: sizes and CRC are written in the local header.
    flags: original.flags & ~0x0008,
    crc: crc32(raw),
    size: raw.length,
    compressed: await pipe(raw, new CompressionStream("deflate-raw")),
  };
}

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    const flags = entry.flags & ~0x0008;
    const local = new Uint8Array(30 + name.length);
    const l = view(local);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, flags, true);
    l.setUint16(8, entry.method, true);
    l.setUint16(10, entry.time, true);
    l.setUint16(12, entry.date, true);
    l.setUint32(14, entry.crc, true);
    l.setUint32(18, entry.compressed.length, true);
    l.setUint32(22, entry.size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const c = view(central);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, flags, true);
    c.setUint16(10, entry.method, true);
    c.setUint16(12, entry.time, true);
    c.setUint16(14, entry.date, true);
    c.setUint32(16, entry.crc, true);
    c.setUint32(20, entry.compressed.length, true);
    c.setUint32(24, entry.size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, entry.compressed);
    centrals.push(central);
    offset += local.length + entry.compressed.length;
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const e = view(end);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
