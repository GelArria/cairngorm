import { test, expect } from "./fixtures";

async function openKeybindings(app: import("@playwright/test").Page) {
  await app.evaluate(() => window.dispatchEvent(new CustomEvent("app-open-settings")));
  await app.getByRole("button", { name: "Keybindings", exact: true }).click();
  await expect(app.getByTestId("keybindings-settings")).toBeVisible();
}

test.beforeEach(async ({ app }) => {
  await app.evaluate(() => localStorage.clear());
  await app.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    const api = (window as any).__TAURI_INTERNALS__,
      original = api.invoke;
    api.invoke = (cmd: string, args: any) => {
      if (
        cmd === "plugin:sql|execute" &&
        /(?:INTO|UPDATE|FROM)\s+projects\b/i.test(args?.query ?? "")
      )
        return Promise.resolve([1, 1]);
      if (cmd === "plugin:sql|select" && /FROM\s+projects/i.test(args?.query ?? ""))
        return Promise.resolve(
          (window as any).__KEYBINDING_PROJECTS__ ?? [
            { id: "keybindings-qa", name: "Repo", root_path: "C:/repo", created_at: "2026-01-01" },
          ],
        );
      return original(cmd, args);
    };
  });
  await app.reload();
  await expect(app.getByTestId("terminal-empty")).toBeVisible();
});

test("capture, conflict, cancellation, persistence, disable and reset", async ({ app }) => {
  await openKeybindings(app);
  await app.getByRole("button", { name: "Edit Open settings shortcut", exact: true }).click();
  await app.keyboard.press("Control+s");
  await expect(app.getByRole("alert")).toContainText("Save file");
  await expect(app.getByTestId("settings-dialog")).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(app.getByTestId("settings-dialog")).toBeVisible();
  await app.getByRole("button", { name: "Edit Open settings shortcut", exact: true }).click();
  await app.keyboard.press("Control+Shift+k");
  await expect(
    app.getByTestId("keybindings-settings").getByText("1 customized", { exact: false }),
  ).toBeVisible();
  await app.getByLabel("Search keybindings").fill("settings");
  await expect(app.locator('[data-testid^="keybinding-"]')).toHaveCount(1);
  await app.takeScreenshot("keybindings-search");
  await app.getByLabel("Search keybindings").fill("");
  await app.takeScreenshot("keybindings-settings");
  await app.setViewportSize({ width: 640, height: 720 });
  await app.takeScreenshot("keybindings-compact");
  expect(
    await app.getByTestId("settings-dialog").evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await app.setViewportSize({ width: 360, height: 720 });
  await app.takeScreenshot("keybindings-narrow");
  expect(
    await app
      .locator('[data-testid^="keybinding-"]')
      .evaluateAll((rows) => rows.every((row) => row.scrollWidth <= row.clientWidth)),
  ).toBe(true);
  await app.keyboard.press("Escape");
  await app.keyboard.press("Control+Shift+k");
  await expect(app.getByTestId("settings-dialog")).toBeVisible();
  await app.keyboard.press("Escape");
  await app.reload();
  await expect(app.getByTestId("terminal-empty")).toBeVisible();
  await app.keyboard.press("Control+Shift+k");
  await expect(app.getByTestId("settings-dialog")).toBeVisible();
  await app.getByRole("button", { name: "Keybindings", exact: true }).click();
  await app.getByRole("button", { name: "Disable Open settings shortcut", exact: true }).click();
  await expect(
    app.getByTestId("keybindings-settings").getByText("Unassigned", { exact: true }),
  ).toBeVisible();
  await app.keyboard.press("Escape");
  await app.keyboard.press("Control+Shift+k");
  await expect(app.getByTestId("settings-dialog")).not.toBeVisible();
  await openKeybindings(app);
  await app.getByRole("button", { name: "Restore all defaults", exact: true }).click();
  await app.keyboard.press("Escape");
  await app.keyboard.press("Control+Comma");
  await expect(app.getByTestId("settings-dialog")).toBeVisible();
});

test("new commands route tabs and font zoom without stealing terminal editing", async ({ app }) => {
  await app.keyboard.press("Control+Alt+n");
  await expect(app.locator(".cm-editor")).toBeVisible();
  await app.keyboard.press("Control+Shift+t");
  const tabs = app.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await app.keyboard.press("Control+Shift+Tab");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await app.keyboard.press("Control+Tab");
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await app.keyboard.press("Control+Shift+Tab");
  await app.keyboard.press("Control+w");
  await expect(tabs).toHaveCount(1);
  await app.keyboard.press("Control+Shift+t");
  await expect(tabs).toHaveCount(2);
  await expect(app.locator(".xterm-screen").last()).toBeVisible();
  await app.locator(".xterm-helper-textarea").last().focus();
  await app.keyboard.press("Control+w");
  await expect(tabs).toHaveCount(2);
  await app.keyboard.press("Control+Shift+w");
  await expect(tabs).toHaveCount(1);
  await app.keyboard.press("Control+Comma");
  await app.getByRole("button", { name: "Keybindings", exact: true }).click();
  await app
    .getByRole("button", { name: "Edit Increase terminal & chat font shortcut", exact: true })
    .click();
  await app.keyboard.press("Control+Shift+l");
  await app.keyboard.press("Escape");
  await app.keyboard.press("Control+Shift+l");
  await app.keyboard.press("Control+Comma");
  await app.getByRole("button", { name: "General", exact: true }).click();
  await expect(app.getByTestId("settings-font-size")).toHaveText("15px");
});

test("horizontal split, pane zoom and workspace shortcuts beside the calendar", async ({ app }) => {
  await app.keyboard.press("Control+Shift+t");
  const panes = app.locator("[data-pane-id]:visible");
  await expect(panes).toHaveCount(1);
  await app.keyboard.press("Control+Shift+Backslash");
  await expect(panes).toHaveCount(2);
  const boxes = await panes.evaluateAll((els) =>
    els.map((el) => ({
      top: el.getBoundingClientRect().top,
      left: el.getBoundingClientRect().left,
    })),
  );
  expect(boxes[1].top).toBeGreaterThan(boxes[0].top);
  expect(boxes[1].left).toBe(boxes[0].left);
  await app.keyboard.press("Control+Shift+Enter");
  await expect(panes).toHaveCount(1);
  await app.keyboard.press("Escape");
  await expect(panes).toHaveCount(2);
  await app.getByTestId("header-settings").focus();
  await app.keyboard.press("Control+Alt+2");
  await expect(app.getByTestId("calendar-view")).toBeVisible();
  // Calendar is a sidebar module: the workspace and its shortcuts stay active.
  await expect(panes).toHaveCount(2);
  await app.keyboard.press("Control+Shift+w");
  await expect(panes).toHaveCount(1);
  await app.keyboard.press("Control+Alt+1");
  await expect(panes).toHaveCount(1);
  await app.keyboard.press("Control+Comma");
  await app.getByRole("button", { name: "Keybindings", exact: true }).click();
  await app
    .getByRole("button", { name: "Edit Increase terminal & chat font shortcut", exact: true })
    .click();
  await app.keyboard.press("Control+Shift+l");
  await app.keyboard.press("Control+Shift+l");
  await app.getByRole("button", { name: "General", exact: true }).click();
  await expect(app.getByTestId("settings-font-size")).toHaveText("14px"); // dialogs own their input
  await app.keyboard.press("Escape");
  await app.getByTestId("header-settings").focus();
  await app.keyboard.press("Control+Backslash");
  await expect(panes).toHaveCount(2);
});

test("CodeMirror matching-bracket navigation does not split a pane", async ({ app }) => {
  await app.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("editor-open-file", {
        detail: {
          title: "brackets.ts",
          path: ["brackets.ts"],
          content: "const value = (1 + 2);",
          extension: "ts",
        },
      }),
    ),
  );
  const editor = app.locator(".cm-content");
  await editor.click();
  await app.keyboard.press("Control+Home");
  for (let i = 0; i < 14; i++) await app.keyboard.press("ArrowRight");
  await app.keyboard.press("Control+Shift+Backslash");
  await expect(app.locator("[data-pane-id]:visible")).toHaveCount(1);
  await expect(app.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab")).toHaveCount(
    1,
  );
  await expect(editor).toHaveText("const value = (1 + 2);");
});

