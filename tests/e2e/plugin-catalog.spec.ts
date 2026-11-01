import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
// The real catalog, so every shipped entry and logo is exercised.
const catalog = JSON.parse(
  fs.readFileSync(path.join(here, "../../src/plugins/assets/catalog.json"), "utf8"),
);

test.beforeEach(async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app.waitForSelector('[data-testid="sidebar"]');
  // A stateful fake of the native plugin commands. Adding an OAuth plugin waits for the
  // browser sign-in until the test finishes it (`__finishSignIn`) or the user cancels.
  await app.evaluate((entries: any[]) => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    const state = {
      plugins: entries.map((p) => ({
        ...p,
        auth: p.auth ?? "none",
        enabled: false,
        signedIn: false,
      })),
      agents: [
        {
          id: "claude",
          name: "Claude Code",
          configPath: "C:/Users/me/.claude.json",
          registered: false,
        },
        {
          id: "codex",
          name: "Codex",
          configPath: "C:/Users/me/.codex/config.toml",
          registered: false,
        },
      ],
      runtime: "node",
      agentsConnected: false,
      bridgeConfig: null,
      error: null,
    };
    const snapshot = () => structuredClone(state);
    const apply = (id: string, enabled: boolean) => {
      const plugin = state.plugins.find((p) => p.id === id)!;
      plugin.enabled = enabled;
      plugin.signedIn = enabled && plugin.auth === "oauth";
      const anyEnabled = state.plugins.some((p) => p.enabled);
      state.agents.forEach((agent: any) => (agent.registered = anyEnabled));
      // Claude Code already talked to Cairngorm from a terminal; Codex has not yet.
      (state.agents[0] as any).lastSeen = anyEnabled ? 125 : null;
    };
    let pending: ((cancelled: boolean) => void) | null = null;
    (window as any).__finishSignIn = () => pending?.(false);
    (window as any).__expireSignIn = (id: string) => {
      state.plugins.find((p) => p.id === id)!.signedIn = false;
    };
    internals.invoke = (cmd: string, args: any) => {
      if (cmd === "plugins_state") {
        return Promise.resolve(snapshot());
      }
      if (cmd === "plugins_cancel_sign_in") {
        pending?.(true);
        return Promise.resolve();
      }
      if (cmd === "plugins_connect_agents") {
        state.agentsConnected = true;
        return Promise.resolve(snapshot());
      }
      if (cmd === "plugins_set_enabled") {
        const plugin = state.plugins.find((p) => p.id === args.id)!;
        if (args.enabled && plugin.auth === "oauth" && !plugin.signedIn) {
          return new Promise((resolve) => {
            pending = (cancelled) => {
              pending = null;
              if (!cancelled) {
                apply(args.id, true);
              }
              resolve(snapshot());
            };
          });
        }
        apply(args.id, args.enabled);
        return Promise.resolve(snapshot());
      }
      return original(cmd, args);
    };
  }, catalog);
  await app.keyboard.press("Control+Comma");
  await app
    .getByTestId("settings-dialog")
    .getByRole("button", { name: "Plugins", exact: true })
    .click();
});

test("plugins are a catalog: add tldraw, see which agents are active, remove it", async ({
  app,
}) => {
  const dialog = app.getByTestId("settings-dialog");
  const card = dialog.getByTestId("plugin-card-tldraw");
  await expect(dialog.getByRole("region", { name: "Creativity" })).toContainText("tldraw");
  await expect(dialog.getByTestId("plugin-agent-claude")).toContainText("Off");

  await card.getByRole("button", { name: "Add tldraw" }).click();
  await app
    .getByRole("dialog", { name: "Connect plugins to your agents" })
    .getByRole("button", { name: "Connect agents", exact: true })
    .click();
  await expect(card).toContainText("Added");
  await expect(dialog.getByTestId("plugin-agent-claude")).toContainText("Connected");
  await expect(dialog.getByTestId("plugin-agent-claude")).toContainText("Seen 2 min ago");
  await expect(dialog.getByTestId("plugin-agent-codex")).toContainText("Restart required");
  await dialog.screenshot({ path: "logs/e2e/plugin-catalog.png", animations: "disabled" });

  await card.getByRole("button", { name: "More about tldraw" }).click();
  await app.getByRole("menuitem", { name: "Remove" }).click();
  await expect(card.getByRole("button", { name: "Add tldraw" })).toBeVisible();
  await expect(dialog.getByTestId("plugin-agent-codex")).toContainText("Off");
});

