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
  await expect(screen.getByTestId("sidebar")).toBeVisible();
});

test("calendar stays in the sidebar, edits events and follows all four edges", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  const terminal = browser.locator("[data-pane-id]").first();
  await expect(terminal).toBeVisible();
  const paneId = await terminal.getAttribute("data-pane-id");
  await expect(screen.getByTestId("mode-chat")).toHaveCount(0);
  // The shared SQL seed is read-only; keep this test's created event across reloads.
  await browser.evaluate(() => {
    const api = window.__TAURI_INTERNALS__;
    const original = api.invoke;
    let row: Record<string, unknown> | null = null;
    api.invoke = (cmd, args) => {
      const query = String(args?.query ?? "");
      const values = args?.values as unknown[];
      if (cmd === "plugin:sql|execute" && query.includes("INSERT INTO calendar_events")) {
        row = Object.fromEntries(
          ["id", "title", "date", "end_date", "start_time", "end_time", "color", "description"].map(
            (key, i) => [key, values[i]],
          ),
        );
        return Promise.resolve([1, 1]);
      }
      if (cmd === "plugin:sql|execute" && query.includes("UPDATE calendar_events") && row) {
        row = { ...row, title: values[0] };
        return Promise.resolve([1, 1]);
      }
      if (cmd === "plugin:sql|select" && /FROM\s+calendar_events/i.test(query) && row) {
        return Promise.resolve([row]);
      }
      return original(cmd, args);
    };
  });
  await screen.getByTestId("mode-calendar").tap();
  const calendar = screen.getByTestId("calendar-view");
  await expect(calendar).toBeVisible();
  await expect(screen.getByTestId("sidebar").getByTestId("calendar-view")).toBeVisible();
  await expect(terminal).toBeVisible();
  await calendar.getByRole("radio", "Calendar events").tap();
  await calendar.getByRole("button", "New event", { exact: true }).tap();
  const form = screen.getByRole("dialog", "Add event");
  await expect(form).toBeVisible();
  await form.getByLabel("Title").fill("Sidebar planning");
  await form.getByRole("button", "Add event", { exact: true }).tap();
  await expect(form).toBeHidden();
  await calendar.getByText("Sidebar planning", { exact: true }).tap();
  const edit = screen.getByRole("dialog", "Edit event");
  await edit.getByLabel("Title").fill("Sidebar planning updated");
  await edit.getByRole("button", "Save", { exact: true }).tap();
  await expect(calendar.getByText("Sidebar planning updated", { exact: true })).toBeVisible();
  await app.screenshot("calendar-sidebar-left");

  for (const edge of ["Right", "Top", "Bottom"]) {
    await screen.getByTestId("header-sidebar-side-toggle").tap();
    await screen.getByRole("menuitemradio", edge, { exact: true }).tap();
    const sidebar = screen.getByTestId("sidebar");
    await expect(sidebar).toHaveAttribute("data-side", edge.toLowerCase());
    await expect(calendar).toBeVisible();
    await expect(terminal).toBeVisible();
    expect(await terminal.getAttribute("data-pane-id")).toBe(paneId);
    const overflow = await browser.evaluate(() => {
      const region = document.querySelector<HTMLElement>('[aria-label="Monthly calendar"]')!;
      return region.scrollWidth - region.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await app.screenshot(`calendar-sidebar-${edge.toLowerCase()}`);
    if (edge !== "Right") {
      await calendar.getByRole("button", "Next month").focus();
      await calendar.getByRole("button", "Next month").press("Escape");
      await expect(sidebar).toBeHidden();
      await expect(terminal).toBeVisible();
      await screen.getByTestId("sidebar-dock").getByTestId("mode-calendar").tap();
    }
  }
  await browser.setViewport({ width: 320, height: 720 });
  await expect(calendar).toBeVisible();
  await expect(calendar.getByRole("button", "New event", { exact: true })).toBeVisible();
  const fits = await browser.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#sidebar-dock-panel")!;
    return (
      panel.scrollWidth <= panel.clientWidth && panel.getBoundingClientRect().right <= innerWidth
    );
  });
  expect(fits).toBe(true);
  await app.screenshot("calendar-sidebar-portrait");
});

test("collapsed Calendar and its shortcut open the panel rather than hide terminals", async ({
  browser,
  screen,
}) => {
  await screen.getByTestId("sidebar-collapse").tap();
  await screen.getByTestId("rail-calendar").tap();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await expect(screen.getByTestId("calendar-view")).toBeVisible();
  await screen.getByTestId("sidebar-files-toggle").tap();
  await expect(screen.getByTestId("calendar-view")).toBeHidden();
  await screen.getByTestId("sidebar-files-toggle").tap();
  await expect(screen.getByTestId("project-terminals")).toBeVisible();
  await screen.getByTestId("sidebar-collapse").tap();
  await browser.evaluate(() =>
    window.dispatchEvent(new CustomEvent("app-open-module", { detail: "calendar" })),
  );
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await expect(screen.getByTestId("calendar-view")).toBeVisible();
});

test("Back restores Calendar over competing panels and the Git footer is exclusive", async ({
  browser,
  screen,
}) => {
  await browser.evaluate(async () => {
    const url = "/src/common/navigation/nav-history.ts";
    const nav = await import(/* @vite-ignore */ url);
    const state = window as typeof window & { navRecorded?: boolean };
    nav.subscribeNav(() => {
      state.navRecorded = true;
    });
  });
  for (const toggle of ["sidebar-files-toggle", "sidebar-git-toggle"]) {
    await browser.evaluate(() => {
      (window as typeof window & { navRecorded?: boolean }).navRecorded = false;
    });
    await screen.getByTestId("mode-calendar").tap();
    await expect(screen.getByTestId("calendar-view")).toBeVisible();
    await expect
      .poll(() =>
        browser.evaluate(() => (window as typeof window & { navRecorded?: boolean }).navRecorded),
      )
      .toBe(true);
    await browser.evaluate(() => {
      (window as typeof window & { navRecorded?: boolean }).navRecorded = false;
    });
    await screen.getByTestId(toggle).tap();
    await expect(screen.getByTestId("calendar-view")).toBeHidden();
    await expect
      .poll(() =>
        browser.evaluate(() => (window as typeof window & { navRecorded?: boolean }).navRecorded),
      )
      .toBe(true);
    await screen.getByRole("button", "Back", { exact: true }).tap();
    await expect(screen.getByTestId("calendar-view")).toBeVisible();
    await expect(screen.getByTestId(toggle)).toHaveAttribute("aria-pressed", "false");
    await screen.getByTestId("mode-calendar").tap();
    await expect(screen.getByTestId("calendar-view")).toBeHidden();
  }
  await screen.getByTestId("mode-calendar").tap();
  await screen.getByRole("button", /^Open Git:/).tap();
  await expect(screen.getByTestId("sidebar-git-toggle")).toHaveAttribute("aria-pressed", "true");
  await screen.getByTestId("sidebar-git-toggle").tap();
  await expect(screen.getByTestId("project-terminals")).toBeVisible();
  await expect(screen.getByTestId("calendar-view")).toBeHidden();
});
