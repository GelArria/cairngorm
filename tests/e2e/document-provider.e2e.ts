// A third-party provider for a new extension: honest "no provider", install from Settings,
// then the same pane hosts the provider's own view in an isolated origin.
import { test, expect, useDocumentFixtures } from "./docx-fixtures";

useDocumentFixtures();

const NOTES = "C:/Project With Spaces/Field notes.sample";
const manifest = {
  id: "dev.cairngorm.sample-viewer",
  name: "Sample viewer",
  version: "1.0.0",
  description: "Example provider: shows .sample files as a titled list of fields.",
  fileTypes: [
    { label: "Sample document", extensions: ["sample"], mimeTypes: ["text/x-cairngorm-sample"] },
  ],
  capabilities: ["view", "edit"],
  maxBytes: 1048576,
};

async function openNotes(browser: any, text: string) {
  await browser.evaluate(
    ({ path, text, manifest }: { path: string; text: string; manifest: unknown }) => {
      const w = window as any;
      w.__providerManifest = manifest;
      w.__documentFiles = { [path]: text };
      w.__E2E_PICK__ = ["C:/Providers/sample-viewer"];
      window.dispatchEvent(
        new CustomEvent("editor-open-file", {
          detail: {
            title: "Field notes.sample",
            path: ["Field notes.sample"],
            fullPath: path,
            content: "",
            extension: "sample",
            document: true,
          },
        }),
      );
    },
    { path: NOTES, text, manifest },
  );
}

test("installs a provider for a new extension and renders it isolated inside the pane", async ({
  app,
  browser,
  screen,
}) => {
  await openNotes(
    browser,
    "# Field notes\nSite = Cairngorm plateau\nWeather = Clear, 4 °C\nSnow patches persisted on the north face.",
  );
  await expect(screen.getByTestId("document-no-provider")).toContainText(
    "No provider for .sample files",
  );
  await app.screenshot("document-no-provider");

  await screen.getByRole("button", { name: "Document providers" }).tap();
  await screen.getByTestId("document-provider-install").tap();
  const review = screen.getByTestId("document-provider-review");
  await expect(review).toContainText("Sample document (.sample)");
  await expect(review).toContainText("Read other files, run commands or save changes");
  await app.screenshot("document-provider-review");
  await screen.getByTestId("document-provider-approve").tap();
  await expect(screen.getByTestId("document-provider-list").first()).toContainText("Sample viewer");
  await app.screenshot("document-settings-installed");
  await browser.keyboard.press("Escape");

  const view = browser
    .frameLocator('[data-testid="document-provider-frame"]')
    .frameLocator("#provider");
  await expect(view.getByRole("heading", { name: "Field notes" })).toBeVisible();
  await expect(view.getByRole("textbox", { name: "Site" })).toHaveValue("Cairngorm plateau");
  await expect(screen.getByTestId("document-header")).toContainText(
    "Sample document · Sample viewer",
  );
  // The provider declares "edit" and this is a file on disk, so Cairngorm offers saving.
  await expect(screen.getByTestId("document-header")).toContainText("Saved");
  const isolation = await browser.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      '[data-testid="document-provider-frame"]',
    )!;
    let reachable = true;
    try {
      void frame.contentDocument!.body;
    } catch {
      reachable = false;
    }
    return {
      sandbox: frame.getAttribute("sandbox"),
      crossOrigin: new URL(frame.src).origin !== location.origin,
      reachable: reachable && frame.contentDocument !== null,
    };
  });
  expect(isolation).toEqual({
    sandbox: "allow-scripts allow-same-origin",
    crossOrigin: true,
    reachable: false,
  });
  await app.screenshot("document-provider-isolated");
});

