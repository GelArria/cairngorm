import { test, expect } from "./fixtures";

// Mouse-aware TUIs such as pi enable SGR mouse reporting; right-click must still
// open the pane menu and must not reach the program (pi pastes on right-click).
test("right-click over a mouse-tracking TUI opens the pane menu without reporting the click", async ({
  app,
}) => {
  await app.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    const api = (window as any).__TAURI_INTERNALS__;
    const original = api.invoke;
    api.invoke = (cmd: string, args: any) => {
      if (cmd === "pty_write") {
        ((window as any).__PTY_WRITES__ ??= []).push(args.data);
        return Promise.resolve();
      }
      return original(cmd, args);
    };
  });
  await app.reload();
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  await expect(app.locator(".xterm")).toBeVisible();
  await app.evaluate(async () => {
    const { getTerminalTab } = await import(
      /* @vite-ignore */ "/src/terminal/hooks/use-terminal-tabs.ts"
    );
    const { getTerm } = await import(/* @vite-ignore */ "/src/terminal/runtime/term-registry.ts");
    const term = getTerm(getTerminalTab().sessionId);
    await new Promise<void>((resolve) => term.write("\x1b[?1000h\x1b[?1006h\r\npi\r\n", resolve));
    (window as any).__PTY_WRITES__ = [];
  });

  const xterm = app.locator(".xterm").first();
  await xterm.click({ button: "right", position: { x: 120, y: 80 } });
  await expect(app.getByRole("menuitem", { name: "Paste" })).toBeVisible();
  await app.takeScreenshot("terminal-pane-menu-mouse-tui");
  await expect
    .poll(() => app.evaluate(() => document.activeElement?.className))
    .toContain("xterm-helper-textarea");
  const writes: string[] = await app.evaluate(() => (window as any).__PTY_WRITES__);
  expect(writes.filter((d) => d.startsWith("\x1b[<2;"))).toEqual([]);

  // Left clicks still belong to the TUI.
  await app.keyboard.press("Escape");
  await xterm.click({ position: { x: 120, y: 80 } });
  await expect
    .poll(() => app.evaluate(() => (window as any).__PTY_WRITES__.join("")))
    .toContain("\x1b[<0;");
});
