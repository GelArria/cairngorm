// The spreadsheet editor refuses what would corrupt a workbook and never loses edits.
import { Blob as NodeBlob } from "node:buffer";
import JSZip from "jszip";
import { beforeAll, expect, it } from "vitest";
import { parseTsv } from "@/documents/providers/spreadsheet/src/clipboard";
import { parseInput } from "@/documents/providers/spreadsheet/src/edits";
import { SheetSession } from "@/documents/providers/spreadsheet/src/session";
import { readSheet, readWorkbook } from "@/documents/providers/spreadsheet/src/workbook";

beforeAll(() => {
  globalThis.Blob = NodeBlob as unknown as typeof Blob;
});

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function workbook() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<workbook ${NS} xmlns:r="${REL}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1*2</f><v>2</v></c></row><row r="3"><c r="D3"><f t="array" ref="D3:E4">A1:B2</f><v>1</v></c></row></sheetData></worksheet>`,
  );
  zip.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/table" Target="../tables/table1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/tables/table1.xml",
    `<table ${NS} id="1" name="Sales" ref="G1:H5"><tableColumns count="2"><tableColumn id="1" name="Month"/><tableColumn id="2" name="Total"/></tableColumns></table>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

async function open() {
  const session = new SheetSession();
  await session.load(await workbook());
  return session;
}

it("marks the workbook for recalculation when only a constant changes", async () => {
  const session = await open();
  session.commit("A1", "5");
  const saved = await JSZip.loadAsync(await session.serialize());
  expect(await saved.file("xl/workbook.xml")!.async("string")).toContain('fullCalcOnLoad="1"');
});

it("refuses inputs that would make invalid XML or a broken formula", async () => {
  const session = await open();
  expect(session.commit("C1", "a\u0001b")).toContain("control characters");
  expect(session.commit("C1", "=)")).toContain("unmatched");
  expect(session.commit("C1", "==x")).toContain("malformed");
  expect(session.commit("C1", '=CONCAT("(", A1)')).toBeNull();
  expect(session.commit("C2", "x".repeat(32_768))).toContain("at most");
  expect(parseInput("1e400")).toEqual({ kind: "text", text: "1e400" });
  const book = await readWorkbook(await session.serialize());
  expect((await readSheet(book, 0)).cells.get("C1")?.input).toBe('=CONCAT("(", A1)');
});

it("protects array formula ranges and table headers", async () => {
  const session = await open();
  expect(session.commit("E4", "1")).toContain("array formula");
  expect(session.commit("H1", "Renamed")).toContain("table header");
  expect(session.commit("H2", "10")).toBeNull();
});

it("applies agent writes all or nothing", async () => {
  const session = await open();
  await expect(session.setCells(undefined, { A1: 9, G1: "x" })).rejects.toThrow("table header");
  expect(session.pending).toBe(0);
  await expect(session.setCells(undefined, { C9: "\u0007" })).rejects.toThrow("control");
});

it("keeps inputs committed while a save is being re-read, including reverts", async () => {
  const session = await open();
  session.commit("A1", "5");
  await session.serialize();
  const done = session.saved();
  session.commit("C1", "typed");
  session.commit("A1", "1");
  await done;
  expect(session.input("C1")).toBe("typed");
  expect(session.input("A1")).toBe("1");
  expect(session.data.cells.get("A1")?.display).toBe("5");
  expect(session.pending).toBe(2);
});

it("pastes quoted multi-line cells as one cell", () => {
  expect(parseTsv('a\t"line 1\nline 2"\tc\r\nd\t"say ""hi"""\n')).toEqual([
    ["a", "line 1\nline 2", "c"],
    ["d", 'say "hi"'],
  ]);
});
