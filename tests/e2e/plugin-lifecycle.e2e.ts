import { afterEach, beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { canvasFixture } from "../mocks/plugin-lifecycle-server";
import { SEED_INIT } from "../mocks/tauri-seed";

let fixture: Awaited<ReturnType<typeof canvasFixture>>;
beforeEach(async ({ app, browser, screen }) => {
  fixture = await canvasFixture();
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(`(() => {
    localStorage.setItem('show-splash','false'); localStorage.setItem('sidebar-side','left');
    const w=window; const original=w.__TAURI_INTERNALS__.invoke; w.__lifecycleCalls=[];
    w.__TAURI_INTERNALS__.invoke=async (cmd,args)=>{
      w.__lifecycleCalls.push({cmd,args});
      if(!['plugin_view_event','plugin_view_request','plugin_prepare_reload'].includes(cmd)) return original(cmd,args);
      const response=await fetch(${JSON.stringify(fixture.origin + "/command")},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd,args})}).then(r=>r.json());
      if(response.error) throw Error(response.error);
      if(cmd==='plugin_view_request' && args.params?.name==='_exec_callback') {
        const store=await import('/src/plugins/data/plugin-store.ts');
        store.finishPluginCall(args.callId,{content:[],structuredContent:{canvasId:args.params.arguments.result.canvasId,tldrawRecords:[{id:'shape:one',type:'geo',text:'Initial label'}]}});
      }
      return response.result;
    };
  })()`);
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect
    .poll(() =>
      browser.evaluate(() =>
        (window as any).__lifecycleCalls.some((c: any) => c.cmd === "pty_ensure"),
      ),
    )
    .toBe(true);
  const terminal = await browser.evaluate(
    () => (window as any).__lifecycleCalls.find((c: any) => c.cmd === "pty_ensure").args.sessionId,
  );
  fixture.register("canvas-call", terminal, "canvas-A");
  await browser.evaluate(
    async ({ terminal, origin }) => {
      const store = await import(/* @vite-ignore */ "/src/plugins/data/plugin-store.ts");
      const workspace = await import(/* @vite-ignore */ "/src/terminal/workspace.ts");
      store.publishPluginCall({
        id: "canvas-call",
        plugin: "tldraw",
        pluginName: "tldraw",
        terminal,
        tool: { name: "exec" },
        arguments: { canvasId: "canvas-A" },
        viewUrl: origin + "/view/canvas-call",
        view: {},
      });
      workspace.openPluginTab({
        sessionId: terminal,
        pluginId: "tldraw",
        pluginName: "tldraw",
        callId: "canvas-call",
      });
    },
    { terminal, origin: fixture.origin },
  );
  await expect(screen.getByRole("button", "Reload view")).toBeEnabled();
  await expect.poll(() => fixture.stats.saves).toBeGreaterThan(0);
});
afterEach(async () => {
  await fixture?.close();
});

test("reload flushes the latest edit and preserves shape identity without replaying input", async ({
  app,
  browser,
  screen,
}) => {
  const frame = browser.frameLocator(`iframe[src="${fixture.origin}/view/canvas-call"]`);
  await frame.getByLabel("Shape label").fill("Latest edit before debounce");
  await browser.evaluate(() => {
    (window as any).__beforeReload = document.querySelector('[data-testid="plugin-view-frame"]');
  });
  await screen.getByRole("button", "Reload view").tap();
  await expect
    .poll(() =>
      browser.evaluate(
        () =>
          document.querySelector('[data-testid="plugin-view-frame"]') !==
          (window as any).__beforeReload,
      ),
    )
    .toBe(true);
  await expect(screen.getByRole("button", "Reload view")).toBeEnabled();
  await expect(frame.getByLabel("Shape label")).toHaveValue("Latest edit before debounce");
  await expect(frame.locator('[data-shape-id="shape:one"]')).toHaveText(
    "Latest edit before debounce",
  );
  expect(fixture.stats.callbacks).toBe(1);
  expect(fixture.stats.refreshes).toBe(1);
  expect(
    await browser.evaluate(
      () => (window as any).__lifecycleCalls.filter((c: any) => c.cmd === "pty_kill").length,
    ),
  ).toBe(0);
  await app.screenshot("canvas-after-acknowledged-reload");
});

test("failed saves and resource refreshes keep the same iframe and its unsaved edit", async ({
  app,
  browser,
  screen,
}) => {
  const frame = browser.frameLocator(`iframe[src="${fixture.origin}/view/canvas-call"]`);
  await browser.evaluate(() => {
    (window as any).__originalCanvas = document.querySelector('[data-testid="plugin-view-frame"]');
  });
  fixture.behavior.saveError = true;
  await frame.getByLabel("Shape label").fill("Keep this unsaved edit");
  await screen.getByRole("button", "Reload view").tap();
  await expect(
    screen.getByRole("alert").filter({ hasText: "Could not reload view" }),
  ).toBeVisible();
  await expect(frame.getByLabel("Shape label")).toHaveValue("Keep this unsaved edit");
  expect(
    await browser.evaluate(
      () =>
        document.querySelector('[data-testid="plugin-view-frame"]') ===
        (window as any).__originalCanvas,
    ),
  ).toBe(true);
  fixture.behavior.saveError = false;
  fixture.behavior.refreshError = true;
  await screen.getByRole("button", "Reload view").tap();
  await expect(
    screen.getByRole("alert").filter({ hasText: "resource refresh failed" }),
  ).toBeVisible();
  expect(
    await browser.evaluate(
      () =>
        document.querySelector('[data-testid="plugin-view-frame"]') ===
        (window as any).__originalCanvas,
    ),
  ).toBe(true);
  await app.screenshot("canvas-kept-after-refresh-error");
  await browser.setViewport({ width: 420, height: 780 });
  await expect(screen.getByRole("button", "Reload view")).toBeVisible();
  await app.screenshot("canvas-kept-after-refresh-error-narrow");
});

test("a failed editor recovers the last acknowledged checkpoint without replaying exec", async ({
  app,
  browser,
  screen,
}) => {
  const frame = browser.frameLocator(`iframe[src="${fixture.origin}/view/canvas-call"]`);
  const before = fixture.stats.saves;
  await frame.getByLabel("Shape label").fill("Recovered Ω label");
  await expect.poll(() => fixture.stats.saves).toBeGreaterThan(before);
  await browser.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/plugins/data/plugin-store.ts");
    store.finishPluginCall("canvas-call", {
      isError: true,
      content: [{ type: "text", text: "Fixture editing code failed" }],
    });
  });
  await expect(frame.getByRole("status")).toHaveText("Error editing canvas");
  await expect(
    screen.getByText(
      "Recovery restores the last acknowledged checkpoint, not unsaved partial edits.",
    ),
  ).toBeVisible();
  await screen.getByRole("button", "Recover last saved view").tap();
  await expect(frame.getByLabel("Shape label")).toHaveValue("Recovered Ω label");
  await expect(frame.locator('[data-shape-id="shape:one"]')).toHaveText("Recovered Ω label");
  expect(fixture.stats.callbacks).toBe(1);
  await frame.getByLabel("Shape label").fill("Edited after recovery");
  await screen.getByRole("button", "Reload view").tap();
  await expect(screen.getByRole("button", "Reload view")).toBeEnabled();
  await expect(frame.getByLabel("Shape label")).toHaveValue("Edited after recovery");
  expect(fixture.stats.callbacks).toBe(1);
  await app.screenshot("canvas-recovered-after-exec-error");
});

