import { test, expect } from "./fixtures";

test("open terminals update renderer colors without restarting the PTY or losing scrollback", async ({
  app,
}) => {
  await app.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    const api = (window as any).__TAURI_INTERNALS__;
    const original = api.invoke;
    api.invoke = (cmd: string, args: unknown) => {
      if (cmd === "pty_ensure") {
        (window as any).__APPEARANCE_PTY_STARTS__ =
          ((window as any).__APPEARANCE_PTY_STARTS__ ?? 0) + 1;
        return Promise.resolve();
      }
      if (cmd === "pty_resize" || cmd === "pty_kill") return Promise.resolve();
      return original(cmd, args);
    };
  });
  await app.reload();
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  await expect(app.locator(".xterm")).toBeVisible();
  await expect.poll(() => app.evaluate(() => (window as any).__APPEARANCE_PTY_STARTS__)).toBe(1);
  await app.evaluate(async () => {
    const tabsPath = "/src/terminal/hooks/use-terminal-tabs.ts",
      termsPath = "/src/terminal/runtime/term-registry.ts";
    const { getTerminalTab } = await import(/* @vite-ignore */ tabsPath);
    const { getTerm } = await import(/* @vite-ignore */ termsPath);
    const tab = getTerminalTab();
    const term = getTerm(tab.sessionId);
    (window as any).__APPEARANCE_TERM__ = { term, sessionId: tab.sessionId };
    await new Promise<void>((resolve) =>
      term.write(
        "\r\nPreserved scrollback\r\n\x1b[37mANSI white\x1b[0m\r\n\x1b[97mANSI bright white\x1b[0m\r\n",
        resolve,
      ),
    );
  });
  await app.getByTestId("header-settings").click();
  await app.getByRole("button", { name: "Themes & colors", exact: true }).click();
  for (const [id, background, foreground] of [
    ["white", "#ffffff", "#18181b"],
    ["nord", "#242b36", "#eceff4"],
    ["paper", "#faf7f1", "#302b24"],
  ]) {
    await app.getByTestId(`theme-${id}`).click();
    expect(
      await app.evaluate(async () => {
        const path = "/src/terminal/runtime/term-registry.ts";
        const { getTerm } = await import(/* @vite-ignore */ path);
        const { term, sessionId } = (window as any).__APPEARANCE_TERM__;
        const buffer = term.buffer.active;
        return {
          same: term === getTerm(sessionId),
          starts: (window as any).__APPEARANCE_PTY_STARTS__,
          background: term.options.theme.background,
          foreground: term.options.theme.foreground,
          white: term.options.theme.white,
          brightWhite: term.options.theme.brightWhite,
          text: Array.from({ length: buffer.length }, (_, i) =>
            buffer.getLine(i)?.translateToString(),
          ).join("\n"),
        };
      }),
    ).toMatchObject({
      same: true,
      starts: 1,
      background,
      foreground,
      white: foreground,
      brightWhite: id === "nord" ? "#ffffff" : foreground,
      text: expect.stringContaining("ANSI bright white"),
    });
  }
  await app.keyboard.press("Escape");
  await expect(app.locator(".xterm")).toHaveCSS("background-color", "rgb(250, 247, 241)");
  await app.takeScreenshot("appearance-paper-terminal");
});
