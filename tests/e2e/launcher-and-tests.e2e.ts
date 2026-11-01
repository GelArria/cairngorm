import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

// Saved settings live in cairngorm.json; the Tauri mock keeps its text in localStorage.
beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (!location.protocol.startsWith("http")) return;
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__launchCalls = [];
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      w.__launchCalls.push({ cmd, args });
      if (cmd === "detect_agent_clis")
        return Promise.resolve([{ id: "pi", name: "Pi", program: "C:/CLI Tools/pi.js" }]);
      return original(cmd, args);
    };
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
});

test("saves literal launch arguments and exposes detected CLIs in the launcher", async ({
  app,
  browser,
  screen,
}) => {
  await browser.locator("body").press("Control+,");
  const settings = screen.getByTestId("settings-dialog");
  await expect(settings.getByTestId("terminal-settings")).toBeVisible();
  await screen.getByRole("button", "Add Pi profile").tap();
  const profile = screen.getByRole("dialog", "Launch profile");
  await profile.getByLabel("Name").fill("Pi workspace");
  await profile.getByLabel("Executable").fill('"C:/CLI Tools/pi.js"');
  const args = ["folder with spaces", "literal; & 'quoted'", ""];
  for (let i = 0; i < args.length; i++) {
    await profile.getByRole("button", "Add argument").tap();
    await profile.getByLabel(`Argument ${i + 1}`).fill(args[i]);
  }
  await app.screenshot("launcher-profile-literal-arguments");
  await profile.getByRole("button", "Save profile").tap();
  await expect(profile).toHaveCount(0);
  const saved = await browser.evaluate(
    () =>
      JSON.parse(localStorage.getItem("__mock_cairngorm_json")!.replace(/^\s*\/\/.*$/gm, ""))
        .launchProfiles[0],
  );
  expect(saved.args).toEqual(args);
  await browser.locator("body").press("Escape");
  await screen.getByRole("tablist", "Workspace tabs").getByRole("button", "New terminal").tap();
  await expect(screen.getByRole("menuitem", "Pi", { exact: true })).toBeVisible();
  await screen.getByRole("menuitem", "Pi workspace", { exact: true }).tap();
  await expect
    .poll(() =>
      browser.evaluate(
        () =>
          (window as any).__launchCalls.filter((c: any) => c.cmd === "resolve_terminal_profile")
            .length,
      ),
    )
    .toBe(1);
  const resolved = await browser.evaluate(
    () =>
      (window as any).__launchCalls.find((c: any) => c.cmd === "resolve_terminal_profile").args
        .profile,
  );
  expect(resolved.args).toEqual(args);
  await expect(screen.getByRole("tab", "Pi workspace")).toBeVisible();
  await browser.locator("body").press("Control+,");
  await screen.getByRole("button", "Edit Pi workspace").tap();
  await profile.getByLabel("Name").fill("Pi edited");
  await profile.getByRole("button", "Save profile").tap();
  await screen.getByRole("button", "Detect CLIs again").tap();
  const edited = await browser.evaluate(
    () =>
      JSON.parse(localStorage.getItem("__mock_cairngorm_json")!.replace(/^\s*\/\/.*$/gm, ""))
        .launchProfiles[0],
  );
  expect(edited.id).toBe(saved.id);
  expect(edited.args).toEqual(args);
  expect(edited.name).toBe("Pi edited");
  await app.restart();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await browser.locator("body").press("Control+,");
  await expect(screen.getByRole("button", "Edit Pi edited")).toBeVisible();
  await screen.getByRole("button", "Delete Pi edited").tap();
  expect(
    await browser.evaluate(
      () =>
        JSON.parse(localStorage.getItem("__mock_cairngorm_json")!.replace(/^\s*\/\/.*$/gm, ""))
          .launchProfiles,
    ),
  ).toEqual([]);
  await browser.locator("body").press("Escape");
  await expect(screen.getByRole("tab", "Pi workspace")).toBeVisible();
  expect(
    await browser.evaluate(
      () => (window as any).__launchCalls.filter((c: any) => c.cmd === "pty_kill").length,
    ),
  ).toBe(0);
});

