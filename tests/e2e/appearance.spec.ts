import { test, expect, openFileInGrid } from "./fixtures";
import type { Page } from "@playwright/test";
import { THEME_PRESETS } from "../../src/appearance/model/presets";

// Counts follow the shipped library, which grows (gemstone palettes were added on 10-24).
const light = THEME_PRESETS.filter((theme) => theme.mode === "light");
const lightContrast = light.filter((theme) => theme.name.toLowerCase().includes("contrast"));

async function appearance(app: Page) {
  await app.getByTestId("header-settings").click();
  await app.getByRole("button", { name: "Themes & colors", exact: true }).click();
  await expect(app.getByTestId("appearance-settings")).toBeVisible();
}

test.beforeEach(async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
});

test("theme library filters, applies all palettes, and persists a white theme across reload", async ({
  app,
}) => {
  // Every palette is applied one by one.
  test.setTimeout(30_000 + THEME_PRESETS.length * 500);
  await appearance(app);
  const panel = app.getByTestId("appearance-settings");
  await expect(panel.getByTestId(/^theme-/)).toHaveCount(THEME_PRESETS.length);
  await panel.getByRole("button", { name: "Light", exact: true }).click();
  await expect(panel.getByTestId(/^theme-/)).toHaveCount(light.length);
  await app.getByLabel("Search themes").fill("contrast");
  await expect(panel.getByTestId(/^theme-/)).toHaveCount(lightContrast.length);
  expect(lightContrast.map((theme) => theme.id)).toContain("light-contrast");
  await app.getByTestId("theme-light-contrast").click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light-contrast");
  await app.getByLabel("Search themes").fill("");
  await panel.getByRole("button", { name: "All", exact: true }).click();
  for (const button of await panel.getByTestId(/^theme-/).all()) {
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await app.getByTestId("theme-white").click();
  await expect(app.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(app.getByTestId("settings-dialog")).toHaveCSS(
    "background-color",
    "rgb(248, 249, 251)",
  );
  await expect(app.getByTestId("active-project-name")).toHaveCSS("color", "rgb(24, 24, 27)");
  await app.takeScreenshot("appearance-white");
  await app.keyboard.press("Escape");
  await app.getByTestId("header-menu").click();
  await expect(app.getByRole("menu")).toHaveCSS("background-color", "rgb(248, 249, 251)");
  await app.keyboard.press("Escape");
  await app.getByTestId("active-project-card").click({ button: "right" });
  await app.getByRole("menuitem", { name: "Change Appearance…", exact: true }).click();
  const stones = app.getByTestId("background-dialog");
  await expect(stones.getByRole("button", { name: "Ruby", exact: true }).locator("span")).toHaveCSS(
    "color",
    "rgb(24, 24, 27)",
  );
  await stones.getByRole("button", { name: "Ruby", exact: true }).click();
  await expect(stones.getByRole("button", { name: "Ruby", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await app.takeScreenshot("appearance-white-stones");
  await app.keyboard.press("Escape");
  await app.reload();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "white");
  await expect(app.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("custom colors and keyboard sliders apply independently, persist and reset", async ({
  app,
}) => {
  await appearance(app);
  await app.getByTestId("theme-paper").click();
  const before = await app.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
  await app.getByLabel("Text color", { exact: true }).fill("#302010");
  await app.getByLabel("Icons & ticks color", { exact: true }).fill("#805020");
  await app.getByLabel("Borders & lines color", { exact: true }).fill("#8a7050");
  await app.getByLabel("Accent color", { exact: true }).fill("#704020");
  await expect(app.locator("body")).toHaveCSS("background-color", before);
  await expect(app.locator("body")).toHaveCSS("color", "rgb(48, 32, 16)");
  const icon = app.getByTestId("header-settings").locator("svg");
  await expect(icon).toHaveCSS("color", "rgb(128, 80, 32)");
  for (const name of [
    "UI contrast",
    "Background brightness",
    "Text brightness",
    "Icon & tick brightness",
    "Border & line visibility",
  ]) {
    const slider = app.getByRole("slider", { name, exact: true });
    await slider.focus();
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue("101");
  }
  await expect(icon).toHaveCSS("filter", "brightness(1.01)");
  await app.reload();
  await appearance(app);
  await expect(app.getByLabel("Text color", { exact: true })).toHaveValue("#302010");
  await expect(app.getByRole("slider", { name: "UI contrast", exact: true })).toHaveValue("101");
  await app.getByRole("button", { name: "Reset adjustments", exact: true }).click();
  await expect(app.getByLabel("Text color", { exact: true })).toHaveValue("#302b24");
  await expect(app.getByRole("slider", { name: "UI contrast", exact: true })).toHaveValue("100");
  await expect(icon).toHaveCSS("filter", "brightness(1)");
  await expect(app.locator("html")).not.toHaveAttribute("data-custom-icons");
  await app.takeScreenshot("appearance-paper-reset");
});

test("follows OS changes and synchronizes appearance to another window", async ({ app }) => {
  await app.emulateMedia({ colorScheme: "light" });
  await appearance(app);
  await app.getByTestId("theme-white").click();
  await app.getByRole("switch", { name: "Follow system theme" }).click();
  await app.emulateMedia({ colorScheme: "dark" });
  await expect(app.locator("html")).toHaveAttribute("data-theme", "cairngorm");
  await app.emulateMedia({ colorScheme: "light" });
  await expect(app.locator("html")).toHaveAttribute("data-theme", "white");
  const other = await app.context().newPage();
  try {
    // A detached error shell mounts outside App and still receives global tokens.
    await other.goto("/?detached=invalid");
    await expect(other.locator("html")).toHaveAttribute("data-theme", "white");
    await app.getByTestId("theme-nord").click();
    await expect(other.locator("html")).toHaveAttribute("data-theme", "nord");
    await expect(other.locator("html")).toHaveClass(/dark/);
  } finally {
    await other.close();
  }
});

test("theme changes restyle an open editor without losing its document", async ({ app }) => {
  await openFileInGrid(
    app,
    {
      title: "theme.ts",
      path: ["theme.ts"],
      content: 'const color = "Cairngorm";\n',
      extension: "ts",
    },
    ".cm-editor",
  );
  const editor = app.locator(".cm-editor");
  await expect(editor).toContainText("Cairngorm");
  await appearance(app);
  await app.getByTestId("theme-white").click();
  await expect(editor).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(editor).toHaveCSS("color", "rgb(24, 24, 27)");
  await app.keyboard.press("Escape");
  await expect(editor).toContainText('const color = "Cairngorm";');
  await app.takeScreenshot("appearance-white-editor");
  await appearance(app);
  await app.getByTestId("theme-nord").click();
  await expect(editor).toHaveCSS("background-color", "rgb(36, 43, 54)");
  await app.takeScreenshot("appearance-nord");
});

for (const width of [360, 1024]) {
  test(`appearance controls fit ${width}px and remain reachable`, async ({ app }) => {
    await app.setViewportSize({ width, height: 768 });
    await appearance(app);
    await app.getByTestId("theme-white").click();
    const panel = app.getByTestId("settings-dialog");
    expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await app.getByLabel("Borders & lines color", { exact: true }).fill("#8090a0");
    await app.getByRole("slider", { name: "Border & line visibility", exact: true }).focus();
    await app.keyboard.press("ArrowRight");
    await expect(
      app.getByRole("slider", { name: "Border & line visibility", exact: true }),
    ).toHaveValue("101");
    await app.takeScreenshot(`appearance-${width}`);
    await app.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });
}
