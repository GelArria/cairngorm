import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (location.protocol.startsWith("http")) {
      localStorage.setItem("sidebar-side", "left");
      localStorage.setItem("show-splash", "false");
    }
  });
  await app.open();
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect(browser.locator("[data-pane-id]").first()).toBeVisible();
});

for (const edge of ["Top", "Bottom"]) {
  test(`${edge} dock meets the terminal area without a blank band`, async ({
    app,
    browser,
    screen,
  }) => {
    await screen.getByTestId("header-sidebar-side-toggle").tap();
    await screen.getByRole("menuitemradio", edge, { exact: true }).tap();
    await expect(screen.getByTestId("sidebar-dock")).toHaveAttribute(
      "data-side",
      edge.toLowerCase(),
    );
    for (const count of [1, 2]) {
      if (count === 2) {
        await screen.getByRole("button", "Split", { exact: true }).tap();
        await screen.getByRole("menuitem", "New terminal", { exact: true }).tap();
        await screen.getByRole("button", "Arrange split", { exact: true }).tap();
        await screen.getByRole("menuitem", "Stacked", { exact: true }).tap();
      }
      await expect(browser.locator("[data-pane-id]:visible")).toHaveCount(count);
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 2639, height: 1086 },
      ]) {
        await browser.setViewport(viewport);
        await expect
          .poll(() =>
            browser.evaluate((edge) => {
              const dock = document
                .querySelector('[data-testid="sidebar-dock"]')!
                .getBoundingClientRect();
              const pane = document.querySelector("[data-pane-id]")!;
              const area = pane.parentElement!.parentElement!.getBoundingClientRect();
              return {
                dockGap: edge === "Top" ? area.top - dock.bottom : dock.top - area.bottom,
                outerGap: edge === "Top" ? innerHeight - area.bottom : area.top - 38,
              };
            }, edge),
          )
          .toEqual({ dockGap: 0, outerGap: 0 });
      }
    }
    await app.screenshot(`dock-${edge.toLowerCase()}-no-gap`);
  });
}
