import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readFileSync } from "node:fs";
import { SEED_INIT } from "../mocks/tauri-seed";

const applications = JSON.parse(
  readFileSync(
    new URL("../../src/plugins/assets/application-catalog.json", import.meta.url),
    "utf8",
  ),
);
beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (!location.protocol.startsWith("http")) return;
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
});

// Word is driven through COM, PhotoCraft through its own MCP server, LibreOffice Calc is
// installed without an automation API, and everything else is missing.
const DRIVERS: Record<string, "com" | "mcp" | null> = {
  "microsoft-word": "com",
  photocraft: "mcp",
  "libreoffice-calc": null,
};

test("shows every local app as ready, without automation, or not found — never as something to add", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate(
    ({ entries, drivers }) => {
      const w = window as any;
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
        if (cmd === "plugins_state")
          return Promise.resolve({
            plugins: entries.map((entry: any) => {
              const driver = drivers[entry.id] ?? null;
              return {
                ...entry,
                auth: "none",
                enabled: false,
                signedIn: false,
                availability: {
                  installed: entry.id in drivers,
                  canEdit: driver !== null,
                  connected: driver !== null,
                  driver,
                  message: driver ? "Installed." : "Not found on this computer.",
                },
              };
            }),
            agents: [],
            clients: [],
            discoveredClients: [],
            runtime: "node",
            agentsConnected: false,
            error: null,
          });
        return original(cmd, args);
      };
    },
    { entries: applications, drivers: DRIVERS },
  );
  await browser.locator("body").press("Control+,");
  const dialog = screen.getByTestId("settings-dialog");
  await dialog.getByRole("button", "Plugins", { exact: true }).tap();
  for (const application of applications) {
    await expect(screen.getByTestId(`plugin-card-${application.id}`)).toBeAttached();
  }
  const word = screen.getByTestId("plugin-card-microsoft-word");
  await expect(word).toContainText("Ready");
  await expect(word).toContainText("Agents use its automation API");
  await expect(word.getByRole("button", "Add Microsoft Word")).toHaveCount(0);
  const photocraft = screen.getByTestId("plugin-card-photocraft");
  await expect(photocraft).toContainText("Ready");
  await expect(photocraft).toContainText("Agents use its own MCP server");
  const calc = screen.getByTestId("plugin-card-libreoffice-calc");
  await expect(calc).toContainText("No automation");
  await expect(screen.getByTestId("plugin-card-vectorcraft")).toContainText("Not found");
  for (const application of applications) {
    const card = screen.getByTestId(`plugin-card-${application.id}`);
    await expect(card.getByRole("button", `Add ${application.name}`)).toHaveCount(0);
  }
  await app.screenshot("application-catalog-office-and-craft");
  await screen.getByRole("searchbox", "Search plugins").fill("Craft");
  await expect(browser.locator('[data-testid^="plugin-card-"]')).toHaveCount(13);
  await browser.setViewport({ width: 420, height: 780 });
  await expect
    .poll(() =>
      browser.evaluate(() => {
        const settings = document.querySelector<HTMLElement>('[data-testid="plugin-settings"]')!;
        return settings.scrollWidth <= settings.clientWidth + 1;
      }),
    )
    .toBe(true);
  await app.screenshot("application-catalog-narrow");
});

test("Claude verification remains blocked until exact API billing acknowledgement", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__claudeConnections = [];
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      if (cmd === "detect_ai_services")
        return Promise.resolve({
          setupComplete: true,
          commitProvider: null,
          claudeApiConsentGranted: false,
          services: [
            {
              id: "claude",
              name: "Claude Code",
              cliPath: "C:/CLI Tools/claude.exe",
              homePath: "C:/fixtures/.claude",
              runtime: { binaryPath: "", homePath: "" },
              localSetup: true,
              status: "session-detected",
              authKind: "api-or-custom",
              message: "API key found; verification incurs API charges.",
            },
          ],
        });
      if (cmd === "get_agent_config")
        return Promise.resolve({
          provider: "openai",
          model: "fixture",
          apiKeyEnv: "OPENAI_API_KEY",
          keySource: "none",
        });
      if (cmd === "read_ai_usage") return Promise.resolve([]);
      if (cmd === "connect_ai_service") {
        w.__claudeConnections.push(args);
        return Promise.resolve();
      }
      return original(cmd, args);
    };
  });
  await browser.locator("body").press("Control+,");
  await screen
    .getByTestId("settings-dialog")
    .getByRole("button", "AI providers", { exact: true })
    .tap();
  const consent = screen.getByRole("dialog", "Claude Code uses paid API billing");
  await expect(consent).toBeVisible();
  const confirm = consent.getByRole("button", "Verify & enable API billing");
  await expect(confirm).toBeDisabled();
  await consent.getByLabel("Type I understand to authorize API billing").fill("i understand");
  await expect(confirm).toBeDisabled();
  expect(await browser.evaluate(() => (window as any).__claudeConnections)).toEqual([]);
  await consent.getByLabel("Type I understand to authorize API billing").fill("I understand");
  await expect(confirm).toBeEnabled();
  await app.screenshot("claude-api-typed-consent");
  await confirm.tap();
  await expect(screen.getByText("In use by Cairngorm", { exact: true })).toBeVisible();
  expect(await browser.evaluate(() => (window as any).__claudeConnections)).toEqual([
    { id: "claude", acknowledgement: "I understand" },
  ]);
});
