// Cells this editor refuses to change because other parts of the workbook depend on them:
// array/data-table formula ranges and table header rows (the table part names its columns).
import { parseRange, type Address } from "./cells.js";
import { entryText, type ZipEntry } from "./zip.js";

export interface Locked {
  start: Address;
  end: Address;
  reason: string;
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const TABLE = /\/table$/;

/** "xl/worksheets/sheet1.xml" + "../tables/table1.xml" → "xl/tables/table1.xml". */
function resolve(from: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

export async function lockedRanges(
  entries: ZipEntry[],
  sheetPath: string,
  doc: Document,
  parse: (text: string) => Document,
): Promise<Locked[]> {
  const locked: Locked[] = [];
  for (const f of Array.from(doc.getElementsByTagNameNS(MAIN, "f"))) {
    const kind = f.getAttribute("t");
    const area = parseRange(f.getAttribute("ref") ?? "");
    if (area && (kind === "array" || kind === "dataTable")) {
      locked.push({ ...area, reason: "is part of an array formula" });
    }
  }
  const relsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const rels = entries.find((e) => e.name === relsPath);
  if (!rels) return locked;
  for (const rel of Array.from(parse(await entryText(rels)).getElementsByTagName("Relationship"))) {
    if (
      !TABLE.test(rel.getAttribute("Type") ?? "") ||
      rel.getAttribute("TargetMode") === "External"
    ) {
      continue;
    }
    const part = entries.find(
      (e) => e.name === resolve(sheetPath, rel.getAttribute("Target") ?? ""),
    );
    const table = part && parse(await entryText(part)).documentElement;
    const area = parseRange(table?.getAttribute("ref") ?? "");
    if (area && table?.getAttribute("headerRowCount") !== "0") {
      locked.push({
        start: area.start,
        end: { row: area.start.row, col: area.end.col },
        reason: "is a table header",
      });
    }
  }
  return locked;
}

export function lockedReason(locked: Locked[], at: Address) {
  return locked.find(
    (l) =>
      at.row >= l.start.row && at.row <= l.end.row && at.col >= l.start.col && at.col <= l.end.col,
  )?.reason;
}
