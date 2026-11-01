import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

for (const background of [false, true]) {
  test(`restores a ${background ? "background" : "visible"} full-screen TUI after switching projects`, async ({
    app,
    browser,
    screen,
  }) => {
    await browser.addInitScript(SEED_INIT);
    await browser.addInitScript(() => {
      if (location.protocol.startsWith("http")) {
        localStorage.setItem("show-splash", "false");
      }
    });
    await app.open();
    await expect(screen.getByTestId("terminal-empty")).toBeVisible();
    await screen.getByRole("button", "New terminal", { exact: true }).first().tap();
    await screen.getByRole("menuitem", "Default shell", { exact: true }).tap();
    await expect(browser.locator(".xterm-rows")).toBeVisible();
    if (background) {
      await screen.getByRole("button", "New terminal", { exact: true }).first().tap();
      await screen.getByRole("menuitem", "Default shell", { exact: true }).tap();
      await expect(browser.locator(".xterm-rows").last()).toBeVisible();
    }
    await browser.evaluate(async () => {
      const registryUrl = "/src/terminal/runtime/term-registry.ts";
      const workspaceUrl = "/src/terminal/hooks/use-terminal-tabs.ts";
      const registry = await import(/* @vite-ignore */ registryUrl);
      const workspace = await import(/* @vite-ignore */ workspaceUrl);
      const term = registry.getTerm(workspace.getTerminalTab().sessionId);
      const size = { cols: term.cols, rows: term.rows };
      const raw =
        "\x1b[?1049h\x1b[48;2;24;22;36m\x1b[38;2;211;208;227m\x1b[2J" +
        Array.from({ length: term.rows }, (_, row) => {
          const label = row === 0 ? "TUI replay regression fixture" : `Render line ${row + 1}`;
          const line = `${String(row + 1).padStart(2, "0")}: ${label}`.padEnd(term.cols - 1) + "|";
          return `\x1b[${row + 1};1H${line}`;
        }).join("");
      const w = window as typeof window & {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
      };
      const invoke = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (cmd, args) =>
        cmd === "pty_replay"
          ? Promise.resolve({
              data: btoa(raw),
              historical: true,
              size,
            })
          : invoke(cmd, args);
      await new Promise<void>((resolve) => term.write(raw, resolve));
    });
    const snapshot = () =>
      browser.evaluate(async () => {
        const registryUrl = "/src/terminal/runtime/term-registry.ts";
        const workspaceUrl = "/src/terminal/hooks/use-terminal-tabs.ts";
        const registry = await import(/* @vite-ignore */ registryUrl);
        const workspace = await import(/* @vite-ignore */ workspaceUrl);
        const term = registry.getTerm(workspace.getTerminalTab().sessionId);
        return {
          cols: term.cols,
          rows: term.rows,
          lines: Array.from({ length: term.rows }, (_, row) =>
            term.buffer.active.getLine(row)?.translateToString(),
          ),
        };
      });
    const before = await snapshot();
    const projects = await browser.evaluate(async () => {
      const url = "/src/projects/api.ts";
      const projects = await import(/* @vite-ignore */ url);
      const previous = projects.getProjectsState().activeId;
      const other = projects.createProject("", "TUI restore QA").id;
      return { previous, other };
    });
    for (let cycle = 0; cycle < 3; cycle++) {
      if (cycle > 0) {
        await browser.evaluate(async (id) => {
          const url = "/src/projects/api.ts";
          (await import(/* @vite-ignore */ url)).switchProject(id);
        }, projects.other);
      }
      await expect(browser.locator(".xterm")).toHaveCount(0);
      await browser.evaluate(async (previous) => {
        const url = "/src/projects/api.ts";
        (await import(/* @vite-ignore */ url)).switchProject(previous);
      }, projects.previous);
      if (background) {
        await expect(browser.locator(".xterm")).toHaveCount(2);
        await expect(browser.locator(".xterm-rows").first()).toBeVisible();
        await browser.evaluate(async () => {
          const registryUrl = "/src/terminal/runtime/term-registry.ts";
          const workspaceUrl = "/src/terminal/hooks/use-terminal-tabs.ts";
          const registry = await import(/* @vite-ignore */ registryUrl);
          const workspace = await import(/* @vite-ignore */ workspaceUrl);
          const term = registry.getTerm(workspace.getTerminalTabs()[1].sessionId);
          await new Promise<void>((resolve) => term.write("", resolve));
        });
        await screen.getByRole("tablist", "Workspace tabs").getByRole("tab").last().tap();
      }
      await expect(browser.locator(".xterm-rows").nth(background ? 1 : 0)).toBeVisible();
      await expect.poll(snapshot).toEqual(before);
    }
    await app.screenshot(`terminal-workspace-restored-${background ? "background" : "visible"}`);
  });
}
