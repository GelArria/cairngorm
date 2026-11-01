import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (location.protocol.startsWith("http")) {
      localStorage.setItem("show-splash", "false");
      localStorage.setItem("sidebar-side", "left");
    }
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await browser.evaluate(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    const state = {
      plugins: ["tldraw", "drawio"].map((id) => ({
        id,
        name: id,
        description: "Interactive diagrams",
        category: "Creativity",
        logo: `/plugins/${id}.svg`,
        homepage: "https://example.com",
        terms: "https://example.com/terms",
        auth: "none",
        enabled: false,
        signedIn: false,
      })),
      agents: [
        {
          id: "example",
          name: "Example CLI",
          configPath: "/home/me/agent/config.json",
          registered: false,
          lastSeen: null,
        },
        {
          id: "other",
          name: "Another CLI",
          configPath: "/home/me/other/config.json",
          registered: false,
          lastSeen: null,
        },
      ],
      runtime: "node",
      agentsConnected: false,
      error: null,
      bridgeConfig: {
        mcpServers: { cairngorm: { command: "node", args: ["/app/plugins/mcp-bridge.cjs"] } },
      },
    };
    w.__pluginTest = { state, commands: [], failConnection: false };
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (!cmd.startsWith("plugins_")) {
        return original(cmd, args);
      }
      w.__pluginTest.commands.push(cmd);
      if (cmd === "plugins_connect_agents") {
        if (w.__pluginTest.failConnection) {
          throw new Error("Could not connect agents");
        }
        state.agentsConnected = true;
        state.agents.forEach((agent) => (agent.registered = true));
      }
      if (cmd === "plugins_set_enabled") {
        state.plugins.find((p) => p.id === args.id)!.enabled = args.enabled;
      }
      return structuredClone(state);
    };
  });
  await browser.locator("body").press("Control+,");
  await screen.getByTestId("settings-dialog").getByRole("button", "Plugins", { exact: true }).tap();
});

test("one approval connects agents and every later plugin shares the bridge", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByRole("button", "Add tldraw").tap();
  const consent = screen.getByRole("dialog", "Connect plugins to your agents");
  await expect(consent).toBeVisible();
  await app.screenshot("plugin-connection-consent");
  expect(
    await browser.evaluate(() =>
      (window as any).__pluginTest.commands.filter((cmd: string) => cmd !== "plugins_state"),
    ),
  ).toEqual([]);
  await consent.getByRole("button", "Cancel").tap();
  await expect(consent).toHaveCount(0);
  await expect(screen.getByRole("button", "Add tldraw")).toBeVisible();

  await screen.getByRole("button", "Add tldraw").tap();
  await consent.getByRole("button", "Connect agents").tap();
  await expect(screen.getByTestId("plugin-card-tldraw")).toContainText("Added");
  await expect(screen.getByTestId("plugin-agent-example")).toContainText("Restart required");
  await expect(screen.getByTestId("plugin-agent-example")).not.toContainText("Connected");
  await screen.getByRole("button", "Add drawio").tap();
  await expect(screen.getByTestId("plugin-card-drawio")).toContainText("Added");
  await expect(consent).toHaveCount(0);
  expect(
    await browser.evaluate(
      () =>
        (window as any).__pluginTest.commands.filter(
          (cmd: string) => cmd === "plugins_connect_agents",
        ).length,
    ),
  ).toBe(1);

  await browser.evaluate(() => {
    (window as any).__pluginTest.state.agents[0].lastSeen = 12;
  });
  // Reopening Settings refreshes native state; no timer or assumed connection is needed.
  await browser.locator("body").press("Escape");
  await browser.locator("body").press("Control+,");
  await screen.getByTestId("settings-dialog").getByRole("button", "Plugins", { exact: true }).tap();
  await expect(screen.getByTestId("plugin-agent-example")).toContainText("Connected");
  await expect(screen.getByTestId("plugin-agent-other")).toContainText("Restart required");
  await app.screenshot("plugin-connection-status");
  await screen.getByText("Other MCP clients", { exact: true }).tap();
  await expect(screen.getByTestId("plugin-settings")).toContainText("mcp-bridge.cjs");
});

test("the first connection stays usable in a narrow window", async ({ app, browser, screen }) => {
  await browser.setViewport({ width: 420, height: 780 });
  await expect.poll(() => browser.evaluate(() => window.innerWidth)).toBe(420);
  await screen.getByRole("button", "Add tldraw").tap();
  const consent = screen.getByRole("dialog", "Connect plugins to your agents");
  await expect(consent.getByRole("button", "Connect agents")).toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(() => {
        const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
        const button = [...dialog.querySelectorAll("button")].find(
          (el) => el.textContent === "Connect agents",
        )!;
        const bounds = button.getBoundingClientRect();
        return (
          dialog.scrollWidth <= dialog.clientWidth + 1 &&
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          bounds.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
  await browser.evaluate(async () => {
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
    await Promise.all(
      dialog
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await app.screenshot("plugin-connection-narrow");
  await consent.getByRole("button", "Cancel").tap();
  await expect(consent).toHaveCount(0);
});

test("connection failures do not add the plugin and can be retried", async ({
  browser,
  screen,
}) => {
  await browser.evaluate(() => {
    (window as any).__pluginTest.failConnection = true;
  });
  await screen.getByRole("button", "Add tldraw").tap();
  await screen
    .getByRole("dialog", "Connect plugins to your agents")
    .getByRole("button", "Connect agents")
    .tap();
  await expect(screen.getByRole("alert")).toContainText("Could not connect agents");
  await expect(screen.getByRole("button", "Add tldraw")).toBeVisible();
  expect(
    await browser.evaluate(() =>
      (window as any).__pluginTest.commands.includes("plugins_set_enabled"),
    ),
  ).toBe(false);
  await browser.evaluate(() => {
    (window as any).__pluginTest.failConnection = false;
  });
  await screen.getByRole("button", "Add tldraw").tap();
  await screen
    .getByRole("dialog", "Connect plugins to your agents")
    .getByRole("button", "Connect agents")
    .tap();
  await expect(screen.getByTestId("plugin-card-tldraw")).toContainText("Added");
});
