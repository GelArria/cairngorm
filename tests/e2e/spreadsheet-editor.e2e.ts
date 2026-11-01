// The bundled spreadsheet editor in a real browser: workbook rendering, editing, saving
// through Cairngorm and the exact bytes written.
import JSZip from "jszip";
import fs from "node:fs";
import { test, expect, useDocumentFixtures } from "./docx-fixtures";

useDocumentFixtures();

const PATH = "C:/Project With Spaces/Budget.xlsx";
const manifest = JSON.parse(
  fs.readFileSync("src/documents/providers/spreadsheet/cairngorm-provider.json", "utf8"),
);
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

async function workbook() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/></Relationships>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<sst ${NS}><si><t>Item</t></si><si><t>Quarter</t></si><si><t>Amount</t></si><si><t>Trail repair</t></si><si><t>Señalética</t></si><si><t>Hut supplies</t></si></sst>`,
  );
  const row = (r: number, cells: string) => `<row r="${r}">${cells}</row>`;
  const s = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
  const n = (ref: string, v: number) => `<c r="${ref}"><v>${v}</v></c>`;
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><cols><col min="1" max="1" width="28"/></cols><sheetData>${row(1, s("A1", 0) + s("B1", 1) + s("C1", 2))}${row(2, s("A2", 3) + `<c r="B2" t="inlineStr"><is><t>Q1</t></is></c>` + n("C2", 1200))}${row(3, s("A3", 4) + `<c r="B3" t="inlineStr"><is><t>Q2</t></is></c>` + n("C3", 450.5))}${row(4, s("A4", 5) + `<c r="B4" t="inlineStr"><is><t>Q3</t></is></c>` + n("C4", 980))}${row(5, `<c r="C5"><f>SUM(C2:C4)</f><v>2630.5</v></c>`)}</sheetData></worksheet>`,
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<worksheet ${NS}><sheetData>${row(1, `<c r="A1" t="inlineStr"><is><t>Review with the team</t></is></c>`)}</sheetData></worksheet>`,
  );
  return Buffer.from(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  ).toString("base64");
}

test("edits a workbook in the bundled spreadsheet editor and saves only what changed", async ({
  app,
  browser,
  screen,
}) => {
  const base64 = await workbook();
  await browser.evaluate(
    async ({ manifest, base64, path }) => {
      const w = window as any;
      w.__documentProviders = [{ id: manifest.id, manifest, error: null }];
      w.__providerEntry = "src/documents/providers/spreadsheet/index.html";
      w.__binaryFiles = { [path]: base64 };
      w.__documentFiles = {};
      const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
      await emit("document-providers-changed");
      await new Promise((resolve) => setTimeout(resolve, 100));
      window.dispatchEvent(
        new CustomEvent("editor-open-file", {
          detail: {
            title: "Budget.xlsx",
            path: ["Budget.xlsx"],
            fullPath: path,
            content: "",
            extension: "xlsx",
            document: true,
          },
        }),
      );
    },
    { manifest, base64, path: PATH },
  );
  // The built-in preview also opens .xlsx, but the included editor is the default.
  const sheet = browser
    .frameLocator('[data-testid="document-provider-frame"]')
    .frameLocator("#provider");
  await expect(sheet.getByText("Trail repair")).toBeVisible();
  await expect(sheet.getByText("2630.5")).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "Notes" })).toBeVisible();
  await app.screenshot("spreadsheet-editor");

  await sheet.getByText("450.5").tap();
  await expect(sheet.getByLabel("Cell address")).toHaveValue("C3");
  await sheet.getByLabel("Cell contents").fill("500");
  await sheet.getByLabel("Cell contents").press("Enter");
  await expect(sheet.getByText("1 unsaved change")).toBeVisible();
  await expect(screen.getByTestId("document-header")).toContainText("Unsaved changes");
  await app.screenshot("spreadsheet-editor-unsaved");

  await screen.getByTestId("document-save").tap();
  await expect(screen.getByTestId("document-header")).toContainText("Saved");
  await expect(sheet.getByText("All changes saved")).toBeVisible();
  const saves = await browser.evaluate(() => (window as any).__saves);
  const saved = await JSZip.loadAsync(Buffer.from(saves.at(-1).base64, "base64"));
  const xml = await saved.file("xl/worksheets/sheet1.xml")!.async("string");
  expect(xml).toContain('<c r="C3"><v>500</v></c>');
  expect(xml).toContain("<f>SUM(C2:C4)</f>");
  // C5 depends on C3: Excel recalculates the cached total when it opens the file.
  expect(await saved.file("xl/workbook.xml")!.async("string")).toContain('fullCalcOnLoad="1"');
  expect(await saved.file("xl/sharedStrings.xml")!.async("string")).toContain("Trail repair");
  expect(await saved.file("xl/worksheets/sheet2.xml")!.async("string")).toContain(
    "Review with the team",
  );

  await sheet.getByRole("tab", { name: "Notes" }).tap();
  await expect(sheet.getByText("Review with the team")).toBeVisible();
  await app.screenshot("spreadsheet-editor-second-sheet");
});
