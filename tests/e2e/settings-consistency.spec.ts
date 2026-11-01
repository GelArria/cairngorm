import { test, expect } from "./fixtures";

const TABS = ["General", "Themes & colors", "AI providers", "Plugins", "Keybindings"];

test.beforeEach(async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app.waitForSelector('[data-testid="sidebar"]');
});

test("every settings page shares one layout and never overflows", async ({ app }) => {
  await app.keyboard.press("Control+Comma");
  const dialog = app.getByTestId("settings-dialog");
  const lefts: number[] = [];
  for (const tab of TABS) {
    await dialog.getByRole("button", { name: tab, exact: true }).click();
    const heading = dialog.getByRole("heading", { level: 3 }).first();
    await expect(heading).toBeVisible();
    lefts.push(Math.round((await heading.boundingBox())!.x));
    const slug = tab.split(" ")[0].toLowerCase();
    await dialog.screenshot({ path: `logs/e2e/settings-${slug}.png`, animations: "disabled" });
    expect(
      await dialog.evaluate((el) => {
        const body = el.querySelector<HTMLElement>("[data-settings-body]") ?? el;
        return body.scrollWidth <= body.clientWidth + 1;
      }),
    ).toBe(true);
  }
  // Every page starts its title at the same inset.
  expect(new Set(lefts).size).toBe(1);
});
