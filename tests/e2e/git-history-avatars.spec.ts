import { test, expect } from "./fixtures";
import path from "node:path";

// Cached public profile photo keeps the visual test independent of GitHub availability.
test("History shows author photos and safe fallbacks on every sidebar edge", async ({ app }) => {
  await app.route("https://github.com/gelarria.png**", (route) =>
    route.fulfill({
      contentType: "image/png",
      path: path.resolve("tests/e2e/fixtures/git-author-avatar.png"),
    }),
  );
  await app.route("https://www.gravatar.com/avatar/**", (route) => route.fulfill({ status: 404 }));
  await app.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = (cmd: string, args: unknown) =>
      cmd === "git_log"
        ? Promise.resolve([
            {
              hash: "abc1234",
              author: "GelArria",
              email: "GelArria@users.noreply.github.com",
              time: "12 minutes ago",
              subject: "Add CodeMirror language data and refine terminal layout",
            },
            {
              hash: "def5678",
              author: "Bob",
              email: "bob@example.invalid",
              time: "1 hour ago",
              subject: "Keep pending changes visible with long commit drafts",
            },
            {
              hash: "f00ba42",
              author: "Local User",
              time: "2 hours ago",
              subject: "Support four navigation positions",
            },
          ])
        : original(cmd, args);
  });
  for (const label of ["Left", "Right", "Top", "Bottom"]) {
    await app.getByTestId("header-sidebar-side-toggle").click();
    await app.getByRole("menuitemradio", { name: label, exact: true }).click();
    const horizontal = label === "Top" || label === "Bottom";
    await app
      .locator(
        horizontal
          ? '[data-testid="sidebar-dock"] [data-testid="sidebar-git-toggle"]'
          : '[data-testid="sidebar"] [data-testid="sidebar-git-toggle"]',
      )
      .click();
    await app.getByRole("tab", { name: "History", exact: true }).click();
    const history = app.getByTestId("git-history");
    const photo = history.getByRole("img", { name: "Avatar of GelArria", exact: true });
    await expect(photo).toHaveAttribute("src", "https://github.com/gelarria.png?size=64");
    await expect
      .poll(() => photo.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    await expect(history.getByRole("img", { name: "Avatar of Bob", exact: true })).toHaveText("B");
    await expect(
      history.getByRole("img", { name: "Avatar of Local User", exact: true }),
    ).toHaveText("L");
    await history.screenshot({ path: `logs/e2e/git-history-avatars-${label.toLowerCase()}.png` });
    await app
      .locator(
        horizontal
          ? '[data-testid="sidebar-dock"] [data-testid="sidebar-git-toggle"]'
          : '[data-testid="sidebar"] [data-testid="sidebar-git-toggle"]',
      )
      .click();
  }
});
