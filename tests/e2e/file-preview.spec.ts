import { test, expect, openFileInGrid } from "./fixtures";

test.describe("lightweight file previews", () => {
  test("renders Markdown without a code editor", async ({ app }) => {
    await openFileInGrid(
      app,
      {
        title: "README.md",
        path: ["README.md"],
        content: "# Cairngorm\n\n**Fast** docs",
        extension: "md",
      },
      "[data-testid='markdown-viewer']",
    );
    await expect(app.getByTestId("markdown-viewer").locator("h1")).toHaveText("Cairngorm");
    await expect(app.getByTestId("markdown-viewer").locator("strong")).toHaveText("Fast");
    await app.screenshot({ path: "logs/e2e/file-preview-markdown.png" });
  });

  test("renders CSV as a compact table", async ({ app }) => {
    await openFileInGrid(
      app,
      {
        title: "data.csv",
        path: ["data.csv"],
        content: "",
        extension: "csv",
        // Tables open through the spreadsheet document provider, like a dropped file.
        binarySrc: `data:text/csv;base64,${Buffer.from("Name,Count\nalpha,3").toString("base64")}`,
        document: true,
      },
      "[data-testid='spreadsheet-viewer']",
    );
    await expect(app.getByTestId("spreadsheet-viewer")).toContainText("alpha");
    await app.screenshot({ path: "logs/e2e/file-preview-spreadsheet.png" });
  });

  test("renders notebook cells and output", async ({ app }) => {
    const content = JSON.stringify({
      cells: [{ cell_type: "code", source: ["print(1)"], outputs: [{ text: ["1\n"] }] }],
    });
    await openFileInGrid(
      app,
      { title: "demo.ipynb", path: ["demo.ipynb"], content, extension: "ipynb" },
      "[data-testid='notebook-viewer']",
    );
    await expect(app.getByTestId("notebook-viewer")).toContainText("print(1)");
    await expect(app.getByTestId("notebook-viewer")).toContainText("1");
  });
});
