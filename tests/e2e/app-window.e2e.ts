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
    const w = window as any;
    w.__TAURI_INTERNALS__.metadata = {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__appWindows = { alive: true, hwnd: "101", calls: [], scopes: [] };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      const state = w.__appWindows;
      state.calls.push({ command, args });
      if (command === "plugins_sync_workspace") {
        state.scopes = args.terminals;
        return;
      }
      if (command === "app_window_dock") {
        return state.alive;
      }
      if (command === "app_window_release") {
        return;
      }
      if (command === "app_window_open") {
        if (state.openError) {
          throw new Error(state.openError);
        }
        state.alive = true;
        state.hwnd = "202";
        return { hwnd: state.hwnd, title: "Microsoft Excel" };
      }
      return invoke(command, args);
    };
  });
  await app.open();
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect
    .poll(() => browser.evaluate(() => (window as any).__appWindows.scopes.length))
    .toBe(1);
  await browser.evaluate(async () => {
    const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    await emit("app-window-open", {
      terminal: (window as any).__appWindows.scopes[0].sessionId,
      app: "excel",
      name: "Microsoft Excel",
      hwnd: "101",
      title: "Budget — Excel",
    });
  });
  await expect(screen.getByTestId("app-window-pane")).toBeVisible();
});

test("a closed application is detected without resizing and can be reopened", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate(() => {
    (window as any).__appWindows.alive = false;
  });
  await expect(screen.getByRole("status")).toHaveText("Microsoft Excel was closed.");
  await app.screenshot("app-window-closed");
  await browser.setViewport({ width: 600, height: 780 });
  await expect(screen.getByRole("button", "Reopen Microsoft Excel")).toBeVisible();
  await app.screenshot("app-window-closed-narrow");
  await screen.getByRole("button", "Reopen Microsoft Excel").tap();
  await expect(screen.getByRole("button", "Open as window")).toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(
        () =>
          (window as any).__appWindows.calls
            .filter((call: any) => call.command === "app_window_dock")
            .at(-1)?.args.hwnd,
      ),
    )
    .toBe("202");
  await expect(screen.getByTestId("app-window-pane")).toHaveCount(1);
});

test("release and reattach use different leases and dialogs hide the native overlay", async ({
  browser,
  screen,
}) => {
  await screen.getByRole("button", "Open as window").tap();
  await expect(screen.getByRole("status")).toHaveText("Microsoft Excel is open in its own window.");
  await screen.getByRole("button", "Show it here").tap();
  await expect(screen.getByRole("button", "Open as window")).toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(() => {
        const calls = (window as any).__appWindows.calls;
        const released = calls.find((call: any) => call.command === "app_window_release");
        const docked = calls.filter((call: any) => call.command === "app_window_dock").at(-1);
        return released?.args.dockId !== docked?.args.dockId && released !== undefined;
      }),
    )
    .toBe(true);
  await browser.locator("body").press("Control+,");
  await expect(screen.getByTestId("settings-dialog")).toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(
        () =>
          (window as any).__appWindows.calls
            .filter((call: any) => call.command === "app_window_dock")
            .at(-1)?.args.visible,
      ),
    )
    .toBe(false);
  await browser.keyboard.press("Escape");
  await expect(screen.getByTestId("settings-dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      browser.evaluate(
        () =>
          (window as any).__appWindows.calls
            .filter((call: any) => call.command === "app_window_dock")
            .at(-1)?.args.visible,
      ),
    )
    .toBe(true);
});

