import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SCHEDULE_INIT } from "../mocks/scheduled-tasks";
import { SEED_INIT } from "../mocks/tauri-seed";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(`${SEED_INIT}\n${SCHEDULE_INIT}`);
  await browser.addInitScript(() => {
    if (!location.protocol.startsWith("http")) {
      return;
    }
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
    localStorage.setItem("active-project-id", "one");
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__calls = [];
    w.__removed = false;
    w.__state = {
      plugins: [
        {
          id: "notion",
          name: "Notion",
          description: "Pages and databases",
          category: "Productivity",
          logo: "",
          homepage: "https://example.com",
          terms: "https://example.com/terms",
          auth: "oauth",
          enabled: false,
          signedIn: false,
        },
      ],
      agents: [],
      clients: [],
      discoveredClients: [],
      runtime: "node",
      agentsConnected: true,
      filesEnabled: false,
      filesAccess: "ask",
      filesAvailable: true,
      appGrants: [
        { app: "excel", projectId: "one" },
        { app: "word", projectId: "two" },
      ],
      bridgeConfig: null,
      error: null,
    };
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      w.__calls.push({ cmd, args });
      if (cmd === "plugins_state") {
        return structuredClone(w.__state);
      }
      if (cmd === "agent_configs_removed") {
        return w.__removed;
      }
      if (cmd === "agent_configs_remove" || cmd === "agent_configs_restore") {
        w.__removed = cmd === "agent_configs_remove";
        if (w.__removed) {
          w.__state.agentsConnected = false;
        }
        return { errors: [], removed: w.__removed };
      }
      if (cmd === "plugins_forget_app") {
        w.__state.appGrants = w.__state.appGrants.filter(
          (grant: any) => grant.app !== args.id || grant.projectId !== args.projectId,
        );
        return structuredClone(w.__state);
      }
      if (cmd === "pty_ensure") {
        return { permissionsOff: true };
      }
      if (cmd === "scheduled_tasks_action" && args.action === "run") {
        await original(cmd, args);
        const tasks = JSON.parse(localStorage.getItem("qa-scheduled-tasks") || "[]");
        tasks.find((task: any) => task.id === args.id).changes = ["M src/app.ts", "?? notes.md"];
        localStorage.setItem("qa-scheduled-tasks", JSON.stringify(tasks));
        return;
      }
      return original(cmd, args);
    };
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
});

/** Screenshots wait until the newest dialog finished opening. */
async function settled(browser: any) {
  await expect
    .poll(() =>
      browser.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"]')]
          .pop()!
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "finished"),
      ),
    )
    .toBe(true);
}

async function openPlugins(browser: any, screen: any) {
  await browser.locator("body").press("Control+,");
  await screen.getByTestId("settings-dialog").getByRole("button", "Plugins", { exact: true }).tap();
}

test("plugin settings name each grant's project, warn about remote data and remove agent configs", async ({
  app,
  browser,
  screen,
}) => {
  await openPlugins(browser, screen);
  await expect(screen.getByTestId("plugin-data-notice")).toContainText(
    "Notion receives what agents send to it. Treat its replies as untrusted.",
  );
  const grants = screen.getByTestId("always-allowed-apps");
  await expect(grants).toContainText(/excel\s*in Cairngorm/i);
  await expect(grants).toContainText(/word\s*in Other project/i);
  await settled(browser);
  await app.screenshot("plugin-grants-and-data-notice");

  await screen.getByRole("button", "Ask again before agents control excel in Cairngorm").tap();
  expect(
    await browser.evaluate(() =>
      (window as any).__calls
        .filter((call: any) => call.cmd === "plugins_forget_app")
        .map((call: any) => call.args),
    ),
  ).toEqual([{ id: "excel", projectId: "one" }]);
  await expect(grants).not.toContainText(/excel/i);
  await expect(grants).toContainText(/word/i);

  const cleanup = screen.getByTestId("agent-config-cleanup");
  await cleanup.scrollIntoView();
  await cleanup.getByRole("button", "Remove Cairngorm from agent configs").tap();
  const confirm = screen.getByRole("dialog", "Remove Cairngorm from agent configs?");
  await expect(confirm).toContainText("no longer be restored");
  await settled(browser);
  await app.screenshot("agent-config-cleanup-confirm");
  await confirm.getByRole("button", "Remove", { exact: true }).tap();
  await expect(cleanup.getByRole("status")).toContainText("Removed");
  await expect(cleanup.getByRole("button", "Add session hooks back")).toBeVisible();
  await app.screenshot("agent-config-cleanup-done");
  await cleanup.getByRole("button", "Add session hooks back").tap();
  await expect(cleanup.getByRole("button", "Remove Cairngorm from agent configs")).toBeVisible();
});

test("a terminal launched with permission checks off is marked on its tab", async ({
  app,
  screen,
}) => {
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  const badge = screen.getByTestId("tab-permissions-off");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("aria-label", "Permission checks off");
  await app.screenshot("tab-permissions-off");
});

test("a scheduled run's result lists the files it changed", async ({ app, browser, screen }) => {
  await screen.getByTestId("mode-calendar").tap();
  await screen.getByRole("button", "Schedule event").tap();
  const form = screen.getByRole("dialog", "Schedule event");
  await form.getByLabel("Task name").fill("Tidy notes");
  await form.getByLabel("Instructions").fill("Tidy the notes file.");
  await form.getByRole("button", "Review schedule").tap();
  const review = screen.getByRole("dialog", "Review schedule");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", "Activate schedule").tap();
  const row = screen.getByRole("article", "Tidy notes");
  await row.getByRole("button", "Run now").tap();
  await expect(row.getByText("Succeeded")).toBeVisible();
  await row.getByRole("button", "Last result").tap();
  const changes = screen.getByRole("dialog", "Last run result").getByTestId("run-changes");
  await expect(changes).toContainText("M src/app.ts");
  await expect(changes).toContainText("?? notes.md");
  await settled(browser);
  await app.screenshot("schedule-run-changes");
});
