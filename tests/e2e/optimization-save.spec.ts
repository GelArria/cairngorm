import { test, expect, openFileInGrid } from "./fixtures";

test("isolated chrome saves the latest editor content and preserves edits made during a save", async ({
  app,
}) => {
  await app.evaluate(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__savedFiles = [];
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      if (cmd !== "fs_write_file") return original(cmd, args);
      w.__savedFiles.push(args);
      if (w.__savedFiles.length === 1)
        return new Promise<void>((resolve) => {
          w.__finishFirstSave = resolve;
        });
      return Promise.resolve();
    };
  });
  await openFileInGrid(
    app,
    {
      title: "optimization.txt",
      path: ["optimization.txt"],
      fullPath: "C:/repo/optimization.txt",
      content: "Original document",
      extension: "txt",
    },
    ".cm-editor",
  );
  const input = app.locator(".cm-content[contenteditable=true]").first();
  await input.fill("First edit");
  // Subsequent keystrokes are content-only; app chrome intentionally keeps an old snapshot.
  await input.press("End");
  await input.pressSequentially(" - latest content");
  await app.keyboard.press("Control+s");
  await expect
    .poll(() => app.evaluate(() => (window as any).__savedFiles[0]?.content))
    .toBe("First edit - latest content");

  await input.fill("Second edit while disk write is pending");
  await app.evaluate(async () => {
    (window as any).__finishFirstSave();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const isDirty = () =>
    app.evaluate(async () => {
      const path = "/src/terminal/hooks/use-terminal-tabs.ts";
      const store = await import(/* @vite-ignore */ path);
      return store.getTerminalTab()?.isDirty;
    });
  expect(await isDirty()).toBe(true);
  await app.keyboard.press("Control+s");
  await expect
    .poll(() => app.evaluate(() => (window as any).__savedFiles[1]?.content))
    .toBe("Second edit while disk write is pending");
  await expect.poll(isDirty).toBe(false);
  await expect(input).toHaveText("Second edit while disk write is pending");
  await app.takeScreenshot("radical-optimization-editor");
});
