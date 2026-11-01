import { test, expect, openFileInGrid } from "./fixtures";

const file = (title: string) => ({
  title,
  path: [title],
  content: "alpha alpha\nomega",
  extension: "txt",
});

test("file search opens, replaces and closes in the active editor", async ({ app }) => {
  await openFileInGrid(app, file("search.txt"), ".cm-editor");
  const editor = app.locator(".cm-editor:visible");
  await editor.locator(".cm-content").click();
  await app.keyboard.press("Control+f");
  await expect(editor.getByRole("textbox", { name: "Find", exact: true })).toBeVisible();
  await editor.getByRole("textbox", { name: "Find", exact: true }).fill("alpha");
  await editor.locator('button[name="next"]').click();
  await expect(editor.locator(".cm-searchMatch")).not.toHaveCount(0);
  await editor.locator(".cm-content").click();
  await app.keyboard.press("Control+h");
  await editor.getByRole("textbox", { name: "Replace", exact: true }).fill("beta");
  await editor.locator('button[name="replaceAll"]').click();
  await expect(editor.locator(".cm-content")).toHaveText("beta betaomega");
  await app.screenshot({ path: "logs/e2e/cleanup-editor-search.png", animations: "disabled" });
  await editor.getByRole("button", { name: "close", exact: true }).click();
  await expect(editor.locator(".cm-search")).toHaveCount(0);
});

test("file search state stays with its file, not a global editor singleton", async ({ app }) => {
  await openFileInGrid(app, file("first.txt"), ".cm-editor");
  let editor = app.locator(".cm-editor:visible");
  await editor.locator(".cm-content").click();
  await app.keyboard.press("Control+f");
  await editor.getByRole("textbox", { name: "Find", exact: true }).fill("alpha");
  await editor.locator('button[name="next"]').click();
  await openFileInGrid(app, file("second.txt"), ".cm-editor:visible");
  editor = app.locator(".cm-editor:visible");
  await editor.locator(".cm-content").click();
  await app.keyboard.press("Control+f");
  await expect(editor.getByRole("textbox", { name: "Find", exact: true })).toHaveValue("");
});

test("search and replacement target the focused file in a split", async ({ app }) => {
  await openFileInGrid(app, file("left.txt"), ".cm-editor:visible");
  await openFileInGrid(app, file("right.txt"), ".cm-editor:visible");
  const tabs = app.getByTestId("tab-title");
  await tabs.nth(0).click();
  const pane = (await app.locator("[data-pane-id]:visible").boundingBox())!;
  const tab = (await tabs.nth(1).boundingBox())!;
  await app.mouse.move(tab.x + 10, tab.y + 5);
  await app.mouse.down();
  await app.mouse.move(tab.x + 60, tab.y + 60, { steps: 5 });
  await app.mouse.move(pane.x + pane.width * 0.9, pane.y + pane.height * 0.5, { steps: 8 });
  await expect(app.getByTestId("dock-zone")).toHaveAttribute("data-edge", "right");
  await app.mouse.up();
  await expect(app.locator("[data-pane-id]:visible")).toHaveCount(2);
  const editors = app.locator(".cm-editor:visible");
  await expect(editors).toHaveCount(2);
  await editors.nth(0).locator(".cm-content").click();
  await app.keyboard.press("Control+h");
  const panel = editors.nth(0).locator(".cm-search");
  await panel.getByRole("textbox", { name: "Find", exact: true }).fill("alpha");
  await panel.getByRole("textbox", { name: "Replace", exact: true }).fill("only here");
  await panel.locator('button[name="replaceAll"]').click();
  await expect(editors.nth(0).locator(".cm-content")).toHaveText("only here only hereomega");
  await expect(editors.nth(1).locator(".cm-content")).toHaveText("alpha alphaomega");
  await expect(editors.nth(1).locator(".cm-search")).toHaveCount(0);
  await app.screenshot({ path: "logs/e2e/cleanup-split-search.png", animations: "disabled" });
});

test("workspace search highlights still work without opening the file search panel", async ({
  app,
}) => {
  await openFileInGrid(
    app,
    { ...file("result.txt"), line: 2, highlightText: "omega" },
    ".cm-editor",
  );
  const editor = app.locator(".cm-editor:visible");
  await expect(editor.locator(".cm-searchMatch")).not.toHaveCount(0);
  await expect(editor.locator(".cm-search")).toHaveCount(0);
});
