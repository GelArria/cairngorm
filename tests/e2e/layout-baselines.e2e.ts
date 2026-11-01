import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (!location.protocol.startsWith("http")) return;
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
    localStorage.setItem("gem-display", JSON.stringify({ frozen: true }));
    const internal = (window as any).__TAURI_INTERNALS__;
    const original = internal.invoke;
    internal.invoke = (cmd: string, args: unknown) => {
      if (cmd === "pty_replay") {
        return Promise.resolve({ data: btoa("Ready\r\n"), historical: false });
      }
      return cmd === "git_status"
        ? Promise.resolve({ files: [], error: null })
        : original(cmd, args);
    };
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible({ timeout: 30000 });
  await browser.evaluate(async () => {
    const appearance = await import(/* @vite-ignore */ "/src/appearance/data/store.ts");
    appearance.selectTheme("cairngorm");
    Date.now = () => 1760000000000;
    // No blinking cursor or entrance effects in pixel comparisons.
    const style = document.createElement("style");
    style.textContent =
      "*,*::before,*::after{animation:none!important;transition:none!important}.xterm-cursor-layer{visibility:hidden!important}";
    document.head.append(style);
    await document.fonts.ready;
  });
});

for (const layout of ["2x2", "stacked", "after-close"] as const) {
  test(
    `workspace pixel baseline: ${layout}`,
    {
      skip:
        process.platform !== "win32"
          ? "Reviewed pixel baselines are currently Windows-only"
          : false,
    },
    async ({ browser, screen }) => {
      await browser.evaluate(async (layout) => {
        const store = await import(/* @vite-ignore */ "/src/terminal/hooks/use-terminal-tabs.ts");
        const stacked = layout === "stacked";
        const count = stacked ? 3 : 4;
        store.attachGroup(
          Array.from({ length: count }, (_, i) => ({
            id: `baseline-${i}`,
            sessionId: `baseline-session-${i}`,
            title: `Terminal ${i + 1}`,
            shellPath: "powershell.exe",
            cwd: "C:/workspace",
          })),
          {
            columnCount: stacked ? 1 : 2,
            columnRatios: stacked ? [1] : [1, 1],
            cells: Array.from({ length: count }, (_, i) => ({
              id: `cell-${i}`,
              tabId: `baseline-${i}`,
              col: stacked ? 0 : i % 2,
              row: stacked ? i : Math.floor(i / 2),
              colSpan: 1,
              rowSpan: 1,
            })),
          },
        );
        if (layout === "after-close") {
          const actions = await import(/* @vite-ignore */ "/src/terminal/state/tab-actions.ts");
          actions.closeTab("baseline-3");
        }
      }, layout);
      await expect(browser.locator("[data-pane-id]")).toHaveCount(layout === "2x2" ? 4 : 3);
      await expect(screen.getByTestId("git-footer")).toContainText("main");
      await expect(screen.getByRole("status", "Loading terminal")).toHaveCount(0);
      // Startup is complete; these baselines intentionally compare empty pane geometry.
      await browser.evaluate(async () => {
        const registry = await import(/* @vite-ignore */ "/src/terminal/runtime/term-registry.ts");
        const store = await import(/* @vite-ignore */ "/src/terminal/hooks/use-terminal-tabs.ts");
        store.getTerminalTabs().forEach((tab) => registry.getTerm(tab.sessionId)?.reset());
      });
      // Keep app chrome, split borders and empty pane geometry in the comparison.
      await expect(screen).toHaveScreenshot(`workspace-${layout}.png`, {
        maxDiffPixels: 20,
        timeout: 15000,
        // Project IDs select a different gem yaw on each fresh profile; layout is the subject.
        mask: [browser.locator('[data-testid="active-project-card"] svg')],
      });
    },
  );
}
