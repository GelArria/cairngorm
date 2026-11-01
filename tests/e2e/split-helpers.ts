// Split controls of the workspace tab bar: "Split" picks what joins the group,
// "Arrange split" re-lays the group on screen.
import type { Page } from "@playwright/test";

export type ArrangeLabel = "Auto (fit the area)" | "Side by side" | "Stacked" | "Mosaic grid";

export function splitButton(page: Page) {
  return page.getByRole("button", { name: /^(Split|Add to split)$/ });
}

/** A new terminal joins the active tab's split group (or pairs with it). */
export async function splitNew(page: Page) {
  await splitButton(page).first().click();
  await page.getByRole("menuitem", { name: "New terminal", exact: true }).click();
}

/** An open loose tab (by title) joins the active tab's split group. */
export async function splitWith(page: Page, title: string) {
  await splitButton(page).first().click();
  await page.getByRole("menuitem").filter({ hasText: title }).first().click();
}

export async function arrange(page: Page, label: ArrangeLabel) {
  await page.getByRole("button", { name: "Arrange split", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
