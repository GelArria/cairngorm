import { splitNew } from "./split-helpers";
import {
  test,
  expect,
  terminalText,
  inputBytes,
  startProbe,
  piTuiModule,
} from "./terminal-native-fixture";

// All keys/clicks go through the actual WebView2, xterm and Rust ConPTY.
test("shell control keys reach the PTY instead of app shortcuts", async ({ native: page }) => {
  for (const [key, hex] of [
    ["b", "02"],
    ["n", "0e"],
    ["s", "13"],
    ["w", "17"],
    ["r", "12"],
    ["p", "10"],
    ["a", "01"],
    ["e", "05"],
  ]) {
    const before = await inputBytes(page);
    await page.keyboard.press(`Control+${key}`);
    await expect.poll(() => inputBytes(page), { timeout: 2000 }).toBe(before + hex);
  }
});

test("spaces, tab, arrows and interruption stay unchanged", async ({ native: page }) => {
  let expected = await inputBytes(page);
  for (const [key, hex] of [
    ["Space", "20"],
    ["Space", "20"],
    ["Tab", "09"],
    ["ArrowLeft", "1b5b44"],
    ["ArrowRight", "1b5b43"],
    ["Backspace", "7f"],
    ["Control+c", "03"],
  ]) {
    await page.keyboard.press(key);
    expected += hex;
    await expect.poll(() => inputBytes(page)).toBe(expected);
  }
});

test("Ctrl+V and Shift+Insert paste exact whitespace without duplicate bytes", async ({
  native: page,
}) => {
  for (const key of ["Control+v", "Control+Shift+v", "Shift+Insert"]) {
    await page.evaluate(() => navigator.clipboard.writeText("a  b\nc"));
    const before = await inputBytes(page);
    await page.keyboard.press(key);
    // xterm normalizes clipboard LF to CR when the application has not enabled bracketed paste.
    await expect.poll(() => inputBytes(page)).toBe(before + "612020620d63");
  }
});

test("drag selection and double-click in split terminals never move or zoom a pane", async ({
  native: page,
}) => {
  await splitNew(page);
  await startProbe(page, 1);
  const row = page
    .locator(".xterm")
    .first()
    .locator(".xterm-rows > div")
    .filter({ hasText: "SELECT alpha beta gamma" })
    .first();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 8 });
  expect(await page.locator(".pane-dragging").count()).toBe(0);
  await page.mouse.up();
  await page.keyboard.press("Control+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("alpha beta");
  await page.mouse.click(box.x + 85, box.y + box.height / 2, { clickCount: 2 });
  await expect(page.locator(".xterm").nth(1)).toBeVisible();
  await page.screenshot({ path: "logs/e2e/terminal-parity-selection.png" });
});

test("mouse-enabled terminal applications receive left and right clicks without pane menus", async ({
  native: page,
}) => {
  await page.keyboard.press("F12");
  await expect.poll(() => terminalText(page)).toContain("MOUSE-ON");
  const before = await inputBytes(page);
  await page.locator(".xterm").click({ position: { x: 90, y: 130 } });
  await expect
    .poll(async () => Buffer.from((await inputBytes(page)).slice(before.length), "hex").toString())
    .toMatch(/\x1b\[<0;\d+;\d+M\x1b\[<0;\d+;\d+m/);
  const left = await inputBytes(page);
  await page.locator(".xterm").click({ button: "right", position: { x: 100, y: 130 } });
  await expect
    .poll(async () => Buffer.from((await inputBytes(page)).slice(left.length), "hex").toString())
    .toMatch(/\x1b\[<2;\d+;\d+M\x1b\[<2;\d+;\d+m/);
  await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);
});

test("Pi's actual Jump to latest message button responds to a mouse click", async ({
  native: page,
}) => {
  test.skip(!piTuiModule, "Set PI_TUI_TEST_MODULE to the installed Pi TUI dist/index.js");
  await page.keyboard.press("F11");
  const button = page.locator(".xterm-rows > div").filter({ hasText: "Jump to latest message" });
  await expect(button).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: "logs/e2e/terminal-pi-before-click.png" });
  const bounds = (await button.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect.poll(() => terminalText(page)).toContain("PI-TRANSCRIPT 199");
  await expect(button).toHaveCount(0);
  await page.screenshot({ path: "logs/e2e/terminal-pi-after-click.png" });
});

test("Pi mouse buttons still work after switching projects and restoring the terminal", async ({
  native: page,
}) => {
  test.skip(!piTuiModule, "Set PI_TUI_TEST_MODULE to the installed Pi TUI dist/index.js");
  await page.keyboard.press("F11");
  const button = page.locator(".xterm-rows > div").filter({ hasText: "Jump to latest message" });
  await expect(button).toBeVisible({ timeout: 15000 });
  const projects = await page.evaluate(async () => {
    const url = "/src/projects/api.ts";
    const p = await import(/* @vite-ignore */ url);
    return {
      original: p.getProjectsState().activeId,
      temporary: p.createProject("", "Mouse restore QA").id,
    };
  });
  try {
    await expect(page.locator(".xterm")).toHaveCount(0);
    await page.evaluate(async ({ original }) => {
      const url = "/src/projects/api.ts";
      (await import(/* @vite-ignore */ url)).switchProject(original);
    }, projects);
    await expect(button).toBeVisible();
    const bounds = (await button.boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect.poll(() => terminalText(page)).toContain("PI-TRANSCRIPT 199");
    await expect(button).toHaveCount(0);
    await page.screenshot({ path: "logs/e2e/terminal-pi-restored-click.png" });
  } finally {
    await page.evaluate(async ({ original, temporary }) => {
      const url = "/src/projects/api.ts";
      const p = await import(/* @vite-ignore */ url);
      p.switchProject(original);
      p.removeProject(temporary);
    }, projects);
  }
});