test("thirty reloads and a second project retain independent canvases and the original PTY", async ({
  app,
  browser,
  screen,
}) => {
  const frame = browser.frameLocator(`iframe[src="${fixture.origin}/view/canvas-call"]`);
  await frame.getByLabel("Shape label").fill("Persistent original");
  let refreshes = 0;
  const reload = async () => {
    await browser.evaluate(() => {
      (window as any).__previousFrame = document.querySelector('[data-testid="plugin-view-frame"]');
    });
    await screen.getByRole("button", "Reload view").tap();
    await expect.poll(() => fixture.stats.refreshes).toBe(++refreshes);
    await expect
      .poll(() =>
        browser.evaluate(
          () =>
            document.querySelector('[data-testid="plugin-view-frame"]') !==
            (window as any).__previousFrame,
        ),
      )
      .toBe(true);
    await expect(screen.getByRole("button", "Reload view")).toBeEnabled();
    await expect(frame.getByLabel("Shape label")).toHaveValue("Persistent original");
  };
  for (let i = 0; i < 15; i++) await reload();
  const other = await browser.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/terminal/state/terminal-store.ts");
    const groups = await import(/* @vite-ignore */ "/src/terminal/state/group-actions.ts");
    const workspace = await import(/* @vite-ignore */ "/src/terminal/workspace.ts");
    const original = store.currentState.activeGroupId;
    store.setState((prev) => ({
      ...prev,
      groups: [
        ...prev.groups,
        { id: "fixture-project-B", name: "Other project", cwd: "C:/fixture-project-B" },
      ],
    }));
    groups.switchGroup("fixture-project-B");
    workspace.openTerminalAt("C:/fixture-project-B");
    const terminal = workspace
      .getTerminalTabs()
      .find((t) => t.groupId === "fixture-project-B" && !t.kind)!.sessionId;
    return { original, terminal };
  });
  fixture.register("other-call", other.terminal, "canvas-A");
  await browser.evaluate(
    async ({ terminal, origin }) => {
      const store = await import(/* @vite-ignore */ "/src/plugins/data/plugin-store.ts");
      const workspace = await import(/* @vite-ignore */ "/src/terminal/workspace.ts");
      store.publishPluginCall({
        id: "other-call",
        plugin: "tldraw",
        pluginName: "tldraw",
        terminal,
        tool: { name: "exec" },
        arguments: { canvasId: "canvas-A" },
        viewUrl: origin + "/view/other-call",
        view: {},
      });
      workspace.openPluginTab({
        sessionId: terminal,
        pluginId: "tldraw",
        pluginName: "tldraw",
        callId: "other-call",
      });
    },
    { terminal: other.terminal, origin: fixture.origin },
  );
  const second = browser.frameLocator(`iframe[src="${fixture.origin}/view/other-call"]`);
  await expect(second.getByLabel("Shape label")).toHaveValue("Initial label");
  const before = fixture.stats.saves;
  await second.getByLabel("Shape label").fill("Other terminal label");
  await expect.poll(() => fixture.stats.saves).toBeGreaterThan(before);
  await browser.evaluate(async (original) => {
    const groups = await import(/* @vite-ignore */ "/src/terminal/state/group-actions.ts");
    groups.switchGroup(original);
  }, other.original);
  await screen.getByRole("tab", "tldraw · Code").tap();
  await expect(frame.getByLabel("Shape label")).toHaveValue("Persistent original");
  for (let i = 0; i < 15; i++) await reload();
  expect(fixture.stats.callbacks).toBe(2);
  expect(
    await browser.evaluate(
      () => (window as any).__lifecycleCalls.filter((c: any) => c.cmd === "pty_kill").length,
    ),
  ).toBe(0);
  await app.screenshot("canvas-after-thirty-reloads-and-project-switch");
});
