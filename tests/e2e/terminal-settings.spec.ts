import { test, expect } from "./fixtures";

const shells = [
  { name: "PowerShell", path: "pwsh.exe", args: ["-NoLogo"], env: {}, isDefault: true },
  {
    name: "Git Bash",
    path: "C:/Git/bin/bash.exe",
    args: ["--login"],
    env: { TERM: "xterm-256color" },
    isDefault: false,
  },
];

test.beforeEach(async ({ app }) => {
  await app.evaluate(() => localStorage.clear());
  await app.addInitScript((detected) => {
    localStorage.setItem("show-splash", "false");
    (window as any).__TAURI_HOME__ = "C:/repo";
    const api = (window as any).__TAURI_INTERNALS__;
    const original = api.invoke;
    api.invoke = (cmd: string, args: any) => {
      if (cmd === "plugin:sql|select" && /FROM\s+projects/i.test(args?.query ?? ""))
        return Promise.resolve([
          {
            id: "settings-qa",
            name: "Repo",
            root_path: "C:/repo",
            created_at: "2026-01-01 00:00:00",
          },
        ]);
      if (cmd === "detect_shells") return Promise.resolve(detected);
      if (cmd === "detect_home") return Promise.resolve("C:/repo");
      if (cmd === "pty_ensure") {
        ((window as any).__SHELL_STARTS__ ??= []).push(args);
        return Promise.resolve();
      }
      if (cmd === "pty_resize" || cmd === "pty_kill") return Promise.resolve();
      return original(cmd, args);
    };
  }, shells);
  await app.reload();
  await expect(app.locator('[data-testid="terminal-empty"]')).toBeVisible();
});

async function openSettings(app: import("@playwright/test").Page) {
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(app.locator('[data-testid="terminal-settings"]')).toBeVisible();
}

test("terminal preferences persist and the saved shell is used by default terminal creation", async ({
  app,
}) => {
  await openSettings(app);
  await app.getByLabel("Default shell", { exact: true }).click();
  await app.getByRole("menuitemradio", { name: "Git Bash", exact: true }).click();
  await app.getByRole("radio", { name: "Ctrl+Shift+C / V", exact: true }).click();
  await app.getByLabel("Scrollback lines", { exact: true }).fill("5000");
  await app.getByLabel("Scrollback lines", { exact: true }).press("Tab");
  await app.takeScreenshot("terminal-settings");
  await app.keyboard.press("Escape");
  await app.reload();
  await openSettings(app);
  await expect(app.getByLabel("Default shell", { exact: true })).toHaveText("Git Bash");
  await expect(app.getByRole("radio", { name: "Ctrl+Shift+C / V", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(app.getByLabel("Scrollback lines", { exact: true })).toHaveValue("5000");
  await app.setViewportSize({ width: 1024, height: 640 });
  await app.locator('[data-testid="terminal-settings"]').scrollIntoViewIfNeeded();
  await app.takeScreenshot("terminal-settings-compact");
  await app.keyboard.press("Escape");
  await app
    .locator('[data-testid="project-terminals"]')
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(() => (window as any).__SHELL_STARTS__?.length ?? 0))
    .toBe(1);
  expect(await app.evaluate(() => (window as any).__SHELL_STARTS__[0])).toMatchObject({
    shell: shells[1].path,
    args: shells[1].args,
    env: [["TERM", "xterm-256color"]],
    cwd: "C:/repo",
  });
});

test("scrollback clamps invalid limits and reset restores system defaults", async ({ app }) => {
  await openSettings(app);
  const input = app.getByLabel("Scrollback lines", { exact: true });
  await input.fill("1000000");
  await input.press("Tab");
  await expect(input).toHaveValue("100000");
  await input.fill("1");
  await input.press("Tab");
  await expect(input).toHaveValue("100");
  await app.getByRole("button", { name: "Reset terminal preferences", exact: true }).click();
  await expect(input).toHaveValue("3000");
  await expect(app.getByLabel("Default shell", { exact: true })).toHaveText("System default");
  await expect(app.getByRole("radio", { name: "Ctrl+C / Ctrl+V", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
