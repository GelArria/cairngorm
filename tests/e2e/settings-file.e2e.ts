// cairngorm.json drives the "+" menu (extra shells and agent CLIs) and Settings shows where
// the file lives with a way to edit it.
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
    localStorage.setItem(
      "__mock_cairngorm_json",
      `// my settings
{
  "shells": { "add": [{ "name": "Node REPL", "path": "node", "args": ["-i"] }] },
  "agentClis": { "add": [{ "name": "My agent", "program": "my-agent", "args": ["--tui"] }] },
}`,
    );
  });
  await app.open();
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
});

test("cairngorm.json adds shells and agent CLIs to the new-tab menu", async ({ app, screen }) => {
  await screen.getByRole("button", "New terminal").first().tap();
  await expect(screen.getByText("Node REPL")).toBeVisible();
  await expect(screen.getByText("My agent")).toBeVisible();
  await app.screenshot("settings-file-menu");
});

test("Settings shows the settings file and opens it for editing", async ({
  app,
  browser,
  screen,
}) => {
  await browser.locator("body").press("Control+,");
  await screen.getByTestId("settings-dialog").getByRole("button", "General", { exact: true }).tap();
  await expect(screen.getByText("C:/mock/cairngorm.json")).toBeVisible();
  await app.screenshot("settings-file-section");
  await expect(screen.getByTestId("open-settings-file")).toBeEnabled();
});
