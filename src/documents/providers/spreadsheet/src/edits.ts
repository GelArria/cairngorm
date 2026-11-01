// Saving rewrites only the cells the user (or an agent) changed, inside the original sheet XML.
// Styles, other sheets, charts and every other part keep their exact bytes.
import { cellRef, parseRef, type Address } from "./cells.js";
import { entry, parseXml, type Workbook } from "./workbook.js";
import { entryText, replacedEntry, writeZip, type ZipEntry } from "./zip.js";

/** Pending inputs per sheet index, by cell reference ("B2" → "=SUM(A1:A3)"). */
export type Edits = Map<number, Map<string, string>>;

export type Input =
  | { kind: "empty" }
  | { kind: "formula"; text: string }
  | { kind: "number"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "text"; text: string };

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Inputs reaching here passed `inputProblem` (rules.ts). */
export function parseInput(input: string): Input {
  if (input === "") {
    return { kind: "empty" };
  }
  if (input.startsWith("=") && input.length > 1) {
    return { kind: "formula", text: input.slice(1) };
  }
  const number = Number(input.trim());
  // Out-of-range numbers (1e400) stay text rather than becoming "Infinity".
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(input.trim()) && Number.isFinite(number)) {
    return { kind: "number", value: String(number) };
  }
  if (/^(true|false)$/i.test(input.trim())) {
    return { kind: "bool", value: input.trim().toLowerCase() === "true" };
  }
  return { kind: "text", text: input };
}

const order = (ref: string) => {
  const at = parseRef(ref);
  return at ? at.row * 20_000 + at.col : -1;
};

function rowFor(doc: Document, data: Element, row: number) {
  const rows = Array.from(data.getElementsByTagNameNS(MAIN, "row"));
  const found = rows.find((r) => Number(r.getAttribute("r")) === row + 1);
  if (found) {
    return found;
  }
  const created = doc.createElementNS(MAIN, "row");
  created.setAttribute("r", String(row + 1));
  data.insertBefore(created, rows.find((r) => Number(r.getAttribute("r")) > row + 1) ?? null);
  return created;
}

function cellFor(doc: Document, row: Element, ref: string) {
  const cells = Array.from(row.getElementsByTagNameNS(MAIN, "c"));
  const found = cells.find((c) => c.getAttribute("r") === ref);
  if (found) {
    return found;
  }
  const created = doc.createElementNS(MAIN, "c");
  created.setAttribute("r", ref);
  row.insertBefore(
    created,
    cells.find((c) => order(c.getAttribute("r") ?? "A1") > order(ref)) ?? null,
  );
  return created;
}

function writeCell(doc: Document, cell: Element, input: Input) {
  for (const child of Array.from(cell.children)) {
    if (["v", "f", "is"].includes(child.localName)) {
      cell.removeChild(child);
    }
  }
  cell.removeAttribute("t");
  const add = (name: string, text: string) => {
    const node = doc.createElementNS(MAIN, name);
    node.textContent = text;
    cell.appendChild(node);
    return node;
  };
  if (input.kind === "formula") {
    add("f", input.text);
  } else if (input.kind === "number") {
    add("v", input.value);
  } else if (input.kind === "bool") {
    cell.setAttribute("t", "b");
    add("v", input.value ? "1" : "0");
  } else if (input.kind === "text") {
    cell.setAttribute("t", "inlineStr");
    const is = doc.createElementNS(MAIN, "is");
    const t = doc.createElementNS(MAIN, "t");
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    t.textContent = input.text;
    is.appendChild(t);
    cell.appendChild(is);
  } else if (!cell.hasAttribute("s")) {
    // An empty, unstyled cell disappears; a styled one keeps its formatting.
    cell.parentElement?.removeChild(cell);
  }
}

const serialize = (original: string, doc: Document) => {
  const body = new XMLSerializer().serializeToString(doc);
  const declaration = /^<\?xml[^>]*\?>/.exec(original)?.[0];
  return declaration && !body.startsWith("<?xml") ? `${declaration}\r\n${body}` : body;
};

