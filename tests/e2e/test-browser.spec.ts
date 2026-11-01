import { test, expect } from "./fixtures";
import { send, output } from "./test-output-fixture";

test("browser tabs follow live pages, pin a selection, pause and resume without losing tests", async ({
  app,
}) => {
  await app.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    const api = (window as any).__TAURI_INTERNALS__,
      original = api.invoke;
    api.invoke = (cmd: string, args: any) => {
      if (cmd === "pty_ensure") (window as any).__BROWSER_SESSION__ = args.sessionId;
      return original(cmd, args);
    };
  });
  await app.reload();
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal" })
    .click();
  const id = await app.evaluate(() => (window as any).__BROWSER_SESSION__ as string);
  await output(app, id, "Running 3 tests using 2 workers\r\n");
  const website = await app.context().newPage();
  await website.goto("/tests/e2e/fixtures/visual-app.html");
  const image = (await website.screenshot({ type: "jpeg" })).toString("base64");
  await website.close();
  const frame = (pageId: string, browserName: string, timestamp: number, title: string) => ({
    type: "frame",
    pageId,
    browserName,
    projectName: "Checkout",
    timestamp,
    width: 800,
    height: 600,
    title,
    url: `http://localhost:3000/${title.toLowerCase()}`,
    image,
  });
  await send(app, `test-browser-${id}`, frame("chrome", "chromium", 1, "Cart"));
  await send(app, `test-browser-${id}`, frame("fox", "firefox", 2, "Payment"));
  const pane = app.getByTestId("test-pane");
  const pages = pane.getByRole("tablist", { name: "Test browser pages" });
  await expect(pages.getByRole("tab", { name: /Firefox/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await pages.getByRole("tab", { name: /Chromium/ }).click();
  await send(app, `test-browser-${id}`, frame("safari", "webkit", 3, "Receipt"));
  await expect(pages.getByRole("tab", { name: /Chromium/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await pane.getByRole("button", { name: "Follow tests", exact: true }).click();
  await expect(pages.getByRole("tab", { name: /WebKit/ })).toHaveAttribute("aria-selected", "true");
  await pane.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(pane.getByTestId("test-browser-status")).toHaveText("Paused");
  await send(app, `test-browser-${id}`, frame("safari", "webkit", 4, "Done"));
  await send(app, `test-browser-${id}`, frame("popup", "chromium", 5, "Popup"));
  await expect(pane.getByTestId("test-browser-status")).toHaveText("Paused");
  await expect(pages.getByRole("tab", { name: /WebKit/ })).toHaveAttribute("aria-selected", "true");
  await expect(pane.getByLabel("Test browser page", { exact: true })).toContainText("/receipt");
  await pane.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(pane.getByLabel("Test browser page", { exact: true })).toContainText("/popup");
  await pages.getByRole("tab", { name: /WebKit/ }).click();
  await expect(pane.getByLabel("Test browser page", { exact: true })).toContainText("/done");
  await pages.getByRole("tab", { name: /WebKit/ }).press("Home");
  await expect(pages.getByRole("tab", { name: /Chromium.*Cart/ })).toBeFocused();
  await expect(pages.getByRole("tab", { name: /Chromium.*Cart/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await pages.getByRole("tab", { name: /Chromium.*Cart/ }).press("ArrowRight");
  await expect(pages.getByRole("tab", { name: /Firefox/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await app.screenshot({ path: "logs/e2e/test-browser-tabs.png" });
  await pane.getByRole("button", { name: "Browser", exact: true }).click();
  await expect(pane.getByRole("textbox", { name: "Browser address" })).toBeDisabled();
  await expect(pane.getByTestId("browser-preview")).toContainText("available in the desktop app");
  await pane.getByRole("button", { name: "Live tests", exact: true }).click();
  for (const pageId of ["chrome", "fox", "safari", "popup"])
    await send(app, `test-browser-${id}`, { type: "closed", pageId, timestamp: 6 });
  await expect(pane.getByTestId("test-browser-status")).toHaveText("Finished");
  await expect(pages.getByRole("tab")).toHaveCount(4);
});
