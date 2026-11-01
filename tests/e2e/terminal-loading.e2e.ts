import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (!location.protocol.startsWith("http")) {
      return;
    }
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
    const internal = (window as any).__TAURI_INTERNALS__;
    const invoke = internal.invoke;
    internal.metadata = {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    };
    (window as any).__startupSession = "";
    internal.invoke = (command: string, args: any) => {
      if (command === "pty_ensure") {
        (window as any).__startupSession = args.sessionId;
      }
      if (command === "pty_replay") {
        return Promise.resolve({ data: btoa("\x1b[2J\x1b[H"), historical: false });
      }
      return invoke(command, args);
    };
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible({ timeout: 30000 });
  await expect
    .poll(
      () =>
        browser.evaluate(async () => {
          const projects = await import(/* @vite-ignore */ "/src/projects/api.ts");
          return projects.getActiveProject()?.id ?? "";
        }),
      { timeout: 30000 },
    )
    .not.toBe("");
});

for (const agent of ["Pi", "Codex", "Cairngorm"] as const) {
  test(`${agent} startup shows only the owning project's rotating gem`, async ({
    app,
    browser,
    screen,
  }) => {
    await browser.evaluate(async (agent) => {
      const projects = await import(/* @vite-ignore */ "/src/projects/api.ts");
      const project = projects.getActiveProject()!;
      projects.setProjectBackground(project.id, "preset:citrine");
      projects.setProjectCut(project.id, "marquise");
      const tabs = await import(/* @vite-ignore */ "/src/terminal/state/tab-actions.ts");
      tabs.openTab({
        title: agent,
        shellPath: `${agent.toLowerCase()}.exe`,
        isAgent: agent === "Cairngorm",
        shellEnv: {},
      });
    }, agent);
    const loader = screen.getByRole("status", "Loading terminal");
    await expect(loader).toBeVisible();
    await expect(loader).toHaveText("");
    await expect(loader.getByRole("progressbar")).toHaveCount(0);
    const gem = browser.locator('[role="status"][aria-label="Loading terminal"] svg');
    await expect(gem).toHaveAttribute("style", /--gem:\s*#ffd166/);
    await expect(gem).toHaveAttribute("width", "96");
    // Check actual 3D geometry changes, not just the presence of a spinner class.
    const geometry = await browser.evaluate(() => {
      const svg = document.querySelector('[role="status"][aria-label="Loading terminal"] svg')!;
      return svg.innerHTML;
    });
    await expect
      .poll(() =>
        browser.evaluate(
          () =>
            document.querySelector('[role="status"][aria-label="Loading terminal"] svg')!.innerHTML,
        ),
      )
      .not.toBe(geometry);
    await app.screenshot(`terminal-loading-${agent.toLowerCase()}-citrine`);
    await browser.evaluate(async () => {
      const projects = await import(/* @vite-ignore */ "/src/projects/api.ts");
      projects.setProjectColor(projects.getActiveProject()!.id, "iris");
    });
    await expect(gem).toHaveAttribute("style", /--gem:\s*#8f95dd/);
    await expect.poll(() => browser.evaluate(() => (window as any).__startupSession)).not.toBe("");
    await browser.evaluate(async () => {
      const events = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
      await events.emit(`pty-data-${(window as any).__startupSession}`, {
        data: btoa("Ready for input\r\n"),
      });
    });
    await expect(loader).toHaveCount(0);
    await expect(browser.locator(".xterm-screen")).toContainText("Ready for input");
  });
}

test("translucent terminal loading never hides ready panes during optional agent setup", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate(async () => {
    const transparency = await import(/* @vite-ignore */ "/src/appearance/data/transparency.ts");
    transparency.setTransparency({
      enabled: true,
      material: "clear",
      priority: "global",
      overall: 35,
    });
    const tabs = await import(/* @vite-ignore */ "/src/terminal/state/tab-actions.ts");
    tabs.openTab({ title: "Existing terminal", shellPath: "agent.exe" });
  });
  const loader = screen.getByRole("status", "Loading terminal");
  await expect(loader).toBeVisible();
  expect(
    await browser.evaluate(
      () => getComputedStyle(document.querySelector(".xterm")!.parentElement!).opacity,
    ),
  ).toBe("0");
  await expect.poll(() => browser.evaluate(() => (window as any).__startupSession)).not.toBe("");
  await browser.evaluate(async () => {
    const events = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    await events.emit(`pty-data-${(window as any).__startupSession}`, {
      data: btoa("Existing output must remain usable during agent setup"),
    });
    const internal = (window as any).__TAURI_INTERNALS__;
    const invoke = internal.invoke;
    internal.invoke = (command: string, args: unknown) =>
      command === "resolve_agent_runner"
        ? new Promise((_resolve, reject) => {
            (window as any).__failRunner = () => reject(new Error("Runner unavailable"));
          })
        : invoke(command, args);
  });
  await expect(loader).toHaveCount(0);
  await expect(browser.locator(".xterm-screen")).toContainText(
    "Existing output must remain usable",
  );
  await browser.locator("body").press("Control+Shift+N");
  await expect
    .poll(() => browser.evaluate(() => typeof (window as any).__failRunner))
    .toBe("function");
  await expect(loader).toHaveCount(0);
  expect(
    await browser.evaluate(
      () => getComputedStyle(document.querySelector(".surface-grid")!).opacity,
    ),
  ).toBe("1");
  await expect(browser.locator(".xterm-screen")).toContainText(
    "Existing output must remain usable",
  );
  await app.screenshot("terminal-loading-translucent-usable-output");
  await browser.evaluate(() => (window as any).__failRunner());
  await expect(loader).toHaveCount(0);
  expect(
    await browser.evaluate(
      () => getComputedStyle(document.querySelector(".surface-grid")!).opacity,
    ),
  ).toBe("1");
  await expect(browser.locator(".xterm-screen")).toContainText(
    "Existing output must remain usable",
  );
});

test("an exit stops loading and a restarted session shows its own loader", async ({
  browser,
  screen,
}) => {
  await browser.evaluate(async () => {
    const tabs = await import(/* @vite-ignore */ "/src/terminal/state/tab-actions.ts");
    tabs.openTab({ title: "Restartable agent", shellPath: "agent.exe" });
  });
  const loader = screen.getByRole("status", "Loading terminal");
  await expect(loader).toBeVisible();
  await expect.poll(() => browser.evaluate(() => (window as any).__startupSession)).not.toBe("");
  const oldSession = await browser.evaluate(() => (window as any).__startupSession);
  await browser.evaluate(async () => {
    const events = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    await events.emit(`pty-exit-${(window as any).__startupSession}`, {});
  });
  await expect(loader).toHaveCount(0);
  await expect(browser.locator(".xterm-screen")).toContainText("Process exited");
  await browser.locator(".xterm-screen").tap();
  await expect(loader).toBeVisible();
  await expect
    .poll(() => browser.evaluate(() => (window as any).__startupSession))
    .not.toBe(oldSession);
  await browser.evaluate(async () => {
    const events = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    await events.emit(`pty-data-${(window as any).__startupSession}`, { data: btoa("Restarted") });
  });
  await expect(loader).toHaveCount(0);
  await expect(browser.locator(".xterm-screen")).toContainText("Restarted");
});

test("a failed terminal attachment removes the gem and reveals the error", async ({
  browser,
  screen,
}) => {
  await browser.evaluate(async () => {
    const internal = (window as any).__TAURI_INTERNALS__;
    const invoke = internal.invoke;
    internal.invoke = (command: string, args: unknown) =>
      command === "pty_ensure"
        ? Promise.reject("Agent executable not found")
        : invoke(command, args);
    const tabs = await import(/* @vite-ignore */ "/src/terminal/state/tab-actions.ts");
    tabs.openTab({ title: "Missing agent", shellPath: "missing-agent.exe" });
  });
  await expect(browser.locator(".xterm-screen")).toContainText("Agent executable not found");
  await expect(screen.getByRole("status", "Loading terminal")).toHaveCount(0);
});
