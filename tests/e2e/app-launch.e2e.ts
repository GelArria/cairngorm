// The "+" menu lists installed applications; choosing one shows its window in a pane beside
// the active terminal, without any agent involved.
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
    w.__launchCalls = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      w.__launchCalls.push({ command, args });
      if (command === "apps_list") {
        return [
          {
            id: "excel",
            name: "Microsoft Excel",
            progId: "Excel.Application",
            executable: "EXCEL.EXE",
          },
          {
            id: "word",
            name: "Microsoft Word",
            progId: "Word.Application",
            executable: "WINWORD.EXE",
          },
        ];
      }
      if (command === "app_window_open") {
        return { hwnd: "777", title: "Book1 - Excel" };
      }
      if (command === "app_window_dock") {
        return true;
      }
      if (command === "app_window_release") {
        return;
      }
      return invoke(command, args);
    };
  });
  await app.open();
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
});

test("an installed application opens in a pane from the new-tab menu", async ({
  app,
  browser,
  screen,
}) => {
  const newTab = screen.getByRole("tablist", "Workspace tabs").getByRole("button", "New terminal");
  await newTab.tap();
  await expect(screen.getByText("Applications")).toBeVisible();
  await app.screenshot("app-launch-menu");
  await screen.getByTestId("app-launch-excel").tap();
  await expect(screen.getByTestId("app-window-pane")).toBeVisible();
  await expect(screen.getByTestId("app-window-pane")).toContainText("Microsoft Excel");
  // A second click reuses the pane: the application is not launched again.
  await newTab.tap();
  await screen.getByTestId("app-launch-excel").tap();
  await expect(screen.getByTestId("app-window-pane")).toHaveCount(1);
  expect(
    await browser.evaluate(() =>
      (window as any).__launchCalls
        .filter((call: any) => call.command === "app_window_open")
        .map((call: any) => call.args),
    ),
  ).toEqual([{ appId: "excel" }]);
});