test("refreshes the isolated view when the file changes on disk", async ({ browser, screen }) => {
  await browser.evaluate((manifest) => {
    (window as any).__documentProviders = [{ id: (manifest as any).id, manifest, error: null }];
  }, manifest);
  await openNotes(browser, "# Before\nState = old");
  const view = browser
    .frameLocator('[data-testid="document-provider-frame"]')
    .frameLocator("#provider");
  // The registry may have loaded before the provider existed; Settings refreshes it.
  if (await screen.getByTestId("document-no-provider").count()) {
    await screen.getByRole("button", { name: "Document providers" }).tap();
    await screen.getByTestId("document-provider-install").tap();
    await screen.getByTestId("document-provider-approve").tap();
    await browser.keyboard.press("Escape");
  }
  await expect(view.getByRole("heading", { name: "Before" })).toBeVisible();
  await browser.evaluate((path) => {
    (window as any).__documentFiles[path] = "# After\nState = new";
  }, NOTES);
  await screen.getByRole("button", { name: "Reload from disk" }).tap();
  await expect(view.getByRole("heading", { name: "After" })).toBeVisible();
  await expect(view.getByRole("textbox", { name: "State" })).toHaveValue("new");
});

test("edits through the provider and saves through Cairngorm with the opened version", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate((manifest) => {
    (window as any).__documentProviders = [{ id: (manifest as any).id, manifest, error: null }];
  }, manifest);
  await openNotes(browser, "# Survey\nSite = Old site\nWeather = Rain");
  if (await screen.getByTestId("document-no-provider").count()) {
    await screen.getByRole("button", { name: "Document providers" }).tap();
    await screen.getByTestId("document-provider-install").tap();
    await screen.getByTestId("document-provider-approve").tap();
    await browser.keyboard.press("Escape");
  }
  const view = browser
    .frameLocator('[data-testid="document-provider-frame"]')
    .frameLocator("#provider");
  const site = view.getByRole("textbox", { name: "Site" });
  await expect(site).toHaveValue("Old site");
  await site.fill("Ben Macdui summit");
  const header = screen.getByTestId("document-header");
  await expect(header).toContainText("Unsaved changes");
  await app.screenshot("document-provider-unsaved");

  await browser.evaluate(() => {
    (window as any).__saveError =
      "The file changed on disk since it was opened. Reload it before saving; your edits were not written.";
  });
  await screen.getByTestId("document-save").tap();
  await expect(screen.getByRole("alert")).toContainText("changed on disk");
  await expect(header).toContainText("Unsaved changes");

  await browser.evaluate(() => {
    (window as any).__saveError = undefined;
  });
  await screen.getByTestId("document-save").tap();
  await expect(header).toContainText("Saved");
  const saves = await browser.evaluate(() => (window as any).__saves);
  expect(saves[1].path).toBe("C:/Project With Spaces/Field notes.sample");
  expect(saves[1].version).toMatch(/^[0-9a-f]{64}$/);
  expect(saves[1].text).toContain("Site = Ben Macdui summit");
  // The provider keeps its view: a committed save is not a reload.
  await expect(site).toHaveValue("Ben Macdui summit");
  await app.screenshot("document-provider-saved");
});

