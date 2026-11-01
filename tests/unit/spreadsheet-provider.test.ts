// The bundled spreadsheet editor's package handling, with real ZIP/XML round trips.
import { Blob as NodeBlob } from "node:buffer";
import JSZip from "jszip";
import { beforeAll, expect, it } from "vitest";
import { SheetSession } from "@/documents/providers/spreadsheet/src/session";
import { readSheet, readWorkbook } from "@/documents/providers/spreadsheet/src/workbook";
import { readZip } from "@/documents/providers/spreadsheet/src/zip";

beforeAll(() => {
  // jsdom's Blob has no stream(); the provider runs in WebView2 where it does.
  globalThis.Blob = NodeBlob as unknown as typeof Blob;
});

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>`;

async function workbook({ calcChain = true } = {}) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="x"/>${calcChain ? '<Override PartName="/xl/calcChain.xml" ContentType="y"/>' : ""}</Types>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t/worksheet" Target="/xl/worksheets/sheet2.xml"/>${calcChain ? '<Relationship Id="rId9" Type="t/calcChain" Target="calcChain.xml"/>' : ""}</Relationships>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<sst ${NS}><si><t>Item</t></si><si><r><t>Seña</t></r><r><t>lética</t></r><rPh><t>x</t></rPh></si></sst>`,
  );
  zip.file("xl/styles.xml", STYLES);
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><dimension ref="A1:C3"/><cols><col min="1" max="1" width="20"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>45292</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="2"><v>450.5</v></c><c r="C2"><f t="shared" ref="C2:C3" si="0">B2*2</f><v>901</v></c></row><row r="3"><c r="C3"><f t="shared" si="0"/><v>0</v></c></row></sheetData></worksheet>`,
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello</t></is></c><c r="B1" t="b"><v>1</v></c></row></sheetData></worksheet>`,
  );
  if (calcChain) zip.file("xl/calcChain.xml", `<calcChain ${NS}><c r="C2" i="1"/></calcChain>`);
  zip.file("xl/media/logo.png", new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

const text = async (bytes: Uint8Array, name: string) =>
  (await JSZip.loadAsync(bytes)).file(name)?.async("string");

it("reads sheets, shared strings, rich text, dates, numbers, booleans and widths", async () => {
  const book = await readWorkbook(await workbook());
  expect(book.sheets.map((s) => s.name)).toEqual(["Budget", "Notes"]);
  const sheet = await readSheet(book, 0);
  expect(sheet.cells.get("A2")?.display).toBe("Señalética");
  expect(sheet.cells.get("B1")?.display).toBe("2024-01-01");
  expect(sheet.cells.get("B2")).toMatchObject({ display: "450.5", numeric: true, input: "450.5" });
  expect(sheet.cells.get("C2")).toMatchObject({ input: "=B2*2", anchored: true });
  expect(sheet.cells.get("C3")?.anchored).toBe(false);
  expect(sheet.widths.get(0)).toBe(145);
  const notes = await readSheet(book, 1);
  expect([notes.cells.get("A1")?.display, notes.cells.get("B1")?.display]).toEqual([
    "Hello",
    "TRUE",
  ]);
});

it("saves only the changed cells and keeps every other part byte for byte", async () => {
  const original = await workbook();
  const session = new SheetSession();
  await session.load(original);
  expect(session.commit("C2", "5")).toContain("shared or array formula");
  session.commit("B2", "1200");
  session.commit("D5", "New text");
  session.commit("A1", "");
  session.commit("C3", "=B2+1");
  expect(session.pending).toBe(4);
  const saved = await session.serialize();
  const before = new Map(readZip(original).map((e) => [e.name, e]));
  for (const entry of readZip(saved)) {
    if (
      [
        "xl/styles.xml",
        "xl/sharedStrings.xml",
        "xl/media/logo.png",
        "xl/worksheets/sheet2.xml",
      ].includes(entry.name)
    ) {
      expect([...entry.compressed]).toEqual([...before.get(entry.name)!.compressed]);
    }
  }
  const book = await readWorkbook(saved);
  const sheet = await readSheet(book, 0);
  expect(sheet.cells.get("B2")).toMatchObject({ display: "1200", numeric: true });
  expect(sheet.cells.get("D5")?.display).toBe("New text");
  expect(sheet.cells.has("A1")).toBe(false);
  expect(sheet.cells.get("C3")?.input).toBe("=B2+1");
  expect(sheet.cells.get("B1")?.display).toBe("2024-01-01");
  const xml = (await text(saved, "xl/worksheets/sheet1.xml"))!;
  expect(xml.startsWith("<?xml")).toBe(true);
  expect(xml).toContain('<dimension ref="A1:D5"/>');
  expect(xml.indexOf('r="5"')).toBeGreaterThan(xml.indexOf('r="3"'));
  // Changed formulas recalculate in Excel; the stale calculation chain is gone.
  expect(await text(saved, "xl/workbook.xml")).toContain('fullCalcOnLoad="1"');
  expect(await text(saved, "xl/calcChain.xml")).toBeUndefined();
  expect(await text(saved, "xl/_rels/workbook.xml.rels")).not.toContain("calcChain");
  expect(await text(saved, "[Content_Types].xml")).not.toContain("calcChain");
});

it("keeps edits typed during a save pending afterwards", async () => {
  const session = new SheetSession();
  await session.load(await workbook({ calcChain: false }));
  session.commit("B2", "1");
  await session.serialize();
  session.commit("B2", "2");
  session.commit("E1", "later");
  await session.saved();
  expect(session.pending).toBe(2);
  expect(session.data.cells.get("B2")?.display).toBe("1");
  expect(session.input("B2")).toBe("2");
});

it("gives agents bounded reads and validated writes", async () => {
  const session = new SheetSession();
  await session.load(await workbook());
  expect(await session.readRange("Budget", "a1:b2")).toEqual({
    sheet: "Budget",
    range: "A1:B2",
    values: [
      ["Item", "2024-01-01"],
      ["Señalética", "450.5"],
    ],
  });
  expect(await session.setCells("Notes", { B2: 3, C2: true, A1: null })).toEqual({
    sheet: "Notes",
    changed: 3,
  });
  expect((await session.readRange("Notes", "A1:C2")).values).toEqual([
    ["", "TRUE", ""],
    ["", "3", "TRUE"],
  ]);
  await expect(session.readRange(undefined, "A1:Z1000")).rejects.toThrow("at most");
  await expect(session.setCells(undefined, { "1A": 1 })).rejects.toThrow("not a cell reference");
  await expect(session.setCells("Nope", { A1: 1 })).rejects.toThrow("No worksheet");
  await expect(readWorkbook(new Uint8Array([1, 2, 3]))).rejects.toThrow("not an Excel workbook");
});
