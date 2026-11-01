import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));

const scratch = process.env.CAIRNGORM_FRESH_HOME!;
const data = path.join(scratch, "AppData/Roaming/dev.cairngorm.fresh-profile");
const normalize = (s: string) => s.replace(/\\/g, "/").toLowerCase();

test("fresh native profile exposes file tools, asks consent, creates and opens a workbook", async ({
  app,
  browser,
  screen,
}) => {
  await app.open();
  await expect(screen.getByTestId("header-settings")).toBeVisible({ timeout: 30000 });
  expect(
    normalize(
      await browser.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("detect_home")),
    ),
  ).toBe(normalize(scratch));
  const config = await browser.evaluate(() =>
    (window as any).__TAURI_INTERNALS__.invoke("config_read"),
  );
  expect(normalize(config.path)).toContain(normalize(data));
  const onboarding = screen.getByRole("dialog", "Set up the Cairngorm agent");
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("button", "Close").tap();
  await screen.getByTestId("header-settings").tap();
  const settings = screen.getByTestId("settings-dialog");
  await settings.getByRole("button", "Plugins", { exact: true }).tap();
  await settings.getByRole("button", "Connect agents", { exact: true }).tap();
  const connectionConsent = screen.getByRole("dialog", "Connect plugins to your agents");
  await expect(connectionConsent).toBeVisible();
  await connectionConsent.getByRole("button", "Connect agents", { exact: true }).tap();
  await expect(settings.getByRole("button", "Check agent connections")).toBeVisible();
  await settings.getByRole("button", "Close", { exact: true }).tap();
  // Register an actual MCP client without borrowing any installed agent's credentials/config.
  const configPath = path.join(scratch, "client.json");
  fs.writeFileSync(configPath, "{}");
  const state = await browser.evaluate(async (configPath) => {
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    const state = await invoke("plugins_add_client", {
      name: "Fresh profile check",
      configPath,
      format: "json",
    });
    return invoke("plugins_set_client_connected", { id: state.clients[0].id, enabled: true });
  }, configPath);
  expect(state.filesAccess).toBe("ask");
  expect(state.clients[0].registered).toBe(true);
  await screen.getByRole("button", "New terminal", { exact: true }).first().tap();
  const shell = screen.getByRole("menuitem", /PowerShell|Default shell/i).first();
  await shell.tap();
  await expect(browser.locator("[data-pane-id]")).toHaveCount(1);
  const source = await browser.evaluate(() =>
    document.querySelector("[data-pane-id]")!.getAttribute("data-pane-id"),
  );
  const session = await browser.evaluate(async (id) => {
    const rows = await (window as any).__TAURI_INTERNALS__.invoke("plugin:sql|select", {
      db: "sqlite:panel.db",
      query: "SELECT value FROM terminal_state WHERE key = ?",
      values: ["cairngorm-terminal-workspace-v1"],
    });
    return JSON.parse(rows[0].value).state.tabs.find((t: any) => t.id === id).sessionId;
  }, source);
  const output = path.join(scratch, "created-result.json");
  const commandPath = path.join(scratch, "create-command.json");
  fs.writeFileSync(
    commandPath,
    JSON.stringify({
      bridge: path.join(data, "plugins/mcp-bridge.cjs"),
      client: state.clients[0].id,
      tool: "cairngorm_create_file",
      arguments: { path: path.join(scratch, "fresh-check.xlsx") },
      output,
    }),
  );
  const quote = (s: string) => "'" + s.replace(/'/g, "''") + "'";
  const command = `& ${quote(process.execPath)} ${quote(path.join(root, "tests/mocks/native-plugin-driver.cjs"))} ${quote(commandPath)}\r`;
  await browser.evaluate(
    async ({ session, command }) => {
      await (window as any).__TAURI_INTERNALS__.invoke("pty_write", {
        sessionId: session,
        data: command,
      });
    },
    { session, command },
  );
  const consent = screen.getByRole("dialog", "Let agents use files here?");
  await expect(consent).toBeVisible({ timeout: 30000 });
  await app.screenshot("fresh-file-consent");
  await consent.getByRole("button", "Allow for this terminal", { exact: true }).tap();
  await expect.poll(() => fs.existsSync(output), { timeout: 65000 }).toBe(true);
  const result = JSON.parse(fs.readFileSync(output, "utf8"));
  expect(result.error).toBeUndefined();
  expect(result.result?.isError).not.toBe(true);
  await expect(screen.getByRole("tab", "fresh-check.xlsx", { exact: true })).toBeVisible();
  expect(fs.readFileSync(path.join(scratch, "fresh-check.xlsx")).subarray(0, 2).toString()).toBe(
    "PK",
  );
  const sheet = browser
    .frameLocator('[data-testid="document-provider-frame"]')
    .frameLocator("#provider");
  await expect(sheet.getByLabel("Cell address")).toHaveValue("A1", { timeout: 30000 });
  await expect(sheet.getByText("All changes saved")).toBeVisible();
  await app.screenshot("fresh-workbook-open");
  fs.writeFileSync(
    path.join(scratch, "acceptance.json"),
    JSON.stringify({
      native: true,
      freshProfile: true,
      consentShown: true,
      mcpInitializedAndListed: true,
      workbookCreatedAndOpened: true,
    }),
  );
});