test("an agent opens a document in its own background project and runs a declared operation", async ({
  app,
  browser,
  screen,
}) => {
  const operations = [
    { name: "list-fields", description: "List fields.", inputSchema: { type: "object" } },
    { name: "set-field", description: "Change one field.", inputSchema: { type: "object" } },
  ];
  const plan = "C:/Other Project/Plan.sample";
  await browser.evaluate(
    async ({ manifest, operations, plan }) => {
      const w = window as any;
      w.__documentProviders = [
        { id: manifest.id, manifest: { ...manifest, operations }, error: null },
      ];
      w.__tickets = { t1: "# Plan\nStatus = Draft\nOwner = Ranger" };
      w.__documentFiles = { [plan]: "# Plan\nStatus = Draft\nOwner = Ranger" };
      const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
      await emit("document-providers-changed");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await emit("document-open-request", {
        ticket: "t1",
        project: "docx-b",
        terminal: "term-b",
        path: plan,
        name: "Plan.sample",
        size: 34,
        sha256: "x",
      });
    },
    { manifest, operations, plan },
  );
  const ack = async (cmd: string) =>
    browser.evaluate(
      (cmd) =>
        (window as any).__docxCalls
          .filter((call: any) => call.cmd === cmd)
          .map((call: any) => call.args),
      cmd,
    );
  await expect
    .poll(() => ack("document_ticket_ack"))
    .toEqual([{ ticket: "t1", openedIn: "document", operations }]);
  // The user's current project is untouched.
  await expect(screen.getByTestId("active-project-name")).toHaveText("Documents A");
  await expect(screen.getByTestId("document-pane")).toHaveCount(0);

  await screen.getByTestId("sidebar-project-picker").tap();
  await screen.getByTestId("project-box-docx-b").tap();
  const view = browser
    .frameLocator('[data-testid="document-provider-frame"]')
    .frameLocator("#provider");
  await expect(view.getByRole("textbox", { name: "Status" })).toHaveValue("Draft");

  const run = (request: Record<string, unknown>) =>
    browser.evaluate(async (request) => {
      const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
      await emit("document-operation-request", request);
    }, request);
  await run({
    id: "op1",
    project: "docx-b",
    path: String.raw`C:\Other Project\plan.sample`,
    operation: "set-field",
    arguments: { key: "Status", value: "Approved" },
    save: true,
  });
  // Every agent save needs the user's approval in the pane.
  const confirm = screen.getByTestId("confirm-dialog");
  await expect(confirm).toContainText("Save changes from an agent?");
  await expect(confirm).toContainText('"set-field"');
  await app.screenshot("document-agent-save-confirm");
  await confirm.getByRole("button", { name: "Save" }).tap();
  await run({
    id: "op4",
    project: "docx-b",
    path: plan,
    operation: "set-field",
    arguments: { key: "Owner", value: "Agent" },
    save: true,
  });
  await expect(confirm).toContainText("Save changes from an agent?");
  await confirm.getByRole("button", { name: "Cancel" }).tap();
  await run({
    id: "op2",
    project: "docx-a",
    path: plan,
    operation: "list-fields",
    arguments: {},
    save: false,
  });
  await run({
    id: "op3",
    project: "docx-b",
    path: plan,
    operation: "delete-file",
    arguments: {},
    save: false,
  });
  await expect.poll(async () => (await ack("document_request_complete")).length).toBe(4);
  const results = Object.fromEntries(
    (await ack("document_request_complete")).map((r: any) => [r.id, r]),
  );
  expect(results.op1.result).toEqual({ result: { key: "Status", value: "Approved" }, saved: true });
  expect(results.op2.error).toContain("not open in the terminal's project");
  expect(results.op3.error).toContain('does not offer the "delete-file" operation');
  expect(results.op4.error).toContain("did not approve");
  await expect(view.getByRole("textbox", { name: "Status" })).toHaveValue("Approved");
  const saves = await browser.evaluate(() => (window as any).__saves);
  expect(saves.at(-1).text).toContain("Status = Approved");
  // The declined change stays visible and unsaved.
  await expect(view.getByRole("textbox", { name: "Owner" })).toHaveValue("Agent");
  await expect(screen.getByTestId("document-header")).toContainText("Unsaved changes");
  expect(saves.at(-1).text).not.toContain("Owner = Agent");
  await app.screenshot("document-agent-operation");
});

test("a document window shows the same pane and offers the way back", async ({
  app,
  browser,
  screen,
}) => {
  const path = "C:/Project With Spaces/Budget.csv";
  await browser.addInitScript((path) => {
    (window as any).__documentFiles = { [path]: "Item,Amount\nTrail repair,1200\nSignage,450" };
  }, path);
  const payload = { tabId: "7", title: "Budget.csv", extension: "csv", path, scope: "docx-a" };
  await browser.goto(`/?document=${encodeURIComponent(JSON.stringify(payload))}`);
  await expect(screen.getByTestId("document-pane")).toBeVisible();
  await expect(screen.getByRole("cell", { name: "Trail repair" })).toBeVisible();
  await expect(screen.getByTestId("document-window-return")).toContainText(
    "Move back to main window",
  );
  // A window holds no workspace: no terminals, sidebar or second agent.
  await expect(screen.getByTestId("sidebar")).toHaveCount(0);
  await expect(screen.getByTestId("document-open-window")).toHaveCount(0);
  await app.screenshot("document-window");
});
