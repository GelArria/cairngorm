import { test, expect } from "./fixtures";

for (const [label, width, height] of [
  ["md", 900, 700],
  ["lg", 1440, 900],
] as const) {
  test(`sidebar layout at ${label} breakpoint`, async ({ app }) => {
    await app.setViewportSize({ width, height });
    const sidebar = app.getByTestId("sidebar");
    await expect(sidebar).toBeVisible();
    expect(await sidebar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await app.screenshot({ path: `logs/e2e/sidebar-${label}-${width}.png` });
  });
}
