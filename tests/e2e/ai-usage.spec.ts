import { test, expect, SEED_INIT } from "./fixtures";
import type { Page } from "@playwright/test";

const REPORTS = [
  {
    id: "codex",
    name: "Codex",
    plan: "plus",
    windows: [
      {
        kind: "weekly",
        label: "Weekly",
        usedPercent: 41,
        resetsAt: Math.floor(Date.now() / 1000) + 6 * 86400 + 4 * 3600 + 600,
        resetsText: null,
      },
    ],
    error: null,
  },
  {
    id: "claude",
    name: "Claude Code",
    plan: null,
    windows: [
      {
        kind: "session",
        label: "5-hour",
        usedPercent: 93,
        resetsAt: null,
        resetsText: "Oct 16, 12:39am (America/Caracas)",
      },
      {
        kind: "weekly",
        label: "Weekly",
        usedPercent: 2,
        resetsAt: null,
        resetsText: "Oct 21, 2:59am (America/Caracas)",
      },
    ],
    error: null,
  },
];

async function seed(page: Page, reports: unknown[]) {
  await page.addInitScript(SEED_INIT);
  await page.addInitScript((reports) => {
    localStorage.setItem("show-splash", "false");
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__USAGE_CALLS__ = 0;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      if (cmd === "read_ai_usage") {
        w.__USAGE_CALLS__++;
        return Promise.resolve(reports);
      }
      if (cmd === "detect_ai_services") {
        return Promise.resolve({ setupComplete: true, commitProvider: null, services: [] });
      }
      return original(cmd, args);
    };
  }, reports);
  await page.goto("/");
}

test("header usage panel shows 5-hour and weekly quota of synced subscriptions", async ({
  page,
}) => {
  await seed(page, REPORTS);
  await page.getByTestId("header-ai-usage").click();
  const panel = page.getByTestId("usage-panel");
  await expect(panel.getByTestId("usage-claude")).toBeVisible();
  const claude = panel.getByTestId("usage-claude");
  await expect(claude.getByTestId("usage-window-session")).toContainText("5-hour");
  await expect(claude.getByTestId("usage-window-session")).toContainText("93% used");
  await expect(claude.getByTestId("usage-window-session")).toContainText("Resets Oct 16, 12:39am");
  await expect(claude.getByTestId("usage-window-weekly")).toContainText("2% used");
  const codex = panel.getByTestId("usage-codex");
  await expect(codex).toContainText("plus");
  await expect(codex.getByTestId("usage-window-session")).toHaveCount(0);
  await expect(codex.getByTestId("usage-window-weekly")).toContainText("Resets in 6d 4h");
  await expect(panel.getByRole("progressbar", { name: "5-hour usage" })).toHaveAttribute(
    "aria-valuenow",
    "93",
  );
  await panel.screenshot({ path: "logs/e2e/ai-usage-panel.png" });
  await page.screenshot({ path: "logs/e2e/ai-usage-window.png" });

  await panel.getByRole("button", { name: "Refresh usage" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__USAGE_CALLS__)).toBe(2);

  await panel.getByText("AI providers").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "AI providers", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Claude limits saved from a Claude Code session show when they were last seen", async ({
  page,
}) => {
  await seed(page, [
    {
      id: "claude",
      name: "Claude Code",
      plan: "pro",
      windows: [
        {
          kind: "session",
          label: "5-hour",
          usedPercent: 34,
          resetsAt: Math.floor(Date.now() / 1000) + 2 * 3600,
          resetsText: null,
        },
      ],
      error: null,
      updatedAt: Math.floor(Date.now() / 1000) - 60,
      note: null,
    },
  ]);
  await page.getByTestId("header-ai-usage").click();
  const claude = page.getByTestId("usage-panel").getByTestId("usage-claude");
  await expect(claude).toContainText("pro");
  await expect(claude.getByTestId("usage-window-session")).toContainText("34% used");
  await expect(claude).toContainText("Last seen");
  await expect(claude).toContainText("in Claude Code");
});

test("a Claude login without saved limits explains when they appear", async ({ page }) => {
  await seed(page, [
    {
      id: "claude",
      name: "Claude Code",
      plan: "pro",
      windows: [],
      error: null,
      updatedAt: null,
      note: "Limits appear here once Claude Code answers its first message in any terminal.",
    },
  ]);
  await page.getByTestId("header-ai-usage").click();
  const claude = page.getByTestId("usage-panel").getByTestId("usage-claude");
  await expect(claude).toContainText("pro");
  await expect(claude).toContainText("answers its first message");
  await expect(claude.getByRole("progressbar")).toHaveCount(0);
});

test("usage panel explains when no subscription is synced", async ({ page }) => {
  await seed(page, []);
  await page.getByTestId("header-ai-usage").click();
  await expect(page.getByTestId("usage-panel")).toContainText("No subscription is signed in");
  await page.getByTestId("usage-panel").screenshot({ path: "logs/e2e/ai-usage-empty.png" });
});
