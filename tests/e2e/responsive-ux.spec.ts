import { test, expect, openFileInGrid } from "./fixtures";
import { splitNew } from "./split-helpers";

// Browser mocks verify layout and input; native PTY behavior is not simulated.
test.beforeEach(async ({ app }) => {
  await app.emulateMedia({ reducedMotion: "reduce" });
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
});

test("compact navigation remains reachable and restores desktop state", async ({ app }) => {
  await app.setViewportSize({ width: 375, height: 720 });
  await expect(app.getByTestId("sidebar-collapsed")).toBeVisible();
  await app.evaluate(() =>
    window.dispatchEvent(new CustomEvent("app-open-module", { detail: "files" })),
  );
  await expect(app.getByRole("dialog", { name: "Project navigation" })).toBeVisible();
  await expect(app.getByTestId("workspace-name")).toBeVisible();
  await app.keyboard.press("Escape");
  await app.getByTestId("rail-calendar").click();
  await expect(app.getByTestId("calendar-view")).toBeVisible();
  const navigation = app.getByRole("dialog", { name: "Project navigation" });
  await expect(navigation.getByTestId("mode-calendar")).toBeVisible();
  await app.screenshot({ path: "logs/e2e/responsive-navigation.png" });
  await app.keyboard.press("Escape");
  await expect(navigation).toHaveCount(0);
  await expect(app.getByTestId("rail-calendar")).toBeFocused();
  await app.getByTestId("rail-files").click();
  await expect(app.getByTestId("workspace-name")).toBeVisible();
  await app.keyboard.press("Escape");
  await app.getByTestId("rail-git").click();
  await expect(navigation.getByRole("tab", { name: "Changes 2", exact: true })).toBeVisible();
  await app.keyboard.press("Escape");
  await app.setViewportSize({ width: 1440, height: 900 });
  await expect(app.getByTestId("sidebar")).toBeVisible();
  await expect(app.getByTestId("sidebar-collapsed")).toHaveCount(0);
});

test("workspace tabs support keyboard selection, scrolling and close", async ({ app }) => {
  for (let i = 0; i < 7; i++) {
    await openFileInGrid(
      app,
      {
        title: `responsive-long-file-${i}.ts`,
        path: [`file-${i}.ts`],
        content: `// file ${i}`,
        extension: "ts",
      },
      ".cm-editor:visible",
    );
  }
  await app.setViewportSize({ width: 375, height: 720 });
  const list = app.getByRole("tablist", { name: "Workspace tabs" });
  const selected = list.getByRole("tab", { selected: true });
  await selected.focus();
  await app.keyboard.press("Home");
  await expect(list.getByRole("tab").first()).toBeFocused();
  await expect(list.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await app.keyboard.press("End");
  await expect(list.getByRole("tab").last()).toBeFocused();
  await app.keyboard.press("ArrowRight");
  await expect(list.getByRole("tab").first()).toBeFocused();
  await app.keyboard.press("ArrowLeft");
  await expect(list.getByRole("tab").last()).toBeFocused();
  await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await app.screenshot({ path: "logs/e2e/responsive-tabs.png" });
  const count = await list.getByRole("tab").count();
  await list
    .getByRole("tab")
    .last()
    .locator("..")
    .getByRole("button", { name: "Close tab", exact: true })
    .click();
  await expect(list.getByRole("tab")).toHaveCount(count - 1);
  await app.setViewportSize({ width: 1440, height: 900 });
  await app.screenshot({ path: "logs/e2e/responsive-desktop.png" });
});

test("split group tabs remain scrollable on a compact viewport", async ({ app }) => {
  await openFileInGrid(
    app,
    { title: "split-source.ts", path: ["split-source.ts"], content: "// split", extension: "ts" },
    ".cm-editor:visible",
  );
  await splitNew(app);
  await expect(app.locator("[data-split-group]")).toBeVisible();
  await app.setViewportSize({ width: 375, height: 720 });
  const list = app.getByRole("tablist", { name: "Workspace tabs" });
  await list.getByRole("tab", { selected: true }).focus();
  await app.keyboard.press("Home");
  await app.keyboard.press("End");
  const last = list.getByRole("tab").last();
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await expect(
    last.locator("..").getByRole("button", { name: "Close tab", exact: true }),
  ).toBeInViewport();
});

for (const width of [320, 768]) {
  test(`calendar and settings fit ${width}px without losing controls`, async ({ app }) => {
    await app.setViewportSize({ width, height: 640 });
    await app.getByRole("button", { name: "Calendar", exact: true }).click();
    await app.getByRole("radio", { name: "Calendar events" }).click();
    await expect(app.getByRole("button", { name: "Next month" })).toBeInViewport();
    await app.getByRole("button", { name: "Next month" }).click();
    await expect(app.getByRole("button", { name: "Today", exact: true })).toBeEnabled();
    await app.getByRole("button", { name: "Today", exact: true }).click();
    const month = app.getByRole("region", { name: "Monthly calendar" });
    await expect(month).toBeInViewport();
    await month.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const day = month.locator('button[aria-label^="New event on"]:not([disabled])').last();
    await day.focus();
    await app.keyboard.press("Enter");
    await expect(app.getByTestId("event-form")).toBeVisible();
    await app.keyboard.press("Escape");
    await month.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await app.screenshot({ path: `logs/e2e/responsive-calendar-${width}.png` });
    if (width < 768) {
      await app
        .getByRole("dialog", { name: "Project navigation" })
        .getByRole("button", { name: "Close", exact: true })
        .click();
    }
    await app.getByTestId("header-settings").click();
    const settings = app.getByTestId("settings-dialog");
    await expect(settings).toBeInViewport();
    await expect
      .poll(() =>
        settings.evaluate((el) =>
          Math.max(
            ...[el, ...el.querySelectorAll("section")].map(
              (node) => node.scrollWidth - node.clientWidth,
            ),
          ),
        ),
      )
      .toBeLessThanOrEqual(1);
    await settings.getByRole("button", { name: "Bigger", exact: true }).click();
    await expect(app.getByTestId("settings-font-size")).toHaveText("15px");
    await app.screenshot({ path: `logs/e2e/responsive-settings-${width}.png` });
    await app.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    expect(await app.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
