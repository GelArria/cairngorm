import { test, expect, dataUrl, useDocumentFixtures } from "./docx-fixtures";
import { docxFixture, WORD_XML } from "../fixtures/docx";

useDocumentFixtures();

const frame = '[data-testid="docx-viewer"] iframe';

test("reports corrupt and encrypted document input without opening an external application", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate(() => {
    (window as any).__docxSource = "data:application/zip;base64,0M8R4KGxGuE=";
    (window as any).__openDocx("protected.docx");
  });
  await expect(screen.getByRole("alert")).toContainText("archive");
  await expect(browser.locator(".cm-editor")).toHaveCount(0);
  expect(await browser.evaluate(() => (window as any).__externalOpens)).toEqual([]);
  await app.screenshot("docx-invalid-document");
});

test("shows permission, missing-file and size errors rather than an endless loader", async ({
  browser,
  screen,
}) => {
  for (const [index, message] of [
    "Permission denied",
    "File not found",
    "Document is too large (25 MiB maximum).",
  ].entries()) {
    await browser.evaluate(
      ({ index, message }) => {
        (window as any).__docxReadError = message;
        (window as any).__openDocx(`failure-${index}.docx`);
      },
      { index, message },
    );
    await expect(screen.getByRole("alert")).toContainText(message);
    await expect(screen.getByRole("status").filter({ hasText: "Loading document" })).toHaveCount(0);
  }
});

test("rejects renamed macro content and linked external images before rendering", async ({
  browser,
  screen,
}) => {
  for (const [name, extra, message] of [
    ["macro.docx", { "word/vbaProject.bin": "active payload" }, "active content"],
    [
      "linked.docx",
      {
        "word/_rels/document.xml.rels":
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/pixel.png" TargetMode="External"/></Relationships>',
      },
      "external resources",
    ],
  ] as const) {
    const src = dataUrl(await docxFixture({ extra }));
    await browser.evaluate(
      ({ name, src }) => {
        (window as any).__openDocx(name, src);
      },
      { name, src },
    );
    await expect(screen.getByRole("alert")).toContainText(message);
  }
});

test("ignores embedded HTML, blocks script execution and makes hyperlinks inert", async ({
  browser,
  screen,
}) => {
  const network: string[] = [];
  await browser.route("https://example.invalid/**", async (route) => {
    network.push(route.request.url);
    await route.abort();
  });
  const source = dataUrl(
    await docxFixture({
      extra: {
        "word/chunk.html":
          '<script>parent.__DOCX_ACTIVE__=true</script><img src="https://example.invalid/track.png" onerror="parent.__DOCX_ACTIVE__=true">',
        "word/document.xml": WORD_XML(
          '<w:p><w:hyperlink r:id="link"><w:r><w:t>Safe visible reference</w:t></w:r></w:hyperlink></w:p><w:altChunk r:id="chunk"/>',
        ),
        "word/_rels/document.xml.rels":
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:parent.__DOCX_ACTIVE__=true" TargetMode="External"/><Relationship Id="chunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk.html"/></Relationships>',
      },
    }),
  );
  await browser.evaluate((source) => {
    (window as any).__openDocx("untrusted.docx", source);
  }, source);
  await expect(browser.frameLocator(frame).getByText("Safe visible reference")).toBeVisible();
  await browser.frameLocator(frame).getByText("Safe visible reference").tap();
  const safety = await browser.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="docx-viewer"] iframe')!;
    return {
      executed: Boolean((window as any).__DOCX_ACTIVE__),
      unsafe: iframe.contentDocument!.querySelectorAll(
        'script, iframe, object, [href^="javascript:"]',
      ).length,
      sandbox: iframe.getAttribute("sandbox"),
      external: (window as any).__externalOpens,
    };
  });
  expect(safety).toEqual({
    executed: false,
    unsafe: 0,
    sandbox: "allow-same-origin",
    external: [],
  });
  expect(network).toEqual([]);
  await expect(screen.getByTestId("docx-viewer")).toBeVisible();
});

test("refuses a symbol-field HTML injection before third-party rendering", async ({
  browser,
  screen,
}) => {
  const source = dataUrl(
    await docxFixture({
      extra: {
        "word/document.xml": WORD_XML(
          '<w:p><w:r><w:sym w:font="Arial" w:char="41;&lt;img src=&quot;https://example.invalid/x&quot; onerror=&quot;parent.__DOCX_ACTIVE__=true&quot;&gt;"/></w:r></w:p>',
        ),
      },
    }),
  );
  await browser.evaluate((source) => {
    (window as any).__openDocx("symbol.docx", source);
  }, source);
  await expect(screen.getByRole("alert")).toContainText("XML symbol");
  expect(await browser.evaluate(() => Boolean((window as any).__DOCX_ACTIVE__))).toBe(false);
});

test("never treats a remote URL as document data", async ({ browser, screen }) => {
  const requests: string[] = [];
  await browser.route("https://example.invalid/**", async (route) => {
    requests.push(route.request.url);
    await route.abort();
  });
  await browser.evaluate(() => {
    (window as any).__openDocx("remote.docx", "https://example.invalid/secret.docx");
  });
  await expect(screen.getByRole("alert")).toContainText("data URL");
  expect(requests).toEqual([]);
});