test("automation retargets the existing pane to revision B and back to A", async ({
  app,
  browser,
  screen,
}) => {
  for (const revision of [
    { hwnd: "202", title: "Revision-B.xlsx — Excel" },
    { hwnd: "101", title: "Revision-A.xlsx — Excel" },
  ]) {
    await browser.evaluate(async (revision) => {
      const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
      await emit("app-window-open", {
        terminal: (window as any).__appWindows.scopes[0].sessionId,
        app: "excel",
        name: "Microsoft Excel",
        ...revision,
      });
    }, revision);
    await expect(screen.getByTestId("app-window-pane")).toHaveCount(1);
    await expect(screen.getByRole("tab", revision.title, { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        browser.evaluate(
          () =>
            (window as any).__appWindows.calls
              .filter((call: any) => call.command === "app_window_dock")
              .at(-1)?.args.hwnd,
        ),
      )
      .toBe(revision.hwnd);
    const commands = await browser.evaluate(() =>
      (window as any).__appWindows.calls
        .filter((call: any) => ["app_window_dock", "app_window_release"].includes(call.command))
        .map((call: any) => ({ command: call.command, hwnd: call.args.hwnd })),
    );
    const attached = commands.findIndex(
      (call: { command: string; hwnd: string }) =>
        call.command === "app_window_dock" && call.hwnd === "202",
    );
    const released = commands.findIndex(
      (call: { command: string; hwnd: string }) =>
        call.command === "app_window_release" && call.hwnd === "101",
    );
    expect(released).toBeGreaterThanOrEqual(0);
    expect(attached).toBeGreaterThan(released);
    if (revision.hwnd === "202") {
      await app.screenshot("app-window-revision-b");
    }
  }
});

test("switching projects hides the embedded app without releasing it and restores it on return", async ({
  app,
  browser,
  screen,
}) => {
  await expect
    .poll(() =>
      browser.evaluate(
        () =>
          (window as any).__appWindows.calls
            .filter((call: any) => call.command === "app_window_dock")
            .at(-1)?.args.visible,
      ),
    )
    .toBe(true);
  const original = await browser.evaluate(async () => {
    const projects = await import(/* @vite-ignore */ "/src/projects/api.ts");
    const original = projects.getProjectsState().activeId;
    (window as any).__appWindows.calls = [];
    projects.createProject("C:/SecondProject", "Second project");
    return original;
  });
  await expect(screen.getByTestId("app-window-pane")).not.toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(
        () =>
          (window as any).__appWindows.calls
            .filter((call: any) => call.command === "app_window_dock")
            .at(-1)?.args.visible,
      ),
    )
    .toBe(false);
  expect(
    await browser.evaluate(
      () =>
        (window as any).__appWindows.calls.filter(
          (call: any) => call.command === "app_window_release",
        ).length,
    ),
  ).toBe(0);
  await app.screenshot("app-window-other-project-hidden");
  await browser.evaluate(async (id) => {
    const projects = await import(/* @vite-ignore */ "/src/projects/api.ts");
    projects.switchProject(id);
  }, original);
  await screen.getByRole("tab", "Budget — Excel", { exact: true }).tap();
  await expect(screen.getByTestId("app-window-pane")).toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(
        () =>
          (window as any).__appWindows.calls
            .filter((call: any) => call.command === "app_window_dock")
            .at(-1)?.args.visible,
      ),
    )
    .toBe(true);
  const windows = await browser.evaluate(() =>
    (window as any).__appWindows.calls
      .filter((call: any) => call.command === "app_window_dock")
      .map((call: any) => ({ hwnd: call.args.hwnd, dockId: call.args.dockId })),
  );
  expect(new Set(windows.map((window: { dockId: string }) => window.dockId)).size).toBe(1);
  expect(windows.every((window: { hwnd: string }) => window.hwnd === "101")).toBe(true);
  await app.screenshot("app-window-original-project-restored");
});

test("failed reopening shows actionable guidance and leaves retry available", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate(() => {
    (window as any).__appWindows.alive = false;
    (window as any).__appWindows.openError =
      "Close any welcome or sign-in dialog in Microsoft Excel, then try again.";
  });
  await expect(screen.getByRole("status")).toHaveText("Microsoft Excel was closed.");
  await screen.getByRole("button", "Reopen Microsoft Excel").tap();
  await expect(screen.getByRole("alert")).toContainText("welcome or sign-in dialog");
  await expect(screen.getByRole("button", "Reopen Microsoft Excel")).toBeEnabled();
  await app.screenshot("app-window-reopen-guidance");
});
