import { test, expect } from "./fixtures";
import { arrange, splitNew, splitWith } from "./split-helpers";

const visiblePanes = (app: import("@playwright/test").Page) =>
  app.locator("[data-pane-id]:visible");

test("split menu builds a group from chosen tabs; loose tabs stay out", async ({ app }) => {
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal" })
    .click();
  const title = await app.getByRole("tab", { selected: true }).getAttribute("aria-label");
  await expect(app.locator(`span[title="${title}"]`)).toHaveCount(0);
  await expect(app.getByRole("button", { name: "Arrange split", exact: true })).toBeDisabled();

  // Two more terminals open as loose tabs (shown alone, not merged into a grid)
  const bar = app.getByRole("tablist", { name: "Workspace tabs" });
  for (let i = 0; i < 2; i++) {
    await bar.getByRole("button", { name: "New terminal", exact: true }).click();
    await app.getByRole("menuitem", { name: "Default shell", exact: true }).click();
  }
  await expect(bar.getByRole("tab")).toHaveCount(3);
  await expect(visiblePanes(app)).toHaveCount(1);

  // First pair: tab 1 + the chosen tab 3; tab 2 stays outside the group
  await bar.getByRole("tab").first().click();
  const third = (await bar.getByRole("tab").nth(2).getAttribute("aria-label"))!;
  await splitWith(app, third);
  await expect(visiblePanes(app)).toHaveCount(2);
  await expect(bar.locator("[data-split-group] [role=tab]")).toHaveCount(2);
  await app.takeScreenshot("split-menu-pair");
  // The loose tab is offered in the split menu
  await app.getByRole("button", { name: "Add to split", exact: true }).click();
  await expect(app.getByRole("menuitem")).toHaveCount(2);
  await app.takeScreenshot("split-menu-open");
  await app.keyboard.press("Escape");

  // A new terminal joins: 3 panes, auto arrangement (one large + two stacked)
  await splitNew(app);
  await expect(visiblePanes(app)).toHaveCount(3);
  // A 4th joins: 2 × 2 mosaic filling the area
  await splitNew(app);
  await expect(visiblePanes(app)).toHaveCount(4);
  await app.takeScreenshot("split-menu-mosaic");

  // Selecting the loose tab shows it alone; selecting a member brings the group back
  await bar.locator("[role=tab]:not([data-split-group] [role=tab])").first().click();
  await expect(visiblePanes(app)).toHaveCount(1);
  await app.takeScreenshot("split-group-parked");
  await bar.locator("[data-split-group] [role=tab]").first().click();
  await expect(visiblePanes(app)).toHaveCount(4);

  await arrange(app, "Side by side");
  await expect(visiblePanes(app)).toHaveCount(4);
  await app.takeScreenshot("split-arrange-columns");

  // The loose tab starts a second group: each group carries its own colour
  await bar.locator("[role=tab]:not([data-split-group] [role=tab])").first().click();
  await splitNew(app);
  await expect(bar.locator("[data-split-group]")).toHaveCount(2);
  await app.takeScreenshot("split-two-groups");

  // Group boundaries and chip edges stay flush, including in an overflowing strip.
  for (const width of [1440, 800]) {
    await app.setViewportSize({ width, height: 900 });
    const geometry = await bar.locator("[data-split-group]").evaluateAll((groups) =>
      groups.map((group, index) => {
        const bounds = group.getBoundingClientRect();
        const chip = group.querySelector("[data-group-chip]")!;
        const button = chip.getBoundingClientRect();
        const tab = group.querySelector("[data-tab-id]")!.getBoundingClientRect();
        const previous = groups[index - 1]?.getBoundingClientRect();
        return {
          size: [button.width, button.height],
          radius: getComputedStyle(chip).borderRadius,
          insets: [
            button.left - bounds.left,
            button.top - bounds.top,
            bounds.bottom - button.bottom,
          ],
          tabGap: tab.left - button.right,
          groupGap: previous ? bounds.left - previous.right : 0,
        };
      }),
    );
    for (const group of geometry) {
      expect(group).toEqual({
        size: [36, 36],
        radius: "0px",
        insets: [0, 0, 0],
        tabGap: 0,
        groupGap: 0,
      });
    }
  }
  await app.setViewportSize({ width: 1440, height: 900 });

  // The group chip shows the group number and recolours the group
  await bar.getByRole("button", { name: "Group 2 options" }).click();
  await app.getByRole("menuitemradio", { name: "Teal" }).click();
  await expect(bar.getByRole("button", { name: "Group 2 options" })).toHaveCSS(
    "background-color",
    "rgb(91, 173, 182)",
  );
  // Tab labels contain titles only; numbering belongs to group chips.
  for (const tab of await bar.getByRole("tab").all()) {
    expect((await tab.innerText()).trim()).toBe(await tab.getAttribute("aria-label"));
  }
  await expect(bar.locator("[data-group-chip]")).toHaveText(["1", "2"]);
  await bar.screenshot({ path: "logs/e2e/split-groups-bar.png", scale: "device" });
  await app.takeScreenshot("split-group-recolored");
});
