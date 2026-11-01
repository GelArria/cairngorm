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
      plugins: [
        {
          id: "tldraw",
          name: "tldraw",
          description: "Interactive diagrams",
          category: "Creativity",
          logo: "/plugins/tldraw.svg",
          homepage: "https://example.com",
          terms: "https://example.com/terms",
          auth: "none",
          enabled: true,
          signedIn: false,
        },
      ],
      agents: [],
      clients: [] as any[],
      discoveredClients: [] as any[],
      runtime: "node",
      agentsConnected: true,
      error: null,
    };
    w.__customClients = { state, commands: [] as string[], fail: false };
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (!cmd.startsWith("plugins_")) {
        return original(cmd, args);
      }
      w.__customClients.commands.push(cmd);
      if (cmd === "plugins_add_client") {
        if (w.__customClients.fail) {
          throw new Error("Invalid MCP configuration; the file was left unchanged");
        }
        state.clients.push({
          id: "custom-1",
          name: args.name,
          configPath: args.configPath,
          format: args.format,
          registered: false,
          error: null,
          activity: null,
        });
      }
      if (cmd === "plugins_set_client_connected") {
        state.clients[0].registered = args.enabled;
        state.clients[0].activity = null;
      }
      if (cmd === "plugins_remove_client") {
        state.clients = [];
      }
      return structuredClone(state);
    };
  });
  await browser.locator("body").press("Control+,");
  await screen.getByTestId("settings-dialog").getByRole("button", "Plugins", { exact: true }).tap();
});

test("register, verify, refresh and remove an arbitrary MCP client", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByRole("button", "Connect another MCP client").tap();
  const form = screen.getByRole("dialog", "Register an MCP client");
  await form.getByLabel("Client name").fill("My CLI");
  await form.getByLabel("MCP configuration file").fill("C:/agents/my-cli/mcp.json");
  await form.getByRole("button", "Register client").tap();
  const row = screen.getByTestId("plugin-agent-custom-1");
  await expect(row).toContainText("Not connected");
  expect(
    await browser.evaluate(() =>
      (window as any).__customClients.commands.filter((c: string) => c !== "plugins_state"),
    ),
  ).toEqual(["plugins_add_client"]);
  await row.getByRole("switch", "Connect My CLI").tap();
  await expect(row).toContainText("Restart required");
  await expect(row).not.toContainText("Connected");
  const refresh = async () => {
    await browser.locator("body").press("Escape");
    await browser.locator("body").press("Control+,");
    await screen
      .getByTestId("settings-dialog")
      .getByRole("button", "Plugins", { exact: true })
      .tap();
  };
  await browser.evaluate(() => {
    (window as any).__customClients.state.clients[0].activity = {
      id: "terminal:123",
      name: "Independent MCP client",
      registration: "custom-1",
      agent: null,
      lastSeen: 3,
      synced: true,
    };
  });
  await refresh();
  await expect(row).toContainText("Connected");
  await expect(row).toContainText("Catalog read");
  const visibility = screen.getByText(/confirms MCP access, not model visibility/);
  await expect(visibility).toBeVisible();
  await expect(row).not.toContainText("Tools synced");
  await app.screenshot("custom-client-connected");
  await browser.evaluate(() => {
    (window as any).__customClients.state.clients[0].activity.synced = false;
  });
  await refresh();
  await expect(row).toContainText("Refresh required");
  await expect(row).not.toContainText("Connected");
  await app.screenshot("custom-client-refresh-required");
  await row.getByRole("switch", "Connect My CLI").tap();
  await expect(row).toContainText("Not connected");
  await row.getByRole("button", "Remove My CLI").tap();
  await screen.getByRole("dialog", "Remove MCP client").getByRole("button", "Cancel").tap();
  await expect(row).toBeVisible();
  await row.getByRole("button", "Remove My CLI").tap();
  await screen.getByRole("dialog", "Remove MCP client").getByRole("button", "Remove client").tap();
  await expect(row).toHaveCount(0);
});

test("invalid configs stay unregistered, with a visible retryable error", async ({
  browser,
  screen,
}) => {
  await screen.getByRole("button", "Connect another MCP client").tap();
  const form = screen.getByRole("dialog", "Register an MCP client");
  await expect(form.getByRole("button", "Register client")).toBeDisabled();
  await form.getByLabel("Client name").fill("From scratch");
  await form.getByLabel("MCP configuration file").fill("C:/agents/custom/mcp.json");
  await browser.evaluate(() => {
    (window as any).__customClients.fail = true;
  });
  await form.getByRole("button", "Register client").tap();
  await expect(form.getByRole("alert")).toContainText("file was left unchanged");
  await expect(screen.getByRole("switch", "Connect From scratch")).toHaveCount(0);
  await browser.evaluate(() => {
    (window as any).__customClients.fail = false;
  });
  await form.getByRole("button", "Register client").tap();
  await expect(screen.getByRole("switch", "Connect From scratch")).toBeVisible();
});

test("registration fits a narrow window and standard handshakes discover unlisted clients", async ({
  app,
  browser,
  screen,
}) => {
  await browser.setViewport({ width: 420, height: 780 });
  await expect.poll(() => browser.evaluate(() => innerWidth)).toBe(420);
  await screen.getByRole("button", "Connect another MCP client").tap();
  const form = screen.getByRole("dialog", "Register an MCP client");
  await form.getByLabel("Client name").fill("My custom CLI");
  await form.getByLabel("MCP configuration file").fill("C:/agents/cli/mcp.json");
  await expect
    .poll(() =>
      browser.evaluate(() => {
        const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
        const b = [...dialog.querySelectorAll("button")]
          .find((el) => el.textContent === "Register client")!
          .getBoundingClientRect();
        return (
          dialog.scrollWidth <= dialog.clientWidth + 1 &&
          b.right <= innerWidth &&
          b.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
  await browser.evaluate(async () => {
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
    await Promise.all(
      dialog.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
    );
  });
  await app.screenshot("custom-client-register-narrow");
  await form.getByRole("button", "Cancel").tap();
  await browser.evaluate(() => {
    (window as any).__customClients.state.discoveredClients = [
      {
        id: "terminal:456",
        name: "Never-seen-before CLI",
        registration: null,
        agent: null,
        lastSeen: 1,
        synced: true,
      },
    ];
  });
  await browser.locator("body").press("Escape");
  await browser.locator("body").press("Control+,");
  await screen.getByTestId("settings-dialog").getByRole("button", "Plugins", { exact: true }).tap();
  await expect(screen.getByTestId("plugin-agent-detected-terminal:456")).toContainText(
    "Catalog read",
  );
  const visibility = screen.getByText(/confirms MCP access, not model visibility/);
  await visibility.scrollIntoView();
  await expect(visibility).toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(() => {
        const dialog = document.querySelector<HTMLElement>('[data-testid="settings-dialog"]')!;
        return dialog.scrollWidth <= dialog.clientWidth + 1;
      }),
    )
    .toBe(true);
  await app.screenshot("custom-client-capabilities-narrow");
});