function widenDimension(doc: Document, edited: Address[]) {
  const dimension = doc.getElementsByTagNameNS(MAIN, "dimension")[0];
  const [first, last = first] = (dimension?.getAttribute("ref") ?? "").split(":");
  const a = parseRef(first ?? "");
  const b = parseRef(last ?? "");
  if (!dimension || !a || !b) {
    return;
  }
  const rows = [a.row, b.row, ...edited.map((e) => e.row)];
  const cols = [a.col, b.col, ...edited.map((e) => e.col)];
  const start = cellRef({ row: Math.min(...rows), col: Math.min(...cols) });
  dimension.setAttribute(
    "ref",
    `${start}:${cellRef({ row: Math.max(...rows), col: Math.max(...cols) })}`,
  );
}

export async function saveWorkbook(book: Workbook, edits: Edits): Promise<Uint8Array> {
  const replaced = new Map<string, string>();
  for (const [index, changes] of edits) {
    if (!changes.size) {
      continue;
    }
    const part = entry(book, book.sheets[index].path)!;
    const original = await entryText(part);
    const doc = parseXml(original);
    const data = doc.getElementsByTagNameNS(MAIN, "sheetData")[0];
    const touched: Address[] = [];
    for (const [ref, input] of changes) {
      const at = parseRef(ref)!;
      touched.push(at);
      writeCell(doc, cellFor(doc, rowFor(doc, data, at.row), ref), parseInput(input));
    }
    widenDimension(doc, touched);
    replaced.set(part.name, serialize(original, doc));
  }
  // Any changed value can feed a formula elsewhere, so every save with edits recalculates.
  const recalculate = replaced.size > 0;
  if (recalculate) {
    await forceRecalculation(book, replaced);
  }
  const entries: ZipEntry[] = [];
  for (const original of book.entries) {
    if (recalculate && original.name === "xl/calcChain.xml") {
      continue;
    }
    const text = replaced.get(original.name);
    entries.push(text === undefined ? original : await replacedEntry(original, text));
  }
  return writeZip(entries);
}

/**
 * Cached formula results may now be stale: Excel recalculates everything on open. The
 * calculation chain would list stale cells, so it is dropped with its relationship and
 * content type.
 */
async function forceRecalculation(book: Workbook, replaced: Map<string, string>) {
  const workbookXml = await entryText(entry(book, "xl/workbook.xml")!);
  const workbook = parseXml(workbookXml);
  const root = workbook.documentElement;
  let calc = workbook.getElementsByTagNameNS(MAIN, "calcPr")[0];
  if (!calc) {
    calc = workbook.createElementNS(MAIN, "calcPr");
    const after = ["definedNames", "externalReferences", "functionGroups", "sheets"]
      .map((name) => workbook.getElementsByTagNameNS(MAIN, name)[0])
      .find(Boolean);
    root.insertBefore(calc, after?.nextSibling ?? null);
  }
  calc.setAttribute("fullCalcOnLoad", "1");
  replaced.set("xl/workbook.xml", serialize(workbookXml, workbook));
  if (!entry(book, "xl/calcChain.xml")) {
    return;
  }
  const remove = async (name: string, tag: string, matches: (node: Element) => boolean) => {
    const part = entry(book, name);
    if (!part) return;
    const original = replaced.get(name) ?? (await entryText(part));
    const doc = parseXml(original);
    for (const node of Array.from(doc.getElementsByTagNameNS("*", tag)).filter(matches)) {
      node.parentNode?.removeChild(node);
    }
    replaced.set(name, serialize(original, doc));
  };
  await remove("xl/_rels/workbook.xml.rels", "Relationship", (node) =>
    /(^|\/)calcChain\.xml$/i.test(node.getAttribute("Target") ?? ""),
  );
  await remove("[Content_Types].xml", "Override", (node) =>
    /^\/?xl\/calcChain\.xml$/i.test(node.getAttribute("PartName") ?? ""),
  );
}
