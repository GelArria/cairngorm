import { test, expect, DOCX_PATH, dataUrl, useDocumentFixtures } from "./docx-fixtures";
import { docxFixture, PARAGRAPH, WORD_XML } from "../fixtures/docx";

useDocumentFixtures();

const frameSelector = '[data-testid="docx-viewer"] iframe';

test("opens a DOCX from the explorer inside Cairngorm with real formatting, table and image", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByTestId("sidebar-files-toggle").tap();
  await screen
    .getByTestId("workspace-panel")
    .getByTestId("file-tree-row")
    .filter({ hasText: "Review.final.日本語.DOCX" })
    .tap();
  const document = browser.frameLocator(frameSelector);
  await expect(document.getByText("Quarterly review — España 日本語 🚀")).toBeVisible();
  await expect(document.getByRole("table")).toHaveCount(1);
  await expect(document.getByRole("cell", "Coverage", { exact: true })).toBeVisible();
  await expect(document.getByRole("cell", "95%", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(() => {
        const doc = document.querySelector<HTMLIFrameElement>(
          '[data-testid="docx-viewer"] iframe',
        )!.contentDocument!;
        const text = Array.from(doc.querySelectorAll("span")).find(
          (el) => el.textContent === "Formatted summary",
        )!;
        const image = doc.querySelector("img")!;
        const style = getComputedStyle(text);
        return {
          bold: Number(style.fontWeight) >= 700,
          italic: style.fontStyle === "italic",
          imageLoaded: image.complete && image.naturalWidth > 0,
        };
      }),
    )
    .toEqual({ bold: true, italic: true, imageLoaded: true });
  await expect(screen.getByTestId("document-header")).toContainText(
    "DOCX document · Word document preview",
  );
  await expect(screen.getByTestId("document-header")).toContainText("Read-only");
  await expect(browser.locator(".cm-editor")).toHaveCount(0);
  await browser.keyboard.press("Control+s");
  expect(
    await browser.evaluate(() => ({
      opens: (window as any).__externalOpens,
      writes: (window as any).__docxCalls.filter((call: any) => call.cmd === "fs_write_file"),
      reads: (window as any).__docxCalls
        .filter((call: any) => call.cmd === "document_read_snapshot")
        .map((call: any) => call.args.path),
    })),
  ).toEqual({ opens: [], writes: [], reads: [DOCX_PATH] });
  await app.screenshot("docx-internal-desktop");
});

test("opens a DOCX from the file picker without a text read or OS launch", async ({
  browser,
  screen,
}) => {
  await browser.evaluate((path) => {
    (window as any).__E2E_PICK__ = [path];
  }, DOCX_PATH);
  await browser.keyboard.press("Control+o");
  await expect(browser.frameLocator(frameSelector).getByText("Formatted summary")).toBeVisible();
  expect(
    await browser.evaluate(() =>
      (window as any).__docxCalls.filter(
        (call: any) =>
          call.cmd === "fs_read_file" ||
          call.cmd === "fs_read_file_data_url" ||
          call.cmd === "fs_open_default",
      ),
    ),
  ).toEqual([]);
  await expect(screen.getByTestId("docx-viewer")).toBeVisible();
});

test("retains one pane on repeated opening and restores the document after a project remount", async ({
  browser,
  screen,
}) => {
  await browser.evaluate(() => {
    (window as any).__openDocx();
  });
  await expect(browser.frameLocator(frameSelector).getByText("Formatted summary")).toBeVisible();
  const id = await browser.evaluate(() =>
    document
      .querySelector('[data-testid="docx-viewer"]')!
      .closest("[data-pane-id]")!
      .getAttribute("data-pane-id"),
  );
  await browser.evaluate(() => {
    (window as any).__openDocx();
  });
  await expect(screen.getByTestId("docx-viewer")).toHaveCount(1);
  await screen.getByTestId("sidebar-project-picker").tap();
  await screen.getByTestId("project-box-docx-b").tap();
  await expect(screen.getByTestId("docx-viewer")).toHaveCount(0);
  await screen.getByTestId("sidebar-project-picker").tap();
  await screen.getByTestId("project-box-docx-a").tap();
  await expect(browser.frameLocator(frameSelector).getByText("Formatted summary")).toBeVisible();
  expect(
    await browser.evaluate(() =>
      document
        .querySelector('[data-testid="docx-viewer"]')!
        .closest("[data-pane-id]")!
        .getAttribute("data-pane-id"),
    ),
  ).toBe(id);
  expect(
    await browser.evaluate(() =>
      (window as any).__docxCalls.filter((call: any) => call.cmd === "pty_kill"),
    ),
  ).toEqual([]);
});

test("fits a narrow panel without leaking page width into the application", async ({
  app,
  browser,
  screen,
}) => {
  await browser.setViewport({ width: 420, height: 780 });
  await browser.evaluate(() => {
    (window as any).__openDocx();
  });
  await expect(browser.frameLocator(frameSelector).getByText("Formatted summary")).toBeVisible();
  expect(
    await browser.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>(
        '[data-testid="docx-viewer"] iframe',
      )!;
      const doc = frame.contentDocument!;
      return {
        frameFits: frame.getBoundingClientRect().right <= innerWidth + 1,
        pageFits: doc.documentElement.scrollWidth <= frame.clientWidth + 1,
        noAppOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    }),
  ).toEqual({ frameFits: true, pageFits: true, noAppOverflow: true });
  await expect(screen.getByTestId("document-header")).toContainText(
    "DOCX document · Word document preview",
  );
  await expect(screen.getByTestId("document-header")).toContainText("Read-only");
  await app.screenshot("docx-internal-narrow");
});

test("renders an empty Word body and an explicit page break without hanging", async ({
  browser,
  screen,
}) => {
  for (const [name, body, pages] of [
    ["empty.docx", "", 1],
    [
      "pages.docx",
      `${PARAGRAPH("First page")}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${PARAGRAPH("Second page")}`,
      2,
    ],
  ] as const) {
    const source = dataUrl(await docxFixture({ extra: { "word/document.xml": WORD_XML(body) } }));
    await browser.evaluate(
      ({ name, source }) => {
        (window as any).__openDocx(name, source);
      },
      { name, source },
    );
    await expect(browser.locator(`${frameSelector}[title="Document: ${name}"]`)).toBeVisible();
    await expect(
      browser.frameLocator(`${frameSelector}[title="Document: ${name}"]`).locator("section.docx"),
    ).toHaveCount(pages);
  }
  await expect(screen.getByRole("alert")).toHaveCount(0);
});
