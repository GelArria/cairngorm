import { test, expect } from "./fixtures";

const alphaOf = (color: string) => {
  const match = color.match(/rgba?\(([^)]+)\)/);
  const parts = match ? match[1].split(/[ ,/]+/).filter(Boolean) : [];
  return parts.length === 4 ? Number(parts[3]) : 1;
};

test("the title bar follows the sidebar's transparency until separated", async ({ app }) => {
  await app.evaluate(() => {
    localStorage.setItem("show-splash", "false");
    localStorage.setItem(
      "cairngorm-transparency",
      JSON.stringify({ enabled: true, surfaces: { header: 90, sidebar: 40 } }),
    );
  });
  await app.reload();
  await app.waitForSelector('[data-testid="sidebar"]');
  const header = app.locator(".surface-header").first();
  const headerAlpha = async () =>
    alphaOf(await header.evaluate((el) => getComputedStyle(el).backgroundColor));
  await expect.poll(headerAlpha).toBeCloseTo(0.4, 2);

  await app.keyboard.press("Control+Comma");
  const dialog = app.getByTestId("settings-dialog");
  await dialog.getByRole("button", { name: "Transparency", exact: true }).click();
  await expect(dialog.getByText("Title bar (follows sidebar)")).toBeVisible();
  await dialog.getByTestId("transparency-settings").screenshot({
    path: "logs/e2e/transparency-header-follows.png",
    animations: "disabled",
  });
  await dialog.getByRole("switch", { name: "Title bar matches sidebar" }).click();
  await expect.poll(headerAlpha).toBeCloseTo(0.9, 2);
});

for (const [level, alpha] of [
  [40, 0.4],
  [100, 1],
] as const) {
  test(`a top dock and the title bar share the sidebar opacity (${level}%)`, async ({ app }) => {
    await app.evaluate((sidebar) => {
      localStorage.setItem("show-splash", "false");
      localStorage.setItem("sidebar-side", "top");
      localStorage.setItem(
        "cairngorm-transparency",
        JSON.stringify({ enabled: true, surfaces: { header: 90, sidebar } }),
      );
    }, level);
    await app.reload();
    const dock = app.getByTestId("sidebar-dock");
    await expect(dock).toBeVisible();
    const bg = (el: Element) => getComputedStyle(el).backgroundColor;
    const header = app.locator(".surface-header").first();
    await expect.poll(async () => alphaOf(await header.evaluate(bg))).toBeCloseTo(alpha, 2);
    expect(alphaOf(await dock.evaluate(bg))).toBeCloseTo(alpha, 2);
    const border = await header.evaluate((el) => getComputedStyle(el).borderBottomColor);
    expect(alphaOf(border)).toBe(0);
    await app.screenshot({
      path: `logs/e2e/transparency-dock-top-${level}.png`,
      clip: { x: 0, y: 0, width: 1280, height: 110 },
    });
  });
}
