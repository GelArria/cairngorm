import { test, expect, SEED_INIT } from "./fixtures";

const animation = (el: Element) => getComputedStyle(el).animationName;

test("saved Always preference enables icons, transitions and dialog entrances under OS reduced motion", async ({
  app,
}) => {
  await app.emulateMedia({ reducedMotion: "reduce" });
  await app.evaluate(() => {
    localStorage.setItem("show-splash", "false");
    localStorage.setItem(
      "gem-display",
      JSON.stringify({ heroCard: true, frozen: false, forceMotion: true }),
    );
  });
  await app.reload();
  const toggle = app.locator('[data-testid="sidebar-collapse"]');
  await expect
    .poll(() => toggle.evaluate((el) => getComputedStyle(el).transitionDuration))
    .not.toBe("0s");
  await toggle.hover();
  const icon = toggle.locator(".ai-c1");
  await expect.poll(() => icon.evaluate(animation)).toBe("ai-run");
  const before = await icon.evaluate((el) => getComputedStyle(el).transform);
  await expect.poll(() => icon.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = app.locator('[data-testid="settings-dialog"]');
  await expect.poll(() => settings.evaluate(animation)).toBe("enter");
  await settings.screenshot({ path: "logs/e2e/app-motion-settings.png" });
});

test("Always/System updates live, persists and syncs to other windows", async ({ app }) => {
  await app.emulateMedia({ reducedMotion: "reduce" });
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  const group = app.getByRole("group", { name: "Animations", exact: true });
  await expect(group.getByRole("button", { name: "System", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await group.getByRole("button", { name: "Always", exact: true }).focus();
  await app.keyboard.press("Enter");
  await expect(group.getByRole("button", { name: "Always", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(app.locator("html")).toHaveAttribute("data-force-motion", "");
  await app.reload();
  await expect(app.locator("html")).toHaveAttribute("data-force-motion", "");
  const other = await app.context().newPage();
  try {
    await other.addInitScript(SEED_INIT);
    await other.goto("/");
    await expect(other.locator("html")).toHaveAttribute("data-force-motion", "");
    await app.getByRole("button", { name: "Settings", exact: true }).click();
    await group.getByRole("button", { name: "System", exact: true }).focus();
    await app.keyboard.press("Space");
    await expect(app.locator("html")).not.toHaveAttribute("data-force-motion");
    await expect(other.locator("html")).not.toHaveAttribute("data-force-motion");
    await app.keyboard.press("Escape");
    const toggle = app.locator('[data-testid="sidebar-collapse"]');
    await toggle.hover();
    await expect.poll(() => toggle.locator(".ai-c1").evaluate(animation)).toBe("none");
    await expect
      .poll(() => toggle.evaluate((el) => getComputedStyle(el).transitionDuration))
      .toBe("0s");
  } finally {
    await other.close();
  }
});

test("splash geometry and lettering animate under reduced motion with a saved override", async ({
  app,
}) => {
  await app.emulateMedia({ reducedMotion: "reduce" });
  await app.evaluate(() => {
    localStorage.setItem("show-splash", "true");
    localStorage.setItem(
      "gem-display",
      JSON.stringify({ heroCard: true, frozen: false, forceMotion: true }),
    );
  });
  await app.reload();
  const splash = app.locator('[data-testid="splash"]');
  const gem = splash.locator("svg");
  await expect(gem.locator("line").first()).toBeAttached();
  const before = await gem.evaluate((el) => el.innerHTML);
  await expect.poll(() => gem.evaluate((el) => el.innerHTML), { timeout: 1000 }).not.toBe(before);
  await expect(splash.locator(".splash-letter").first()).toHaveCSS("animation-name", "splash-rise");
  await app.waitForTimeout(2300);
  await splash.screenshot({ path: "logs/e2e/app-motion-splash.png" });
  await expect(splash).toHaveCount(0, { timeout: 5000 });
});
