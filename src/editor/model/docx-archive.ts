export const DOCX_MAX_BYTES = 25 * 1024 * 1024;
const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const invalid = () => new Error("Invalid or unsupported DOCX archive.");

export function decodeDocxSource(src: string): ArrayBuffer {
  if (src.length > Math.ceil(DOCX_MAX_BYTES / 3) * 4 + 200) {
    throw new Error("Document is too large (25 MiB maximum).");
  }
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(src);
  if (!match) {
    throw new Error("Invalid document data URL.");
  }
  const raw = atob(match[1]);
  if (raw.length > DOCX_MAX_BYTES) {
    throw new Error("Document is too large (25 MiB maximum).");
  }
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}

async function expand(payload: Uint8Array, method: number, size: number) {
  if (method === 0) {
    if (payload.length !== size) {
      throw new Error("Invalid DOCX part size.");
    }
    return payload;
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This WebView cannot decompress DOCX files.");
  }
  const copy = new Uint8Array(payload);
  const reader = new Response(copy.buffer)
    .body!.pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.length;
      if (length > size || length > MAX_PART_BYTES) {
        throw new Error("Invalid DOCX part size or document too large.");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (length !== size) {
    throw new Error("Invalid DOCX part size.");
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function checkXml(data: Uint8Array, name: string) {
  if (!/\.(xml|rels)$/i.test(name)) {
    return;
  }
  const xml = decoder.decode(data);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("Unsafe XML declarations are not supported.");
  }
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error("Invalid document XML.");
  }
  for (const symbol of Array.from(document.getElementsByTagNameNS("*", "sym"))) {
    const value =
      symbol.getAttributeNS(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "char",
      ) ?? "";
    if (!/^[a-f0-9]{1,6}$/i.test(value)) {
      throw new Error("Invalid document XML symbol.");
    }
  }
  for (const rel of Array.from(document.getElementsByTagNameNS("*", "Relationship"))) {
    if (rel.getAttribute("Type")?.endsWith("/hyperlink")) {
      continue;
    }
    const target = rel.getAttribute("Target") ?? "";
    if (rel.getAttribute("TargetMode") === "External" || /^(?:[a-z]+:|[/\\])/i.test(target)) {
      throw new Error("Documents with external resources are not supported.");
    }
  }
}

function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

// Validate actual expanded sizes before JSZip/docx-preview can allocate from archive metadata.
export async function validateDocx(buffer: ArrayBuffer): Promise<void> {
  if (buffer.byteLength > DOCX_MAX_BYTES) {
    throw new Error("Document is too large (25 MiB maximum).");
  }
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0 || view.getUint32(end + 4, true) !== 0) {
    throw invalid();
  }
  const count = view.getUint16(end + 10, true);
  const central = view.getUint32(end + 16, true);
  if (
    !count ||
    count > 1024 ||
    count !== view.getUint16(end + 8, true) ||
    central + view.getUint32(end + 12, true) !== end
  ) {
    throw invalid();
  }
  const names = new Set<string>();
  let at = central;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) {
      throw invalid();
    }
    const nameLength = view.getUint16(at + 28, true);
    const next =
      at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 24, true);
    const compressed = view.getUint32(at + 20, true);
    const local = view.getUint32(at + 42, true);
    total += size;
    if (size > MAX_PART_BYTES || total > MAX_EXPANDED_BYTES) {
      throw new Error("Expanded document is too large.");
    }
    if (view.getUint16(at + 8, true) & 1 || ![0, 8].includes(method)) {
      throw new Error("Encrypted or unsupported DOCX compression.");
    }
    if (
      !name ||
      names.has(name) ||
      /(^\/|\\|:|(?:^|\/)\.{1,2}(?:\/|$))/.test(name) ||
      next > end ||
      local + 30 > central
    ) {
      throw invalid();
    }
    if (/(?:vbaProject|\/embeddings\/|\/activeX\/)/i.test(name)) {
      throw new Error("Documents with active content are not supported.");
    }
    names.add(name);
    if (
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 8, true) !== method ||
      view.getUint16(local + 6, true) !== view.getUint16(at + 8, true)
    ) {
      throw invalid();
    }
    const localNameLength = view.getUint16(local + 26, true);
    const start = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (
      start + compressed > central ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name
    ) {
      throw invalid();
    }
    const data = await expand(bytes.subarray(start, start + compressed), method, size);
    if (crc32(data) !== view.getUint32(at + 16, true)) {
      throw new Error("Corrupt DOCX archive checksum.");
    }
    checkXml(data, name);
    at = next;
  }
  if (
    at !== end ||
    !names.has("word/document.xml") ||
    !names.has("[Content_Types].xml") ||
    !names.has("_rels/.rels")
  ) {
    throw new Error("Archive has no supported Word document.");
  }
}
