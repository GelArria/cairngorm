import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readFileSync } from "node:fs";
import { SEED_INIT } from "../mocks/tauri-seed";

const markdown = readFileSync(new URL("./fixtures/markdown-reader.md", import.meta.url), "utf8");

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (location.protocol.startsWith("http")) {
      localStorage.setItem("sidebar-side", "left");
      localStorage.setItem("show-splash", "false");
    }
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await expect(browser.locator('[data-testid="splash"]')).toHaveCount(0);
});

test("renders tables and mixed Markdown in the real file pane", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate((content) => {
    window.dispatchEvent(
      new CustomEvent("editor-open-file", {
        detail: { title: "README.md", path: ["README.md"], extension: "md", content },
      }),
    );
  }, markdown);
  const viewer = screen.getByTestId("markdown-viewer");
  await expect(viewer.getByRole("heading", "Markdown reading")).toBeVisible();
  await expect(viewer.getByRole("table")).toHaveCount(1);
  await expect(viewer.getByRole("columnheader")).toHaveText(["File", "Status", "Detail"]);
  await expect(viewer.getByRole("cell", "Path a|b")).toBeVisible();
  await expect(viewer.getByRole("checkbox").first()).toBeChecked();
  await expect(viewer.getByRole("checkbox").first()).toBeDisabled();
  await expect(
    browser.locator(".markdown-preview strong em, .markdown-preview em strong"),
  ).toHaveText("Bold + italic");
  await expect(browser.locator(".markdown-preview ol ul li")).toHaveText("Check the nested list");
  await expect(browser.locator(".markdown-preview pre code")).toContainText('"**text** | <tag>"');
  const tableStyle = await browser.evaluate(() => {
    const headers = document.querySelectorAll(".markdown-table th");
    return Array.from(headers, (header) => getComputedStyle(header).textAlign);
  });
  expect(tableStyle).toEqual(["left", "center", "right"]);
  await app.screenshot("markdown-reader-desktop");
  await screen.getByRole("button", "Edit", { exact: true }).tap();
  await expect(browser.locator(".cm-editor")).toBeVisible();
  await expect(browser.locator(".cm-content")).toContainText("| File | Status | Detail |");
});

test("wide tables scroll inside a narrow pane without spilling the document", async ({
  app,
  browser,
  screen,
}) => {
  await browser.setViewport({ width: 800, height: 900 });
  const wideTable =
    "# Wide table\n\n| A | B | C | D | E | F | G | H |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| one | two | three | four | five | six | seven | eight |";
  await browser.evaluate((content) => {
    window.dispatchEvent(
      new CustomEvent("editor-open-file", {
        detail: {
          title: "table.markdown",
          path: ["table.markdown"],
          extension: "markdown",
          content,
        },
      }),
    );
  }, wideTable);
  const region = screen.getByRole("region", "Markdown table");
  await expect(region).toBeVisible();
  await region.focus();
  await region.press("ArrowRight");
  await expect
    .poll(() =>
      browser.evaluate(() => {
        const table = document.querySelector<HTMLElement>(".markdown-table")!;
        return table.scrollLeft;
      }),
    )
    .toBeGreaterThan(0);
  const layout = await browser.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>(".markdown-preview")!;
    const table = document.querySelector<HTMLElement>(".markdown-table")!;
    return {
      tableScrolls: table.scrollWidth > table.clientWidth,
      viewerWidth: viewer.clientWidth,
      documentWidth: viewer.scrollWidth,
    };
  });
  expect(layout.tableScrolls).toBe(true);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewerWidth + 1);
  await app.screenshot("markdown-reader-narrow");
});

test("notebook Markdown uses the shared safe table renderer", async ({ browser, screen }) => {
  const content = JSON.stringify({
    cells: [
      {
        cell_type: "markdown",
        source:
          markdown +
          "\n\n<script>window.__MARKDOWN_EXECUTED__ = true</script>\n\n[bad](javascript:alert%281%29)",
      },
    ],
  });
  await browser.evaluate((content) => {
    window.dispatchEvent(
      new CustomEvent("editor-open-file", {
        detail: { title: "demo.ipynb", path: ["demo.ipynb"], extension: "ipynb", content },
      }),
    );
  }, content);
  await expect(screen.getByTestId("notebook-viewer").getByRole("table")).toHaveCount(1);
  const safety = await browser.evaluate(() => ({
    executed: "__MARKDOWN_EXECUTED__" in window,
    unsafe: document.querySelectorAll(
      '.markdown-preview script, .markdown-preview [href^="javascript:"]',
    ).length,
  }));
  expect(safety).toEqual({ executed: false, unsafe: 0 });
});
