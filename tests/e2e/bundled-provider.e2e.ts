// Editors included with Cairngorm are added automatically. Settings ▸ Documents lists every
// file type with what opens it; an included editor the user removed can be added back.
import fs from "node:fs";
import { test, expect, useDocumentFixtures } from "./docx-fixtures";

useDocumentFixtures();

const manifest = JSON.parse(
  fs.readFileSync("src/documents/providers/spreadsheet/cairngorm-provider.json", "utf8"),
);

test("lists file types and adds back a removed included editor", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate((manifest) => {
    (window as any).__bundledProviders = [{ name: "spreadsheet", manifest, installed: false }];
    window.dispatchEvent(new CustomEvent("app-open-settings", { detail: "documents" }));
  }, manifest);
  const xlsx = screen.getByTestId("file-type-xlsx");
  await expect(xlsx).toContainText("Spreadsheet preview");
  await expect(xlsx).toContainText("View only");
  const list = screen.getByTestId("bundled-provider-list");
  await expect(list).toContainText("Spreadsheet editor");
  await app.screenshot("bundled-provider-removed");

  await screen.getByTestId("bundled-provider-add-spreadsheet").tap();
  await expect(list).toHaveCount(0);
  await expect(xlsx).toContainText("Spreadsheet editor");
  await expect(xlsx).toContainText("Edit");
  await expect(xlsx).toContainText("Agents");
  await expect(screen.getByTestId("document-provider-list").first()).toContainText("Included");
  await app.screenshot("bundled-provider-file-types");
});