test("a failed CLI launch leaves an actionable error and retains the saved profile", async ({
  app,
  browser,
  screen,
}) => {
  await browser.locator("body").press("Control+,");
  await screen.getByRole("button", "Add profile").tap();
  const profile = screen.getByRole("dialog", "Launch profile");
  await profile.getByLabel("Name").fill("Missing CLI");
  await profile.getByLabel("Executable").fill("C:/Missing CLI/agent.exe");
  await profile.getByRole("button", "Save profile").tap();
  await browser.locator("body").press("Escape");
  await browser.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) =>
      cmd === "resolve_terminal_profile"
        ? Promise.reject("CLI executable not found. Check the profile path.")
        : invoke(cmd, args);
  });
  await screen.getByRole("tablist", "Workspace tabs").getByRole("button", "New terminal").tap();
  await screen.getByRole("menuitem", "Missing CLI", { exact: true }).tap();
  const error = screen.getByRole("dialog", "CLI could not start");
  await expect(error).toBeVisible();
  await expect(error.getByRole("alert")).toContainText("CLI executable not found");
  await app.screenshot("launcher-visible-error-retained-profile");
  expect(
    await browser.evaluate(
      () =>
        JSON.parse(localStorage.getItem("__mock_cairngorm_json")!.replace(/^\s*\/\/.*$/gm, ""))
          .launchProfiles[0].name,
    ),
  ).toBe("Missing CLI");
  expect(
    await browser.evaluate(
      () => (window as any).__launchCalls.filter((c: any) => c.cmd === "pty_ensure").length,
    ),
  ).toBe(0);
});

test("hides Tests without deleting their pane and restores filters through both entry points", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect
    .poll(() =>
      browser.evaluate(() =>
        (window as any).__launchCalls.some((c: any) => c.cmd === "pty_ensure"),
      ),
    )
    .toBe(true);
  await browser.evaluate(async () => {
    const session = (window as any).__launchCalls.find((c: any) => c.cmd === "pty_ensure").args
      .sessionId;
    const observer = await import(/* @vite-ignore */ "/tests/mocks/pty-test-observer.ts");
    await observer.output(
      session,
      "Running 2 tests using 1 worker\n ✓ 1 passing example (1s)\n ✘ 2 failing example (1s)\n",
    );
  });
  const pane = screen.getByTestId("test-pane");
  await expect(pane).toBeVisible();
  await pane.getByRole("button", "Failed only").tap();
  await pane.getByLabel("Filter tests").fill("failing");
  const identity = await browser.evaluate(() => {
    const element = document.querySelector('[data-testid="test-pane"]')!;
    (window as any).__originalTestPane = element;
    return element.closest("[data-pane-id]")!.getAttribute("data-pane-id");
  });
  await screen.getByTestId("header-test-auto-open").tap();
  await screen.getByRole("menuitem", "Hide open test views").tap();
  await expect(pane).toBeHidden();
  await expect(screen.getByRole("tab")).toHaveCount(1);
  await screen.getByTestId("header-test-auto-open").tap();
  await screen.getByRole("menuitem", "Show hidden test views").tap();
  await expect(screen.getByRole("tab")).toHaveCount(2);
  await screen.getByRole("tab", /^Tests ·/).tap();
  await expect(pane).toBeVisible();
  await expect(pane.getByLabel("Filter tests")).toHaveValue("failing");
  await expect(pane.getByRole("button", "Failed only")).toHaveAttribute("aria-pressed", "true");
  expect(
    await browser.evaluate(
      () =>
        document.querySelector('[data-testid="test-pane"]') === (window as any).__originalTestPane,
    ),
  ).toBe(true);
  await app.screenshot("tests-restored-with-filters");
  await screen.getByTestId("header-test-auto-open").tap();
  await screen.getByRole("menuitem", "Hide open test views").tap();
  await screen.getByRole("tab").secondaryTap();
  await screen.getByRole("menuitem", "Open test browser").tap();
  await expect(pane).toBeVisible();
  expect(
    await browser.evaluate(() =>
      document
        .querySelector('[data-testid="test-pane"]')!
        .closest("[data-pane-id]")!
        .getAttribute("data-pane-id"),
    ),
  ).toBe(identity);
  await expect(pane.getByLabel("Filter tests")).toHaveValue("failing");
  const kills = await browser.evaluate(
    () => (window as any).__launchCalls.filter((c: any) => c.cmd === "pty_kill").length,
  );
  expect(kills).toBe(0);
});
