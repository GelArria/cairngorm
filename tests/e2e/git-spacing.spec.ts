import { test, expect } from "./fixtures";

test("Git controls stay evenly spaced at narrow and wide sidebar widths", async ({ app }) => {
  await app.getByTestId("git-footer").click();
  const panel = app.getByTestId("git-panel");
  const actions = app.getByRole("button", { name: "Git actions", exact: true });
  const pull = app.getByTestId("git-pull");
  const stage = app.getByTestId("git-stage-all");
  await expect(stage).toBeEnabled();
  for (const width of [264, 320]) {
    const sidebar = app.getByTestId("sidebar");
    const current = (await sidebar.boundingBox())!;
    const handle = (await app.locator(".cursor-col-resize").first().boundingBox())!;
    await app.mouse.move(handle.x + handle.width / 2, handle.y + 100);
    await app.mouse.down();
    await app.mouse.move(handle.x + handle.width / 2 + width - current.width, handle.y + 100);
    await app.mouse.up();
    await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(width);
    // Header: branch on the left; Pull then the actions menu on the right, one row.
    const box = (await panel.boundingBox())!;
    const branch = (await panel.getByRole("button", { name: "Switch branch" }).boundingBox())!;
    const pullBox = (await pull.boundingBox())!;
    const menu = (await actions.boundingBox())!;
    expect(branch.x - box.x).toBeCloseTo(12, 0);
    expect(branch.x + branch.width).toBeLessThanOrEqual(pullBox.x);
    expect(pullBox.x + pullBox.width).toBeLessThanOrEqual(menu.x);
    expect(Math.abs(pullBox.y + pullBox.height / 2 - (menu.y + menu.height / 2))).toBeLessThan(2);
    // Commit row: AI draft beside a full-width Commit split button.
    const ai = (await app
      .getByRole("button", { name: "AI summarize", exact: true })
      .boundingBox())!;
    const commit = (await app.getByTestId("git-commit-btn").boundingBox())!;
    const caret = (await app
      .getByRole("button", { name: "Commit options", exact: true })
      .boundingBox())!;
    const form = (await app.getByTestId("git-commit-box").boundingBox())!;
    expect(commit.height).toBe(28);
    expect(Math.abs(ai.y + ai.height / 2 - (commit.y + commit.height / 2))).toBeLessThan(2);
    expect(form.x + form.width - (caret.x + caret.width)).toBeCloseTo(9, 0);
    expect(
      await panel.evaluate((el) => {
        const side = document.querySelector('[data-testid="sidebar"]')!.getBoundingClientRect();
        return [...el.querySelectorAll("button, textarea")].every((control) => {
          const r = control.getBoundingClientRect();
          return r.left >= side.left - 1 && r.right <= side.right + 1;
        });
      }),
    ).toBe(true);
    await panel.screenshot({ path: `logs/e2e/git-spacing-${width}.png`, animations: "disabled" });
  }
  await actions.click();
  await app
    .getByRole("menu")
    .screenshot({ path: "logs/e2e/git-actions-menu.png", animations: "disabled" });
  await app.getByRole("menuitemcheckbox", { name: "Show as tree", exact: true }).click();
  await expect(app.getByTestId("git-path-folder").first()).toBeVisible();
  await stage.click();
  await expect
    .poll(() =>
      app.evaluate(() =>
        (window as any).__CMD_LOG__.some(
          (c: string) => c.startsWith("git_stage:") && c.includes('"paths":[]'),
        ),
      ),
    )
    .toBe(true);
  await expect(panel).toContainText("Working tree clean");
});