test("every plugin starts off and shows its own logo, in colour", async ({ app }) => {
  const dialog = app.getByTestId("settings-dialog");
  for (const plugin of catalog) {
    const card = dialog.getByTestId(`plugin-card-${plugin.id}`);
    await expect(card.getByRole("button", { name: `Add ${plugin.name}` })).toBeVisible();
    const logo = card.getByTestId("plugin-logo");
    await expect
      .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth), {
        message: `${plugin.id} logo`,
      })
      .toBeGreaterThan(0);
    expect(await logo.evaluate((img) => getComputedStyle(img).filter)).toBe("none");
  }
  await dialog.screenshot({ path: "logs/e2e/plugin-catalog-all.png", animations: "disabled" });
});

test("an account plugin is added once the browser sign-in finishes, and can be cancelled", async ({
  app,
}) => {
  const dialog = app.getByTestId("settings-dialog");
  const notion = dialog.getByTestId("plugin-card-notion");
  await notion.getByRole("button", { name: "Add Notion" }).click();
  await app
    .getByRole("dialog", { name: "Connect plugins to your agents" })
    .getByRole("button", { name: "Connect agents", exact: true })
    .click();
  await expect(notion.getByRole("status")).toContainText("Finish in your browser");
  // One sign-in at a time: other rows wait instead of cancelling this one.
  const linear = dialog.getByTestId("plugin-card-linear");
  await expect(linear.getByRole("button", { name: "Add Linear" })).toBeDisabled();
  await dialog.screenshot({ path: "logs/e2e/plugin-sign-in.png", animations: "disabled" });
  await notion.getByRole("button", { name: "Cancel" }).click();
  await expect(notion.getByRole("button", { name: "Add Notion" })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);

  await notion.getByRole("button", { name: "Add Notion" }).click();
  await expect(notion.getByRole("status")).toBeVisible();
  await app.evaluate(() => (window as any).__finishSignIn());
  await expect(notion).toContainText("Added");

  // A sign-in the service revoked asks to sign in again instead of looking connected.
  await app.evaluate(() => (window as any).__expireSignIn("notion"));
  await app.keyboard.press("Escape");
  await app.keyboard.press("Control+Comma");
  await dialog.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(notion.getByRole("button", { name: "Sign in to Notion" })).toBeVisible();
  await notion.getByRole("button", { name: "More about Notion" }).click();
  await expect(app.getByRole("menuitem", { name: "Remove and sign out" })).toBeVisible();
});

test("search filters the catalog by name, description or category", async ({ app }) => {
  const dialog = app.getByTestId("settings-dialog");
  const search = dialog.getByRole("searchbox", { name: "Search plugins" });
  await search.fill("deploy");
  await expect(dialog.getByTestId("plugin-card-vercel")).toBeVisible();
  await expect(dialog.getByTestId("plugin-card-notion")).toHaveCount(0);
  await search.fill("developer tools");
  await expect(dialog.getByTestId("plugin-card-supabase")).toBeVisible();
  await expect(dialog.getByTestId("plugin-card-tldraw")).toHaveCount(0);
  await search.fill("nothing like this");
  await expect(dialog).toContainText("No plugins match");
});

test("the catalog fits a narrow window", async ({ app }) => {
  await app.setViewportSize({ width: 420, height: 780 });
  const dialog = app.getByTestId("settings-dialog");
  const settings = dialog.getByTestId("plugin-settings");
  await expect(settings.getByTestId("plugin-card-tldraw")).toBeVisible();
  expect(await settings.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await dialog.screenshot({ path: "logs/e2e/plugin-catalog-narrow.png", animations: "disabled" });
});
