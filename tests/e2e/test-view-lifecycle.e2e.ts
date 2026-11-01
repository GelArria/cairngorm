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
    localStorage.setItem("active-project-id", "tests-a");
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__testCalls = [];
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      w.__testCalls.push({ cmd, args });
      if (cmd === "plugin:sql|select" && /FROM\s+projects\b/i.test(args.query)) {
        return Promise.resolve(
          ["a", "b"].map((id) => ({
            id: `tests-${id}`,
            name: `Tests ${id.toUpperCase()}`,
            root_path: `C:/tests-${id}`,
            color: null,
            background: null,
            gem_cut: null,
            created_at: "2026-10-20 00:00:00",
          })),
        );
      }
      return original(cmd, args);
    };
  });
  await app.open();
  await expect(screen.getByTestId("active-project-name")).toHaveText("Tests A");
});

test("hidden Tests keep receiving results and restore a paused page after a project remount", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect
    .poll(() =>
      browser.evaluate(() =>
        (window as any).__testCalls.some((call: any) => call.cmd === "pty_ensure"),
      ),
    )
    .toBe(true);
  await browser.evaluate(async () => {
    const w = window as any;
    const session = w.__testCalls.find((call: any) => call.cmd === "pty_ensure").args.sessionId;
    w.__testSession = session;
    const observer = await import(/* @vite-ignore */ "/tests/mocks/pty-test-observer.ts");
    await observer.output(
      session,
      "Running 2 tests using 1 worker\n ✘ 1 failing first example (1s)\n",
    );
  });
  const pane = screen.getByTestId("test-pane");
  const workspaceTabs = screen.getByRole("tablist", "Workspace tabs");
  await expect(pane).toBeVisible();
  await pane.getByRole("button", "Failed only").tap();
  await pane.getByLabel("Filter tests").fill("failing");
  await browser.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#f5f5f5";
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = "#161616";
    context.font = "28px sans-serif";
    context.fillText("Retained test frame", 60, 150);
    const image = canvas.toDataURL("image/jpeg").split(",")[1];
    const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    for (const [index, title] of ["Pinned page", "Newest page"].entries()) {
      await emit(`test-browser-${(window as any).__testSession}`, {
        type: "frame",
        pageId: `page-${index}`,
        title,
        timestamp: index + 1,
        image,
        width: 640,
        height: 360,
        browserName: "chromium",
      });
    }
  });
  await pane.getByRole("tab", "Chromium · Pinned page").tap();
  await pane.getByRole("button", "Pause", { exact: true }).tap();
  await expect(pane.getByTestId("test-browser-status")).toHaveText("Paused");
  const original = await browser.evaluate(() => {
    const element = document.querySelector('[data-testid="test-pane"]')!;
    (window as any).__originalTestPane = element;
    return {
      id: element.closest("[data-pane-id]")!.getAttribute("data-pane-id"),
      image: element.querySelector("img")!.getAttribute("src"),
    };
  });
  await screen.getByTestId("header-test-auto-open").tap();
  await screen.getByRole("menuitem", "Hide open test views").tap();
  await expect(pane).toBeHidden();
  await expect(workspaceTabs.getByRole("tab")).toHaveCount(1);
  await browser.evaluate(async () => {
    const observer = await import(/* @vite-ignore */ "/tests/mocks/pty-test-observer.ts");
    await observer.output(
      (window as any).__testSession,
      " ✘ 2 failing while hidden (1s)\n2 failed\n",
    );
  });
  await expect(pane).toBeHidden();
  await screen.getByTestId("sidebar-project-picker").tap();
  await screen.getByTestId("project-box-tests-b").tap();
  await expect(pane).toHaveCount(0);
  await screen.getByTestId("header-test-auto-open").tap();
  await screen.getByRole("menuitem", "Show hidden test views").tap();
  await expect(screen.getByTestId("active-project-name")).toHaveText("Tests B");
  await expect(workspaceTabs.getByRole("tab")).toHaveCount(0);
  await screen.getByTestId("sidebar-project-picker").tap();
  await screen.getByTestId("project-box-tests-a").tap();
  await workspaceTabs.getByRole("tab", /^Tests ·/).tap();
  await expect(pane.getByRole("tab", "Chromium · Pinned page")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(pane.getByRole("button", "Resume", { exact: true })).toBeVisible();
  await expect(pane.getByTestId("test-browser-screen")).toHaveAttribute("src", original.image!);
  expect(
    await browser.evaluate(
      () =>
        document.querySelector('[data-testid="test-pane"]') !== (window as any).__originalTestPane,
    ),
  ).toBe(true);
  expect(
    await browser.evaluate(() =>
      document
        .querySelector('[data-testid="test-pane"]')!
        .closest("[data-pane-id]")!
        .getAttribute("data-pane-id"),
    ),
  ).toBe(original.id);
  await app.screenshot("tests-paused-page-after-project-remount");
  await pane.getByRole("button", "Results", { exact: true }).tap();
  await expect(pane.getByLabel("Filter tests")).toHaveValue("failing");
  await expect(pane.getByRole("button", "Failed only")).toHaveAttribute("aria-pressed", "true");
  await expect(pane.getByText("failing while hidden", { exact: false })).toBeVisible();
  await app.screenshot("tests-background-results-after-project-remount");
  expect(
    await browser.evaluate(
      () => (window as any).__testCalls.filter((call: any) => call.cmd === "pty_kill").length,
    ),
  ).toBe(0);
  await screen.getByTestId("header-test-auto-open").tap();
  await screen.getByRole("menuitem", "Hide open test views").tap();
  await workspaceTabs.getByRole("button", "Close tab", { exact: true }).tap();
  await expect(pane).toHaveCount(0);
  await expect
    .poll(() =>
      browser.evaluate(async () => {
        const { getTestRun } = await import(/* @vite-ignore */ "/src/testing/data/test-store.ts");
        return !!getTestRun((window as any).__testSession);
      }),
    )
    .toBe(false);
  expect(
    await browser.evaluate(() =>
      (window as any).__testCalls
        .filter((call: any) => call.cmd === "pty_kill")
        .map((call: any) => call.args.sessionId),
    ),
  ).toEqual([await browser.evaluate(() => (window as any).__testSession)]);
});
