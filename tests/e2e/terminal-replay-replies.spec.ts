import { test, expect } from "./fixtures";

test("project restore does not send historical terminal query replies into the shell", async ({
  app,
}) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__REPLAY_WRITES__ = [];
    let replayed = false;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      if (cmd === "pty_replay") {
        const historical = replayed;
        replayed = true;
        return Promise.resolve({
          data: btoa("\x1b[c\x1b[>c\x1b[6nrestored prompt\r\n"),
          historical,
        });
      }
      if (cmd === "pty_write") {
        w.__REPLAY_WRITES__.push(args.data);
        return Promise.resolve(null);
      }
      if (cmd === "pty_ensure") w.__REPLAY_SESSION__ = args.sessionId;
      if (cmd.startsWith("pty_")) return Promise.resolve(null);
      if (cmd === "detect_home") return Promise.resolve("C:/repo");
      return original(cmd, args);
    };
  });
  await app.getByRole("button", { name: "New terminal", exact: true }).first().click();
  await expect(app.locator(".xterm-rows")).toContainText("restored prompt");
  expect(await app.evaluate(() => (window as any).__REPLAY_WRITES__)).toEqual([
    "\x1b[?62;4;9;22c",
    "\x1b[>0;276;0c",
    "\x1b[1;1R",
  ]);
  await app.evaluate(() => {
    (window as any).__REPLAY_WRITES__ = [];
  });
  await app.evaluate(async () => {
    const url = "/src/projects/api.ts";
    const projects = await import(/* @vite-ignore */ url);
    const original = projects.getProjectsState().activeId;
    projects.createProject("", "Replay QA");
    (window as any).__REPLAY_PROJECT__ = original;
  });
  await expect(app.locator(".xterm")).toHaveCount(0);
  await app.evaluate(async () => {
    const url = "/src/projects/api.ts";
    (await import(/* @vite-ignore */ url)).switchProject((window as any).__REPLAY_PROJECT__);
  });
  await expect(app.locator(".xterm-rows")).toContainText("restored prompt");
  expect(await app.evaluate(() => (window as any).__REPLAY_WRITES__)).toEqual([]);
  await app.locator(".xterm-helper-textarea").focus();
  await app.keyboard.type("hello");
  await expect
    .poll(() => app.evaluate(() => (window as any).__REPLAY_WRITES__.join("")))
    .toBe("hello");
  await app.evaluate(async () => {
    const url = "/src/terminal/runtime/term-registry.ts";
    const registry = await import(/* @vite-ignore */ url);
    registry.getTerm((window as any).__REPLAY_SESSION__).write("\x1b[c");
  });
  await expect
    .poll(() => app.evaluate(() => (window as any).__REPLAY_WRITES__.join("")))
    .toContain("\x1b[?62;4;9;22c");
  await app.takeScreenshot("terminal-replay-handshake");
});
