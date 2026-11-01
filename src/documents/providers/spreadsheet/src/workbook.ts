// Reads an XLSX package into what the grid shows. Nothing here changes the package; edits
// are kept separately and applied to the original XML only when saving.
import { cellRef, parseRef } from "./cells.js";
import { lockedRanges, type Locked } from "./protect.js";
import { entryText, readZip, type ZipEntry } from "./zip.js";

export interface Cell {
  /** What the grid shows. */
  display: string;
  /** What the formula bar shows and editing starts from. */
  input: string;
  numeric: boolean;
  /** Anchors a shared or array formula other cells depend on: editing it here is refused. */
  anchored: boolean;
}

export interface SheetInfo {
  name: string;
  path: string;
}

export interface SheetData {
  cells: Map<string, Cell>;
  rows: number;
  cols: number;
  /** Column widths in pixels, by zero-based column. */
  widths: Map<number, number>;
  /** Ranges other parts of the workbook depend on. */
  locked: Locked[];
}

export interface Workbook {
  entries: ZipEntry[];
  sheets: SheetInfo[];
  shared: string[];
  dateStyles: Set<number>;
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
// Built-in number formats that are dates or times.
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export const parseXml = (text: string) => {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("The workbook contains damaged XML.");
  }
  return doc;
};
const children = (node: Element | Document, name: string) =>
  Array.from(node.getElementsByTagNameNS(MAIN, name));
/** Text of <t> runs, without phonetic hints (<rPh>). */
const runs = (node: Element) =>
  Array.from(node.getElementsByTagNameNS(MAIN, "t"))
    .filter((t) => t.parentElement?.localName !== "rPh")
    .map((t) => t.textContent ?? "")
    .join("");

export function entry(book: Workbook, name: string) {
  return book.entries.find((e) => e.name === name);
}

export async function readWorkbook(bytes: Uint8Array): Promise<Workbook> {
  const entries = readZip(bytes);
  const text = async (name: string) => {
    const found = entries.find((e) => e.name === name);
    return found ? entryText(found) : "";
  };
  const workbookXml = await text("xl/workbook.xml");
  if (!workbookXml) {
    throw new Error("This file has no workbook part. Is it an .xlsx file?");
  }
  const rels = parseXml((await text("xl/_rels/workbook.xml.rels")) || "<Relationships/>");
  const targets = new Map(
    Array.from(rels.getElementsByTagName("Relationship")).map((r) => [
      r.getAttribute("Id") ?? "",
      r.getAttribute("Target") ?? "",
    ]),
  );
  const sheets = children(parseXml(workbookXml), "sheet").flatMap((sheet) => {
    const target = targets.get(sheet.getAttributeNS(RELS, "id") ?? "") ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    return entries.some((e) => e.name === path)
      ? [{ name: sheet.getAttribute("name") ?? path, path }]
      : [];
  });
  if (!sheets.length) {
    throw new Error("This workbook has no worksheets to show.");
  }
  const sharedXml = await text("xl/sharedStrings.xml");
  const shared = sharedXml ? children(parseXml(sharedXml), "si").map(runs) : [];
  return { entries, sheets, shared, dateStyles: dateStyles(await text("xl/styles.xml")) };
}

function dateStyles(stylesXml: string): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) {
    return out;
  }
  const doc = parseXml(stylesXml);
  const custom = new Map(
    children(doc, "numFmt").map((f) => [
      Number(f.getAttribute("numFmtId")),
      f.getAttribute("formatCode") ?? "",
    ]),
  );
  // A custom format is a date when it uses d/m/y/h outside quotes, brackets and escapes.
  const isDate = (code: string) => /[dmyh]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ""));
  const xfs = children(doc, "cellXfs")[0];
  Array.from(xfs?.getElementsByTagNameNS(MAIN, "xf") ?? []).forEach((xf, index) => {
    const id = Number(xf.getAttribute("numFmtId") ?? 0);
    if (DATE_FORMATS.has(id) || isDate(custom.get(id) ?? "")) {
      out.add(index);
    }
  });
  return out;
}

/** Excel's 1900 date system (with its 1900 leap-year quirk), shown as ISO date and time. */
function excelDate(serial: number): string {
  // Days between Excel's epoch and 1970: one fewer before the fictitious 29 Feb 1900 (serial 60).
  const ms = Math.round((serial - (serial < 60 ? 25_568 : 25_569)) * 86_400_000);
  const iso = new Date(ms).toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
}

function formatNumber(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return raw;
  }
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
}

export async function readSheet(book: Workbook, index: number): Promise<SheetData> {
  const xml = await entryText(entry(book, book.sheets[index].path)!);
  const doc = parseXml(xml);
  const cells = new Map<string, Cell>();
  let rows = 0;
  let cols = 0;
  for (const c of children(doc, "c")) {
    const at = parseRef(c.getAttribute("r") ?? "");
    if (!at) {
      continue;
    }
    rows = Math.max(rows, at.row + 1);
    cols = Math.max(cols, at.col + 1);
    const type = c.getAttribute("t") ?? "n";
    const value = c.getElementsByTagNameNS(MAIN, "v")[0]?.textContent ?? "";
    const formula = c.getElementsByTagNameNS(MAIN, "f")[0];
    const style = Number(c.getAttribute("s") ?? 0);
    const display =
      type === "s"
        ? (book.shared[Number(value)] ?? "")
        : type === "inlineStr"
          ? runs(c.getElementsByTagNameNS(MAIN, "is")[0] ?? c)
          : type === "b"
            ? value === "1"
              ? "TRUE"
              : "FALSE"
            : type === "n" && value !== ""
              ? book.dateStyles.has(style) && Number.isFinite(Number(value))
                ? excelDate(Number(value))
                : formatNumber(value)
              : value;
    const formulaText = formula?.textContent ?? "";
    cells.set(cellRef(at), {
      display,
      input: formulaText ? `=${formulaText}` : type === "n" ? value : display,
      numeric: type === "n" && value !== "",
      anchored: !!formula && (formula.getAttribute("t") === "array" || formula.hasAttribute("ref")),
    });
  }
  const widths = new Map<number, number>();
  for (const col of children(doc, "col")) {
    const width = Number(col.getAttribute("width"));
    if (!Number.isFinite(width)) {
      continue;
    }
    for (
      let i = Number(col.getAttribute("min"));
      i <= Math.min(Number(col.getAttribute("max")), 200);
      i++
    ) {
      widths.set(i - 1, Math.max(24, Math.round(width * 7 + 5)));
    }
  }
  const path = book.sheets[index].path;
  const locked = await lockedRanges(book.entries, path, doc, parseXml);
  return { cells, rows, cols, widths, locked };
}
