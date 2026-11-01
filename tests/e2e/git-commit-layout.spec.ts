import { test, expect } from "./fixtures";

test("long commit drafts keep pending files visible in compact Git panels", async ({ app }) => {
  await app.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = (cmd: string, args: unknown) =>
      cmd === "git_status"
        ? Promise.resolve({
            files: Array.from({ length: 15 }, (_, i) => ({
              path: `src/pending-${i}.ts`,
              code: " M",
            })),
            error: null,
          })
        : invoke(cmd, args);
  });
  await app.locator('[data-testid="header-sidebar-side-toggle"]').click();
  await app.getByRole("menuitemradio", { name: "Top", exact: true }).click();
  await app.getByTestId("sidebar-dock").getByTestId("sidebar-git-toggle").click();
  const draft = Array.from(
    { length: 30 },
    (_, i) => `Detail ${i}: preserve all changes in this long commit draft.`,
  ).join("\n\n");
  const message = app.getByTestId("git-commit-message");
  await message.fill(draft);
  const list = app.locator("#git-view");
  await expect.poll(async () => (await list.boundingBox())!.height).toBeGreaterThanOrEqual(128);
  await expect(app.getByTestId("git-file-row").nth(1)).toBeInViewport();
  await expect.poll(() => message.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(message).toHaveValue(draft);
  await message.evaluate((el) => {
    el.style.height = "240px";
  });
  await expect(app.getByTestId("git-file-row").nth(1)).toBeInViewport();
  await app.getByTestId("git-file-row").last().scrollIntoViewIfNeeded();
  await expect(app.getByTestId("git-file-row").last()).toBeInViewport();
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await message.evaluate((el) => {
    el.scrollTop = 0;
  });
  const box = (await app.getByTestId("git-commit-box").boundingBox())!;
  const commit = (await app.getByTestId("git-commit-btn").boundingBox())!;
  expect(commit.y + commit.height).toBeLessThanOrEqual(box.y + box.height);
  await app
    .locator('[data-testid="sidebar"]')
    .screenshot({ path: "logs/e2e/git-long-draft-files-visible.png" });
  await app.setViewportSize({ width: 390, height: 600 });
  await expect.poll(async () => (await list.boundingBox())!.height).toBeGreaterThanOrEqual(128);
  await expect(app.getByTestId("git-file-row").nth(1)).toBeInViewport();
  await expect(message).toHaveValue(draft);
  await app.setViewportSize({ width: 390, height: 400 });
  await app.getByTestId("git-file-row").first().scrollIntoViewIfNeeded();
  await expect(app.getByTestId("git-file-row").first()).toBeInViewport();
  await app.getByTestId("git-commit-btn").scrollIntoViewIfNeeded();
  await expect(app.getByTestId("git-commit-btn")).toBeInViewport();
  await expect(message).toHaveValue(draft);
});
