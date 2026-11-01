import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
const endpoint = process.env.NATIVE_CDP_URL;
assert.ok(
  endpoint && !endpoint.includes(":9222"),
  "Requires isolated native QA, never installed Cairngorm",
);
const baseline = process.env.CAIRNGORM_BASELINE_CLOSE === "1";
const reattach = process.env.CAIRNGORM_REATTACH_CHECK === "1";
const memberCount = Number(process.env.CAIRNGORM_DETACHED_MEMBERS ?? "1");
assert.ok(memberCount === 1 || memberCount === 2, "Detached fixture supports one or two members");
const siblingSession = `detached-close-other-${Date.now()}`;
const ownedSessions = [];
const browser = await chromium.connectOverCDP(endpoint);
const app = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url() === "http://localhost:1420/");
browser.contexts()[0].setDefaultTimeout(15000);
assert.ok(app, "Unmocked native main window required");
const deadline = setTimeout(() => {
  console.error("Native lifecycle probe deadline exceeded");
  process.exit(2);
}, 35000);
deadline.unref();
const folder = path.resolve("logs/native-detached-close");
fs.mkdirSync(folder, { recursive: true });
const browserArgs = JSON.parse(
  process.env.TAURI_CONFIG ?? fs.readFileSync("logs/build/workspace-restore-native.json", "utf8"),
).app.windows[0].additionalBrowserArgs;
let project, tab, detached;
try {
  await app.evaluate(async () => {
    const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
    for (const args of [
      { event: "unrelated", target: null },
      { event: "pty-kill-invalid space", target: null },
      { event: "terminal-reattach", target: "other" },
    ]) {
      let rejected = false;
      try {
        await invoke("emit_terminal_event", { ...args, payload: {} });
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error("Terminal event boundary accepted unsupported routing");
    }
  });
  console.log("Detached QA: setup project");
  project = await app.evaluate(async (root) => {
    const projects = await import("/src/projects/api.ts");
    const previous = projects.getProjectsState().activeId;
    return { id: projects.createProject(root, "Detached close QA").id, previous };
  }, folder);
  await app
    .getByRole("tablist", { name: "Workspace tabs" })
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  await app
    .getByRole("menuitem", { name: /^PowerShell/ })
    .first()
    .click();
  tab = await app.evaluate(async () =>
    (await import("/src/terminal/hooks/use-terminal-tabs.ts")).getTerminalTab(),
  );
  ownedSessions.push(tab.sessionId);
  await app.evaluate(
    async ({ sessionId, root }) => {
      const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
      await invoke("pty_ensure", {
        sessionId,
        shell: "powershell.exe",
        args: ["-NoLogo", "-NoProfile"],
        env: [],
        cwd: root,
      });
    },
    { sessionId: siblingSession, root: folder },
  );
  const replay = () =>
    app.evaluate(async (sessionId) => {
      const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
      const value = await invoke("pty_replay", { sessionId });
      return value?.data ? atob(value.data) : null;
    }, tab.sessionId);
  await expect.poll(replay, { timeout: 15000 }).toContain("native-detached-close");
  console.log("Detached QA: create native window");
  await app.evaluate(
    async ({ tab, browserArgs }) => {
      const store = await import("/src/terminal/hooks/use-terminal-tabs.ts");
      const { buildDetachedUrl } = await import("/src/terminal/data/terminal-window.ts");
      const { WebviewWindow } = await import("/node_modules/@tauri-apps/api/webviewWindow.js");
      // QA's CDP override must match the native main environment, not the installed-app 9222 default.
      const windowHandle = new WebviewWindow(`detached-${tab.id}`, {
        url: buildDetachedUrl([tab]),
        width: 800,
        height: 600,
        decorations: true,
        title: "Detached close QA",
        additionalBrowserArgs: browserArgs,
      });
      await new Promise((resolve, reject) => {
        windowHandle.once("tauri://created", resolve);
        windowHandle.once("tauri://error", reject);
      });
      // Invoke the production store action through a tiny mounted hook fixture.
      const runtimeURL = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((url) => /\/preact\.js\?/.test(url));
      if (!runtimeURL) throw new Error("Production Preact runtime not found");
      const { h, render } = await import(runtimeURL);
      const host = document.createElement("div");
      document.body.append(host);
      let api;
      render(
        h(() => {
          api = store.useTerminalTabs();
          return null;
        }),
        host,
      );
      api.detachTab(tab.id, windowHandle.label);
      window.__QA_TERMINAL_API__ = () => api;
      window.__QA_RELEASE_HOOK__ = () => {
        render(null, host);
        host.remove();
      };
    },
    { tab, browserArgs },
  );
  await expect
    .poll(
      () =>
        browser
          .contexts()[0]
          .pages()
          .some((page) => page.url().includes(`detached=${tab.id}`)),
      { timeout: 15000 },
    )
    .toBe(true);
  detached = browser
    .contexts()[0]
    .pages()
    .find((page) => page.url().includes(`detached=${tab.id}`));
  await expect(detached.getByRole("button", { name: "Reattach", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(
        (id) => window.__QA_TERMINAL_API__().state.tabs.find((t) => t.id === id)?.detached,
        tab.id,
      ),
    )
    .toBe(true);
  if (memberCount === 2) {
    console.log("Detached QA: create second member");
    await detached.getByRole("button", { name: "New terminal", exact: true }).click();
    await detached
      .getByRole("menuitem", { name: /^PowerShell/ })
      .first()
      .click();
    const second = await detached.evaluate(async () =>
      (await import("/src/terminal/hooks/use-terminal-tabs.ts")).getTerminalTab(),
    );
    assert.ok(second && second.sessionId !== tab.sessionId, "New member must have a distinct PTY");
    ownedSessions.push(second.sessionId);
    await expect
      .poll(() =>
        app.evaluate(
          (ids) =>
            window
              .__QA_TERMINAL_API__()
              .state.tabs.filter((t) => ids.includes(t.sessionId) && t.detached).length,
          ownedSessions,
        ),
      )
      .toBe(2);
    await detached.evaluate(async (sessionId) => {
      const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
      await invoke("pty_write", { sessionId, data: "Write-Output ('DETACHED_'+'SECOND_READY')\r" });
    }, second.sessionId);
    await expect
      .poll(() =>
        app.evaluate(async (sessionId) => {
          const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
          const value = await invoke("pty_replay", { sessionId });
          return value?.data ? atob(value.data) : "";
        }, second.sessionId),
      )
      .toContain("DETACHED_SECOND_READY");
    console.log("Detached QA: second PTY responds and membership synced");
    await detached.evaluate(
      async ({ first, second }) => {
        const store = await import("/src/terminal/hooks/use-terminal-tabs.ts");
        const runtimeURL = performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .find((url) => /\/preact\.js\?/.test(url));
        const { h, render } = await import(runtimeURL);
        const host = document.createElement("div");
        document.body.append(host);
        let api;
        render(
          h(() => {
            api = store.useTerminalTabs();
            return null;
          }),
          host,
        );
        api.dockTab(second, first, "right");
        api.resizeColumns(0, -130, 1000);
        window.__QA_TERMINAL_API__ = () => api;
      },
      { first: tab.id, second: second.id },
    );
    await expect(detached.locator(".xterm:visible")).toHaveCount(2);
  }
  const layoutBefore = await detached.evaluate(async () => {
    const { flushStorage } = await import("/src/terminal/data/native-storage.ts");
    window.dispatchEvent(new Event("terminal-save-scrollback"));
    await flushStorage();
    return window.__QA_TERMINAL_API__?.().state.layout ?? null;
  });
  if (memberCount === 2) {
    assert.equal(
      layoutBefore?.columnRatios.length,
      2,
      "Two-member fixture must have two split columns",
    );
    const total = layoutBefore.columnRatios.reduce((sum, ratio) => sum + ratio, 0);
    layoutBefore.columnRatios.forEach((ratio, i) =>
      assert.ok(
        Math.abs(ratio / total - [0.37, 0.63][i]) < 1e-9,
        "Fixture must be 37/63 before close or reattach",
      ),
    );
    console.log("Detached QA: pre-action split verified at 37/63");
  }
  await detached.screenshot({ path: "logs/e2e/native-detached-before-close.png" });
  if (baseline)
    await detached.evaluate(async () => {
      const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
      const event = "tauri://close-requested";
      const entries = window.__internal_unstable_listeners_object_id__?.[event];
      if (!entries) throw new Error("Storage close guard listener was not installed");
      const ids = Object.getOwnPropertyNames(entries);
      if (ids.length !== 1) throw new Error(`Expected only the storage guard, found ${ids.length}`);
      for (const id of ids) {
        window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, Number(id));
        await invoke("plugin:event|unlisten", { event, eventId: Number(id) });
      }
    });
  console.log(`Detached QA: ${reattach ? "reattach" : "ordinary close"}`);
  if (reattach)
    await detached.getByRole("button", { name: "Reattach", exact: true }).evaluate((button) => {
      setTimeout(() => button.click(), 0);
    });
  else
    await detached
      .evaluate(async () => {
        const { getCurrentWindow } = await import("/node_modules/@tauri-apps/api/window.js");
        await getCurrentWindow().close();
      })
      .catch(() => {});
  console.log("Detached QA: close trigger acknowledged");
  await expect.poll(() => detached.isClosed(), { timeout: 15000 }).toBe(true);
  console.log("Detached QA: webview closed");
  if (!reattach)
    await expect
      .poll(replay, { timeout: 2000 })
      .toBeNull()
      .catch(() => {});
  console.log("Detached QA: replay query");
  const after = await replay();
  console.log("Detached QA: replay answered");
  let childStillResponds = false;
  if (after !== null) {
    await app.evaluate(async (sessionId) => {
      const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
      await invoke("pty_write", { sessionId, data: "Write-Output DETACHED_CLOSE_STILL_ALIVE\r" });
    }, tab.sessionId);
    await expect
      .poll(replay, { timeout: 2000 })
      .toContain("DETACHED_CLOSE_STILL_ALIVE")
      .catch(() => {});
    childStillResponds = (await replay())?.includes("DETACHED_CLOSE_STILL_ALIVE") ?? false;
  }
  const sessions = await app.evaluate(
    async (ids) => {
      const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
      return await Promise.all(
        ids.map(async (sessionId) => ({
          sessionId,
          registered: !!(await invoke("pty_replay", { sessionId })),
        })),
      );
    },
    [...ownedSessions, siblingSession],
  );
  await expect
    .poll(() =>
      app.evaluate(
        (id) => window.__QA_TERMINAL_API__().state.tabs.find((t) => t.id === id)?.detached ?? null,
        tab.id,
      ),
    )
    .toBe(reattach ? false : null)
    .catch(() => {});
  const state = await app.evaluate(async (id) => {
    const { WebviewWindow } = await import("/node_modules/@tauri-apps/api/webviewWindow.js");
    return {
      windowExists: !!(await WebviewWindow.getByLabel(`detached-${id}`)),
      layout: window.__QA_TERMINAL_API__().state.layout,
      tab: window.__QA_TERMINAL_API__().state.tabs.find((t) => t.id === id) ?? null,
    };
  }, tab.id);
  fs.writeFileSync(
    `logs/optimization-detached-close${baseline ? "-baseline" : reattach ? "-reattach" : ""}-evidence.json`,
    JSON.stringify(
      {
        baselineGuardRemoved: baseline,
        reattach,
        sessionId: tab.sessionId,
        layoutBefore,
        windowClosed: detached.isClosed(),
        ptyStillRegistered: after !== null,
        childStillResponds,
        sessions,
        state,
      },
      null,
      2,
    ),
  );
  console.log(
    "Detached close evidence:",
    JSON.stringify({
      baselineGuardRemoved: baseline,
      windowClosed: detached.isClosed(),
      ptyStillRegistered: after !== null,
      childStillResponds,
      tabStillPresent: !!state.tab,
    }),
  );
  assert.equal(after !== null, reattach, "Close kills its PTY; reattach preserves it");
  assert.ok(
    sessions
      .filter((s) => ownedSessions.includes(s.sessionId))
      .every((s) => s.registered === reattach),
    "Owned PTYs follow close/reattach semantics",
  );
  assert.equal(
    sessions.find((s) => s.sessionId === siblingSession)?.registered,
    true,
    "Other PTYs must survive detached close",
  );
  assert.equal(state.windowExists, false);
  assert.equal(state.tab?.detached ?? null, reattach ? false : null);
  const members = await app.evaluate(
    (ids) => window.__QA_TERMINAL_API__().state.tabs.filter((t) => ids.includes(t.sessionId)),
    ownedSessions,
  );
  assert.equal(
    members.length,
    reattach ? memberCount : 0,
    "All current members follow close/reattach semantics",
  );
  assert.ok(
    members.every((t) => !t.detached),
    "Reattached members must be inline",
  );
  if (reattach && layoutBefore)
    assert.deepEqual(state.layout, layoutBefore, "Reattach preserves cells and split ratios");
  await app.screenshot({
    path: `logs/e2e/native-detached-after-${reattach ? "reattach" : "close"}.png`,
  });
  console.log(
    reattach
      ? "PASS: native reattach preserves its PTY and restores the main inline tab"
      : "PASS: native detached close kills its owned PTY, removes main tab and preserves the unrelated PTY",
  );
} finally {
  await app
    .evaluate(
      async ({ owned, sibling }) => {
        const { invoke } = await import("/node_modules/@tauri-apps/api/core.js");
        await Promise.all(
          [...owned, sibling].map((sessionId) => invoke("pty_kill", { sessionId })),
        );
        const api = window.__QA_TERMINAL_API__?.();
        for (const tab of api?.state.tabs ?? [])
          if (owned.includes(tab.sessionId)) api.closeTab(tab.id);
        window.__QA_RELEASE_HOOK__?.();
      },
      { owned: ownedSessions, sibling: siblingSession },
    )
    .catch(() => {});
  if (detached && !detached.isClosed())
    await detached
      .evaluate(async () =>
        (await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow().destroy(),
      )
      .catch(() => {});
  if (project)
    await app
      .evaluate(async ({ id, previous }) => {
        const projects = await import("/src/projects/api.ts");
        if (previous) projects.switchProject(previous);
        projects.removeProject(id);
      }, project)
      .catch(() => {});
  clearTimeout(deadline);
  await browser.close();
}
