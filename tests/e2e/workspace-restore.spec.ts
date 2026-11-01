import { test, expect } from "@playwright/test";
import { SEED_INIT } from "./fixtures";
import fs from "node:fs";

test("reload preserves identities, focus, exact grids and recovered detached terminals", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    SEED_INIT +
      `
    localStorage.setItem("show-splash", "false");
    const baseInvoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === "plugin:sql|select" && /FROM\\s+projects/i.test(args.query))
        return Promise.resolve([{ id: "restore-qa", name: "Restore QA", root_path: "C:/workspace", created_at: "2026-01-01 00:00:00" }]);
      if (cmd.startsWith("pty_")) return Promise.resolve(cmd === "pty_replay" ? btoa("PowerShell - workspace restored\\r\\n") : undefined);
      if (cmd === "detect_home") return Promise.resolve("C:/workspace");
      return baseInvoke(cmd, args);
    };
  `,
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "New terminal", exact: true }).first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cairngorm-terminal-workspace-v1") ?? "null")?.state
            .activeGroupId,
      ),
    )
    .toBe("restore-qa");
  await page.evaluate(async () => {
    const url = "/src/terminal/hooks/use-terminal-tabs.ts";
    const s = await import(/* @vite-ignore */ url);
    const members = [1, 2, 3].map((n) => ({
      id: `restore-${n}`,
      sessionId: `term-restore-${n}`,
      title: `PowerShell ${n}`,
      shellPath: "powershell.exe",
      cwd: "C:/workspace",
    }));
    s.attachGroup(members, {
      columnCount: 2,
      columnRatios: [2, 1],
      cells: [
        { id: "c1", tabId: "restore-1", col: 0, row: 0, colSpan: 1, rowSpan: 2 },
        { id: "c2", tabId: "restore-2", col: 1, row: 0, colSpan: 1, rowSpan: 1 },
        { id: "c3", tabId: "restore-3", col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      ],
    });
  });
  await expect(page.locator("[data-pane-id]")).toHaveCount(3);
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("cairngorm-terminal-workspace-v1")!).state,
  );
  fs.mkdirSync("logs/e2e", { recursive: true });
  await page.screenshot({ path: "logs/e2e/workspace-before-reopen.png" });
  await page.reload();
  await expect(page.locator("[data-pane-id]")).toHaveCount(3);
  const after = await page.evaluate(
    () => JSON.parse(localStorage.getItem("cairngorm-terminal-workspace-v1")!).state,
  );
  expect(after.tabs.map((t: any) => [t.id, t.sessionId, t.title])).toEqual(
    before.tabs.map((t: any) => [t.id, t.sessionId, t.title]),
  );
  expect(after.layout).toEqual(before.layout);
  expect(after.activeTabId).toBe(before.activeTabId);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
      ),
    )
    .toBe(before.activeTabId);
  await page.screenshot({ path: "logs/e2e/workspace-after-reopen.png" });
  // The user's selected policy: detached panes return inside main, never disappear.
  await page.evaluate(async () => {
    const url = "/src/terminal/hooks/use-terminal-tabs.ts";
    const s = await import(/* @vite-ignore */ url);
    s.detachTab("restore-3", "detached-restore-3");
  });
  await expect(page.locator("[data-pane-id]")).toHaveCount(2);
  await page.reload();
  await expect(page.locator("[data-pane-id]")).toHaveCount(3);
});
