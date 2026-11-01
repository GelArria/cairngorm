import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

const fullPath = "C:/Users/Dev/.agents/skills/review/SKILL.md";
const original = "---\nname: review\ndescription: Review changes.\n---\n\n# Review\n";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await browser.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    (window as any).__FILE_WRITES__ = [];
    internals.invoke = (cmd: string, args: any) => {
      if (cmd === "fs_write_file") {
        if ((window as any).__FAIL_SAVE__) return Promise.reject("Permission denied");
        (window as any).__FILE_WRITES__.push(args);
        return Promise.resolve();
      }
      return invoke(cmd, args);
    };
  });
  await browser.evaluate(
    ({ fullPath, original }) => {
      window.dispatchEvent(
        new CustomEvent("editor-open-file", {
          detail: {
            title: "SKILL.md",
            path: ["SKILL.md"],
            fullPath,
            content: original,
            extension: "md",
          },
        }),
      );
    },
    { fullPath, original },
  );
  await expect(screen.getByTestId("markdown-viewer")).toBeVisible();
  await screen.getByRole("button", "Edit", { exact: true }).tap();
  await expect(browser.locator(".cm-content")).toBeVisible();
});

test("an edited skill has a visible Save button that persists its full contents", async ({
  app,
  browser,
  screen,
}) => {
  const updated = original + "\nCheck the diff before reviewing.\n";
  await browser.locator(".cm-content").fill(updated);
  const save = screen.getByRole("button", "Save", { exact: true });
  await expect(save).toBeVisible();
  await expect(save).toBeEnabled();
  await app.screenshot("skill-unsaved");
  await save.tap();
  await expect
    .poll(() => browser.evaluate(() => (window as any).__FILE_WRITES__))
    .toEqual([{ path: fullPath, content: updated }]);
  await expect(save).toBeDisabled();
  await app.screenshot("skill-saved");
});

test("the keyboard shortcut still saves the edited skill", async ({ browser, screen }) => {
  const updated = original + "\nSaved with the keyboard.\n";
  const editor = browser.locator(".cm-content");
  await editor.fill(updated);
  await editor.press("Control+s");
  await expect
    .poll(() => browser.evaluate(() => (window as any).__FILE_WRITES__))
    .toEqual([{ path: fullPath, content: updated }]);
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
});

test("a failed save keeps the edited skill and allows retry", async ({ browser, screen }) => {
  const updated = original + "\nKeep this unsaved change.\n";
  await browser.locator(".cm-content").fill(updated);
  await browser.evaluate(() => {
    (window as any).__FAIL_SAVE__ = true;
  });
  const save = screen.getByRole("button", "Save", { exact: true });
  await save.tap();
  await expect(screen.getByRole("alert")).toContainText("Permission denied");
  await expect(browser.locator(".cm-content")).toContainText("Keep this unsaved change.");
  await expect(save).toBeEnabled();
  await browser.evaluate(() => {
    (window as any).__FAIL_SAVE__ = false;
  });
  await browser.locator(".cm-content").press("Control+s");
  await expect(save).toBeDisabled();
  await expect(screen.getByRole("alert")).toHaveCount(0);
});
