// Small, browser-native XLSX reader. It indexes the ZIP first and inflates only
// shared strings plus the first worksheet, keeping workbook previews bounded.
type ZipRecord = {
  name: string;
  method: number;
  compressed: number;
  uncompressed: number;
  localOffset: number;
};
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 500;
const MAX_COLUMNS = 100;

function u16(v: DataView, at: number) {
  return v.getUint16(at, true);
}
function u32(v: DataView, at: number) {
  return v.getUint32(at, true);
}

function records(buffer: ArrayBuffer): ZipRecord[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(view, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    throw new Error("Invalid XLSX archive");
  }
  const count = u16(view, end + 10);
  const central = u32(view, end + 16);
  const out: ZipRecord[] = [];
  let at = central;
  for (let i = 0; i < count; i++) {
    if (u32(view, at) !== 0x02014b50) {
      break;
    }
    const nameLen = u16(view, at + 28);
    const extraLen = u16(view, at + 30);
    const commentLen = u16(view, at + 32);
    out.push({
      name: new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLen)),
      method: u16(view, at + 10),
      compressed: u32(view, at + 20),
      uncompressed: u32(view, at + 24),
      localOffset: u32(view, at + 42),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This WebView cannot decompress XLSX files");
  }
  const copy = new Uint8Array(bytes);
  const stream = new Blob([copy.buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readRecord(buffer: ArrayBuffer, record: ZipRecord): Promise<string> {
  if (record.uncompressed > MAX_XML_BYTES) {
    throw new Error("Workbook preview is too large");
  }
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const at = record.localOffset;
  const nameLen = u16(view, at + 26);
  const extraLen = u16(view, at + 28);
  const payload = bytes.slice(
    at + 30 + nameLen + extraLen,
    at + 30 + nameLen + extraLen + record.compressed,
  );
  const data = record.method === 0 ? payload : await inflate(payload);
  return new TextDecoder().decode(data);
}

function textContent(node: Element): string {
  return Array.from(node.querySelectorAll("t"))
    .map((t) => t.textContent ?? "")
    .join("");
}
function columnOf(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const c of letters) {
    n = n * 26 + c.charCodeAt(0) - 64;
  }
  return n - 1;
}

export async function readFirstSheet(buffer: ArrayBuffer): Promise<string[][]> {
  const index = records(buffer);
  const sheet = index.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (!sheet) {
    throw new Error("Workbook has no worksheet");
  }
  const sharedRecord = index.find((e) => e.name === "xl/sharedStrings.xml");
  const [sheetXml, sharedXml] = await Promise.all([
    readRecord(buffer, sheet),
    sharedRecord ? readRecord(buffer, sharedRecord) : "",
  ]);
  const sharedDoc = new DOMParser().parseFromString(sharedXml, "application/xml");
  const shared = Array.from(sharedDoc.querySelectorAll("si")).map(textContent);
  const doc = new DOMParser().parseFromString(sheetXml, "application/xml");
  const rows: string[][] = [];
  for (const row of Array.from(doc.querySelectorAll("sheetData > row")).slice(0, MAX_ROWS)) {
    const values: string[] = [];
    for (const cell of Array.from(row.querySelectorAll(":scope > c")).slice(0, MAX_COLUMNS)) {
      const col = columnOf(cell.getAttribute("r") ?? "A1");
      while (values.length <= col) {
        values.push("");
      }
      const raw =
        cell.querySelector("v")?.textContent ?? textContent(cell.querySelector("is") ?? cell);
      values[col] = cell.getAttribute("t") === "s" ? (shared[Number(raw)] ?? raw) : raw;
    }
    rows.push(values.slice(0, MAX_COLUMNS));
  }
  return rows;
}

export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const encoded = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
