import { test, expect } from "./fixtures";
import { splitNew } from "./split-helpers";

test.beforeEach(async ({ app }) => {
  await app.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (cmd: string, args: unknown) => {
      if (cmd.startsWith("pty_")) {
        ((window as any).__PTY_CALLS__ ??= []).push({ cmd, args });
        return cmd === "pty_replay" ? btoa("Windows PowerShell\r\nPS C:\\repo> ") : null;
      }
      if (cmd === "detect_home") return "C:/repo";
      return original(cmd, args);
    };
  });
  await app.reload();
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal" })
    .click();
  await splitNew(app);
  await expect(app.getByRole("tab")).toHaveCount(2);
});

test("split tabs omit the group name; close all confirms and cancels safely", async ({ app }) => {
  const bar = app.getByRole("tablist", { name: "Workspace tabs" });
  await expect(bar).not.toContainText("Home");
  await expect(bar.locator("[data-split-group]")).toHaveCount(1);
  await app.screenshot({ animations: "disabled", path: "logs/e2e/terminal-groups-tabs.png" });
  await app.getByRole("tab").first().click({ button: "right" });
  await expect(
    app.getByRole("menuitem", { name: "Close other terminals…", exact: true }),
  ).toBeVisible();
  await app.screenshot({ animations: "disabled", path: "logs/e2e/terminal-groups-menu.png" });
  await app.getByRole("menuitem", { name: "Close all terminals…", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "Close all terminals?" });
  await expect(dialog).toContainText("Close 2 terminals in Home?");
  await expect(app.getByRole("tab")).toHaveCount(2);
  await expect
    .poll(() =>
      app.evaluate(
        () => ((window as any).__PTY_CALLS__ ?? []).filter((c: any) => c.cmd === "pty_kill").length,
      ),
    )
    .toBe(0);
  await app.screenshot({ animations: "disabled", path: "logs/e2e/terminal-groups-confirm.png" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(app.getByRole("tab")).toHaveCount(2);

  await app.getByRole("tab").first().click({ button: "right" });
  await app.getByRole("menuitem", { name: "Close all terminals…", exact: true }).click();
  await app.keyboard.press("Control+Shift+W");
  await expect(app.getByRole("tab")).toHaveCount(2);
  await app.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(app.getByRole("tab")).toHaveCount(2);

  // The tab strip background offers the same confirmed bulk action.
  await bar.click({
    button: "right",
    position: { x: (await bar.boundingBox())!.width - 20, y: 15 },
  });
  await app.getByRole("menuitem", { name: "Close all terminals…", exact: true }).click();
  await dialog.getByRole("button", { name: "Close 2 terminals", exact: true }).click();
  await expect(app.getByRole("tab")).toHaveCount(0);
  await expect(app.getByTestId("project-terminals-empty")).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(
        () => ((window as any).__PTY_CALLS__ ?? []).filter((c: any) => c.cmd === "pty_kill").length,
      ),
    )
    .toBe(2);
});

test("sidebar close others preserves the clicked terminal; close all keeps open files", async ({
  app,
}) => {
  const rows = app.getByTestId("project-terminals").locator('[data-testid^="term-"]');
  const firstTitle = await app.getByRole("tab").first().getAttribute("aria-label");
  await rows.first().click({ button: "right" });
  await app.getByRole("menuitem", { name: "Close other terminals…", exact: true }).click();
  await app
    .getByRole("dialog")
    .getByRole("button", { name: "Close 1 terminal", exact: true })
    .click();
  await expect(app.getByRole("tab")).toHaveCount(1);
  await expect(app.getByRole("tab")).toHaveAttribute("aria-label", firstTitle!);
  await rows.first().click({ button: "right" });
  await expect(
    app.getByRole("menuitem", { name: "Close other terminals…", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await app.keyboard.press("Escape");
  await app.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("editor-open-file", {
        detail: {
          title: "notes.txt",
          path: ["notes.txt"],
          content: "Keep this draft",
          extension: "txt",
        },
      }),
    ),
  );
  await expect(app.getByRole("tab", { name: "notes.txt", exact: true })).toBeVisible();
  await app
    .locator('[data-testid="project-terminals"] [data-testid^="term-"]')
    .first()
    .click({ button: "right" });
  await app.getByRole("menuitem", { name: "Close all terminals…", exact: true }).click();
  await app.keyboard.press("Control+Shift+W");
  await expect(app.getByRole("tab")).toHaveCount(2);
  await app
    .getByRole("dialog")
    .getByRole("button", { name: "Close 1 terminal", exact: true })
    .click();
  await expect(app.getByRole("tab")).toHaveCount(1);
  await expect(app.getByRole("tab", { name: "notes.txt", exact: true })).toBeVisible();
  await expect(app.getByTestId("project-terminals-empty")).toBeVisible();
  await app.screenshot({
    animations: "disabled",
    path: "logs/e2e/terminal-groups-file-preserved.png",
  });
});

test("a narrow workspace keeps the menu and confirmation within the viewport", async ({ app }) => {
  await app.setViewportSize({ width: 800, height: 600 });
  await app.getByRole("tab").last().click({ button: "right" });
  const menu = app.getByRole("menu");
  await expect(menu).toBeInViewport({ ratio: 1 });
  await app.getByRole("menuitem", { name: "Close all terminals…", exact: true }).click();
  await expect(app.getByTestId("confirm-dialog")).toBeInViewport({ ratio: 1 });
  await app.screenshot({ animations: "disabled", path: "logs/e2e/terminal-groups-narrow.png" });
  await app.keyboard.press("Escape");
  await expect(app.getByRole("tab")).toHaveCount(2);
});

test("right-click below the sidebar terminal list offers confirmed close all", async ({ app }) => {
  const background = app.getByTestId("project-terminals").locator("..");
  const rightClickBlankArea = async () => {
    const bounds = (await background.boundingBox())!;
    await background.click({
      button: "right",
      position: { x: bounds.width / 2, y: bounds.height - 40 },
    });
  };
  await rightClickBlankArea();
  await expect(app.getByRole("menu")).toHaveCount(1);
  await app.screenshot({
    animations: "disabled",
    path: "logs/e2e/sidebar-blank-close-all-menu.png",
  });
  const closeAll = app.getByRole("menuitem", { name: "Close all terminals…", exact: true });
  await expect(closeAll).toBeVisible();
  await closeAll.click();
  const dialog = app.getByRole("dialog", { name: "Close all terminals?" });
  await expect(dialog).toContainText("Close 2 terminals in Home?");
  await app.screenshot({
    animations: "disabled",
    path: "logs/e2e/sidebar-blank-close-all-confirm.png",
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(app.getByRole("tab")).toHaveCount(2);
  await rightClickBlankArea();
  await closeAll.click();
  await dialog.getByRole("button", { name: "Close 2 terminals", exact: true }).click();
  await expect(app.getByRole("tab")).toHaveCount(0);
  await expect(app.getByTestId("project-terminals-empty")).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(
        () => ((window as any).__PTY_CALLS__ ?? []).filter((c: any) => c.cmd === "pty_kill").length,
      ),
    )
    .toBe(2);
  await rightClickBlankArea();
  await expect(closeAll).toBeVisible();
  await expect(closeAll).toHaveAttribute("aria-disabled", "true");
});