test("project switching and new native agent", async ({ app }) => {
  await app.addInitScript(() => {
    (window as any).__KEYBINDING_PROJECTS__ = [
      { id: "keybindings-qa", name: "Repo", root_path: "C:/repo", created_at: "2026-01-01" },
      { id: "keybindings-other", name: "Other", root_path: "C:/other", created_at: "2026-01-02" },
    ];
  });
  await app.reload();
  await expect(app.getByTestId("terminal-empty")).toContainText("Repo");
  await app.keyboard.press("Control+Alt+PageDown");
  await expect(app.getByTestId("terminal-empty")).toContainText("Other");
  await app.keyboard.press("Control+Alt+PageUp");
  await expect(app.getByTestId("terminal-empty")).toContainText("Repo");
  await app.evaluate(() => {
    const api = (window as any).__TAURI_INTERNALS__,
      original = api.invoke;
    api.invoke = (cmd: string, args: unknown) =>
      cmd === "get_agent_env"
        ? Promise.resolve({
            apiKeyEnv: "OPENAI_API_KEY",
            keyAvailable: true,
            provider: "openai",
          })
        : original(cmd, args);
  });
  await app.keyboard.press("Control+Shift+n");
  await expect(app.locator("[data-pane-id]:visible")).toHaveCount(1);
  expect(
    await app.evaluate(() =>
      (window as any).__CMD_LOG__.some((entry: string) =>
        entry.startsWith("resolve_agent_runner:"),
      ),
    ),
  ).toBe(true);
});
