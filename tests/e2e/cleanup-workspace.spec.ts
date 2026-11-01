import { test, expect } from "./fixtures";

test("Ctrl+N creates a visible terminal instead of a hidden conversation", async ({ app }) => {
  await expect(app.getByTestId("tab-title")).toHaveCount(0);
  await app.locator('[data-testid="sidebar"]').click({ position: { x: 10, y: 400 } });
  await app.keyboard.press("Control+n");
  await expect(app.getByTestId("tab-title")).toHaveCount(1);
  await expect(app.locator("[data-pane-id]:visible")).toHaveCount(1);
  await expect(app.locator('[data-testid="conversation-row"]')).toHaveCount(0);
});

test("clipboard files open real panes and text-only paste is not intercepted", async ({ app }) => {
  const paste = (files: boolean) =>
    app.evaluate((withFile) => {
      const data = new DataTransfer();
      if (withFile)
        data.items.add(new File(["pasted content"], "clip.txt", { type: "text/plain" }));
      else data.setData("text/plain", "ordinary text");
      const event = new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }, files);
  expect(await paste(false)).toBe(false);
  await expect(app.getByTestId("tab-title")).toHaveCount(0);
  expect(await paste(true)).toBe(true);
  await expect(app.locator(".cm-editor:visible .cm-content")).toHaveText("pasted content");
  await expect(app.getByTestId("tab-title")).toHaveCount(1);
});

test("dragging a scratch file preserves its content at the new location", async ({ app }) => {
  await app.addInitScript(() => {
    localStorage.setItem("sidebar-explorer-open", "true");
    localStorage.setItem(
      "workspace-files",
      JSON.stringify([
        { name: "src", type: "folder", children: [] },
        { name: "move.txt", type: "file" },
      ]),
    );
    localStorage.setItem("file-contents", JSON.stringify({ "move.txt": "content must survive" }));
  });
  await app.reload();
  await expect(app.getByRole("button", { name: "Close folder", exact: true })).toBeVisible();
  await app.getByRole("button", { name: "Close folder", exact: true }).click();
  const panel = app.getByTestId("workspace-panel");
  const source = panel.getByTestId("file-tree-row").filter({ hasText: "move.txt" });
  const destination = panel.getByTestId("file-tree-row").filter({ hasText: "src" });
  await source.dragTo(destination);
  await expect
    .poll(() => app.evaluate(() => JSON.parse(localStorage.getItem("workspace-files")!)))
    .toEqual([{ name: "src", type: "folder", children: [{ name: "move.txt", type: "file" }] }]);
  await destination.click();
  await panel.getByTestId("file-tree-row").filter({ hasText: "move.txt" }).click();
  await expect(app.locator(".cm-editor:visible .cm-content")).toHaveText("content must survive");
  await app.screenshot({ path: "logs/e2e/cleanup-scratch-move.png", animations: "disabled" });
  await expect
    .poll(() => app.evaluate(() => JSON.parse(localStorage.getItem("file-contents")!)))
    .toEqual({ "src/move.txt": "content must survive" });
});
