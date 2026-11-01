import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

// Long branch decorations must stay inside their chip: one line, never clipped
// mid-word. Repro of a real repo whose branch is `feat/doop-v2-design-and-more`.
const COMMIT = {
  hash: "76df2f6",
  author: "dev",
  time: "25 minutes ago",
  subject: "feat: terminal session hooks/workspace restore, git commit box",
  parents: ["abc1234"],
  refs: [
    "HEAD -> feat/doop-v2-design-and-more",
    "origin/feat/doop-v2-design-and-more",
    "tag: v0.1.0-doop",
  ],
  at: Math.floor(Date.now() / 1000) - 1500,
};
const LONG_NAME = "HEAD -> feat/doop-v2-design-and-more";
const pretty = (refs: string[]) => refs.join(", ").replace("->", "→");

/** Ref decorations live in the workspace Graph, not the flat sidebar History. */
async function openHistory(app: Page, commit: Record<string, unknown>) {
  await app.evaluate((c) => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = (cmd: string, args: any) =>
      cmd === "git_log"
        ? Promise.resolve([c])
        : cmd === "git_commit_details"
          ? Promise.resolve({
              hash: String(c.hash).padEnd(40, "0"),
              author: "Test Author",
              email: "test@example.invalid",
              date: "2026-10-05T12:00:00Z",
              refs: c.refs,
              message: c.subject,
              files: [],
            })
          : original(cmd, args);
  }, commit);
  await app.locator('[data-testid="sidebar-git-toggle"]').click();
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await app.getByRole("menuitem", { name: "Open Git Graph", exact: true }).click();
  const row = app.locator('[data-testid="git-graph-row"]').first();
  await expect(row).toBeVisible({ timeout: 3000 });
  return row;
}

/** Chips measured in the real browser: a wrapped or clipped chip is the bug. */
const measure = (row: ReturnType<Page["locator"]>) =>
  row.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll<HTMLElement>('[data-testid="git-ref-chip"]')].map((chip) => {
      const label = chip.firstElementChild as HTMLElement;
      const r = chip.getBoundingClientRect();
      return {
        text: label.textContent ?? "",
        wrapped: chip.scrollHeight > chip.clientHeight + 1,
        ellipsized: label.scrollWidth > label.clientWidth + 0.5,
        insideRow: r.left >= box.left - 0.5 && r.right <= box.right + 0.5,
      };
    });
  });

test("decorations render on one line and stay complete when the Graph has room", async ({
  app,
}) => {
  const row = await openHistory(app, COMMIT);
  await app
    .getByTestId("git-graph-view")
    .screenshot({ path: "logs/e2e/git-refs-render.png", animations: "disabled" });
  await row.screenshot({ path: "logs/e2e/git-refs-row-long.png", animations: "disabled" });

  const chips = await measure(row);
  console.log(JSON.stringify(chips, null, 1));
  expect(chips).toHaveLength(1); // the rest collapses into the counter
  expect(chips[0]).toMatchObject({ wrapped: false, insideRow: true });
  expect(chips[0].ellipsized, "Graph has room for this branch, unlike the sidebar").toBe(false);
  expect(chips[0].text).toContain("feat/doop-v2-design"); // still identifiable
  await expect(row.locator('[data-testid="git-ref-count"]')).toHaveText("+2");
  await expect(row.locator('[data-testid="git-ref-count"]')).toHaveAttribute(
    "title",
    pretty(COMMIT.refs),
  );
  await expect(row).toHaveAttribute("title", `${COMMIT.subject}\n${pretty(COMMIT.refs)}`);
});

test("short decorations stay complete, not ellipsized", async ({ app }) => {
  const refs = ["HEAD -> main", "origin/main"];
  const row = await openHistory(app, { ...COMMIT, refs });
  const chips = await measure(row);
  expect(chips).toMatchObject([
    { text: "HEAD → main", wrapped: false, ellipsized: false, insideRow: true },
  ]);
  await expect(row.locator('[data-testid="git-ref-count"]')).toHaveAttribute("title", pretty(refs));
  await app
    .getByTestId("git-graph-view")
    .screenshot({ path: "logs/e2e/git-refs-short.png", animations: "disabled" });
  await row.screenshot({ path: "logs/e2e/git-refs-row-short.png", animations: "disabled" });
});

test("very long Graph decorations ellipsize without wrapping or hiding their full tooltip", async ({
  app,
}) => {
  const ref = `HEAD -> feature/${"long-branch-".repeat(12)}`;
  const row = await openHistory(app, { ...COMMIT, refs: [ref] });
  expect(await measure(row)).toMatchObject([{ wrapped: false, ellipsized: true, insideRow: true }]);
  await expect(row.getByTestId("git-ref-chip")).toHaveAttribute("title", pretty([ref]));
});

test("a single decoration gets no counter", async ({ app }) => {
  const row = await openHistory(app, { ...COMMIT, refs: [LONG_NAME] });
  expect(await measure(row)).toMatchObject([{ wrapped: false, insideRow: true }]);
  await expect(row.locator('[data-testid="git-ref-count"]')).toHaveCount(0);
  await expect(row).toHaveAttribute("title", `${COMMIT.subject}\n${pretty([LONG_NAME])}`);
});
