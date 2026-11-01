import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));

// Run with CAIRNGORM_NATIVE_PLUGIN_CHECK=1 after launching the isolated debug build.
test("deployed tldraw keeps a manual label edit across an acknowledged native reload", async ({
  app,
  browser,
  screen,
}) => {
  const sandbox = JSON.parse(
    fs.readFileSync(path.join(root, "logs/native-plugin-sandbox.json"), "utf8"),
  );
  await app.open();
  await expect(screen.getByTestId("header-settings")).toBeVisible();
  const environment = await browser.evaluate(async () => {
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    const paths = await import(/* @vite-ignore */ "/node_modules/@tauri-apps/api/path.js");
    return {
      home: await invoke("detect_home"),
      data: await paths.appDataDir(),
      state: await invoke("plugins_state"),
    };
  });
  const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  expect(normalize(environment.home)).toBe(normalize(sandbox.scratch));
  expect(normalize(environment.data)).toContain("dev.cairngorm.reload-check");
  for (const agent of environment.state.agents) {
    expect(normalize(agent.configPath).startsWith(normalize(sandbox.scratch) + "/")).toBe(true);
  }
  await browser.evaluate(async () => {
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    await invoke("plugins_connect_agents");
    await invoke("plugins_set_enabled", { id: "tldraw", enabled: true });
  });
  const source = await browser.evaluate(async (scratch) => {
    const workspace = await import(/* @vite-ignore */ "/src/terminal/workspace.ts");
    workspace.openTerminalAt(scratch + "/project-A");
    return workspace
      .getTerminalTabs()
      .filter((t) => !t.kind)
      .at(-1)!.sessionId;
  }, sandbox.scratch);
  await expect
    .poll(() =>
      browser.evaluate(async (sessionId) => {
        const invoke = (window as any).__TAURI_INTERNALS__.invoke;
        return invoke("pty_replay", { sessionId }).then(
          (value: { data: string } | null) =>
            value != null && atob(value.data).includes("project-A>"),
        );
      }, source),
    )
    .toBe(true);
  const run = async (tool: string, args: Record<string, unknown>, name: string) => {
    const commandPath = path.join(sandbox.scratch, name + "-command.json");
    const output = path.join(sandbox.scratch, name + "-result.json");
    fs.rmSync(output, { force: true });
    fs.writeFileSync(
      commandPath,
      JSON.stringify({
        bridge: path.join(environment.data, "plugins", "mcp-bridge.cjs"),
        tool,
        output,
        arguments: args,
      }),
    );
    const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
    const command = `& ${quote(process.execPath)} ${quote(path.join(root, "tests/mocks/native-plugin-driver.cjs"))} ${quote(commandPath)}\r`;
    await browser.evaluate(
      async ({ source, command }) => {
        await (window as any).__TAURI_INTERNALS__.invoke("pty_write", {
          sessionId: source,
          data: command,
        });
      },
      { source, command },
    );
    await expect.poll(() => fs.existsSync(output), { timeout: 65000 }).toBe(true);
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(result.error).toBeUndefined();
    expect(result.result?.isError).not.toBe(true);
    return result;
  };
  await run(
    "tldraw_search",
    { code: "return spec.members.filter(m => ['createShape','zoomToFit'].includes(m.name));" },
    "search",
  );
  await run(
    "tldraw_exec",
    {
      code: "editor.createShape({_type:'rectangle',shapeId:'native-a',x:80,y:80,w:300,h:180,text:'Native before reload'}); editor.createShape({_type:'rectangle',shapeId:'native-b',x:450,y:80,w:300,h:180,text:'Native second shape'}); editor.zoomToFit();",
    },
    "draw",
  );
  await expect(screen.getByRole("button", "Reload view")).toBeEnabled();
  const frame = browser.frameLocator('[data-testid="plugin-view-frame"]');
  await expect(frame.locator('[data-shape-id="shape:native-a"]')).toBeVisible();
  await expect(frame.locator('[data-shape-id="shape:native-b"]')).toContainText(
    "Native second shape",
  );
  await app.screenshot("native-tldraw-before-reload");
  await frame.locator('[data-shape-id="shape:native-a"]').doubleTap();
  await expect(frame.locator('[contenteditable="true"]')).toHaveCount(1);
  await frame.locator('[contenteditable="true"]').fill("Native latest label");
  await frame.locator('[contenteditable="true"]').press("Escape");
  await browser.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="plugin-view-frame"]')!;
    (window as any).__nativeOldFrame = frame;
    (window as any).__nativeOldWindow = frame.contentWindow;
    (window as any).__nativeMovedFrame = false;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if ([...record.removedNodes].some((node) => node === frame || node.contains(frame))) {
          (window as any).__nativeMovedFrame = true;
        }
      }
    });
    observer.observe(frame.parentElement!.parentElement!, { childList: true, subtree: true });
    (window as any).__nativeObserver = observer;
  });
  await screen.getByRole("button", "Reload view").tap();
  await expect
    .poll(
      () =>
        browser.evaluate(() => {
          const current = document.querySelector('[data-testid="plugin-view-frame"]');
          return (
            (current != null && current !== (window as any).__nativeOldFrame) ||
            Boolean(document.querySelector('[role="alert"]')?.textContent)
          );
        }),
      { timeout: 10000 },
    )
    .toBe(true);
  await expect(screen.getByRole("button", "Reload view")).toBeEnabled();
  const outcome = await browser.evaluate(() => {
    (window as any).__nativeObserver.disconnect();
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="plugin-view-frame"]');
    return {
      reloaded: frame !== (window as any).__nativeOldFrame,
      sameBrowsingContext: frame?.contentWindow === (window as any).__nativeOldWindow,
      iframeAncestorMoved: (window as any).__nativeMovedFrame,
      error: document.querySelector('[role="alert"]')?.textContent ?? "",
    };
  });
  fs.writeFileSync(
    path.join(root, "logs/native-plugin-frame-diagnosis.json"),
    JSON.stringify(outcome, null, 2),
  );
  await expect(frame.locator('[data-shape-id="shape:native-a"]')).toContainText(
    "Native latest label",
  );
  await expect(frame.locator('[data-shape-id="shape:native-a"]')).toBeVisible();
  await expect(frame.locator('[data-shape-id="shape:native-b"]')).toContainText(
    "Native second shape",
  );
  if (!outcome.reloaded) {
    await frame.locator('[data-shape-id="shape:native-a"]').doubleTap();
    await frame.locator('[contenteditable="true"]').fill("Native editable after blocked reload");
    await frame.locator('[contenteditable="true"]').press("Escape");
    await expect(frame.locator('[data-shape-id="shape:native-a"]')).toContainText(
      "Native editable after blocked reload",
    );
  }
  await run("tldraw_search", { code: "return spec.categories.slice(0, 1);" }, "probe");
  fs.writeFileSync(
    path.join(root, "logs/native-plugin-acceptance.json"),
    JSON.stringify(
      {
        ...outcome,
        latestLabelPreserved: true,
        originalShapeIdsPreserved: true,
        editableAfterBlockedReload: !outcome.reloaded,
        sourcePtyResponded: true,
      },
      null,
      2,
    ),
  );
  await app.screenshot(
    outcome.reloaded ? "native-tldraw-after-reload" : "native-tldraw-reload-blocked",
  );
  expect(outcome.error || "reloaded").toBe("reloaded");
  expect(outcome.reloaded).toBe(true);
});
