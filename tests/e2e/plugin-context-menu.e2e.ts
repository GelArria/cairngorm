import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readFileSync } from "node:fs";
import { SEED_INIT } from "../mocks/tauri-seed";

const bridge = readFileSync(
  new URL("../../src/plugins/assets/view-context-menu.js", import.meta.url),
  "utf8",
);
const viewUrl = "http://127.0.0.1:33337/view/context-menu-test";
const html = `<!doctype html><html lang="en"><head><title>Plugin canvas</title>
<style>html,body{height:100%;margin:0;background:#111;color:#ddd;font:14px system-ui}main{padding:32px}button{padding:12px;margin-top:24px}p{color:#aaa}</style>
</head><body><main><h1>Plugin canvas</h1><p>Right-click this canvas for pane actions.</p>
<button oncontextmenu="event.preventDefault();document.querySelector('output').textContent='Plugin menu opened'">Plugin-owned menu</button>
<output role="status"></output></main><script>
parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');
</script><script data-cairngorm>${bridge}</script></body></html>`;

test("cross-origin plugin views use the pane menu without replacing plugin-owned menus", async ({
  app,
  browser,
  screen,
}) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (location.protocol.startsWith("http")) {
      localStorage.setItem("show-splash", "false");
      localStorage.setItem("sidebar-side", "left");
    }
  });
  await browser.route("http://127.0.0.1:33337/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  const chrome = await browser.evaluate(async () => {
    const { suppressNativeChrome } = await import(/* @vite-ignore */ "/src/app/native-chrome.ts");
    const off = suppressNativeChrome(document, false);
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.message);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      document.body.dispatchEvent(new Event("keydown", { bubbles: true }));
      const input = document.body.appendChild(document.createElement("textarea"));
      input.spellcheck = true;
      const edit = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      input.dispatchEvent(edit);
      input.remove();
      return { errors, nativeEditMenuAllowed: !edit.defaultPrevented };
    } finally {
      window.removeEventListener("error", onError);
      off();
    }
  });
  expect(chrome).toEqual({ errors: [], nativeEditMenuAllowed: true });
  await browser.evaluate(async (viewUrl) => {
    const storeUrl = "/src/terminal/hooks/use-terminal-tabs.ts";
    const pluginsUrl = "/src/plugins/data/plugin-store.ts";
    const tabsUrl = "/src/terminal/state/tab-actions.ts";
    const store = await import(/* @vite-ignore */ storeUrl);
    const plugins = await import(/* @vite-ignore */ pluginsUrl);
    const tabs = await import(/* @vite-ignore */ tabsUrl);
    tabs.openTab({
      title: "Plugin source",
      shellPath: "powershell.exe",
      sessionId: "plugin-context-source",
    });
    plugins.publishPluginCall({
      id: "context-menu-test",
      plugin: "test",
      pluginName: "Plugin canvas",
      terminal: "plugin-context-source",
      tool: { name: "canvas" },
      arguments: {},
      viewUrl,
      view: null,
    });
    store.openPluginTab({
      sessionId: "plugin-context-source",
      pluginId: "test",
      pluginName: "Plugin canvas",
      callId: "context-menu-test",
    });
  }, viewUrl);
  const view = browser.frameLocator('[data-testid="plugin-view-frame"]');
  const canvas = view.getByRole("heading", "Plugin canvas");
  await expect(canvas).toBeVisible();
  await view.getByRole("button", "Plugin-owned menu").secondaryTap();
  await expect(view.getByRole("status")).toHaveText("Plugin menu opened");
  await expect(screen.getByRole("menu")).toHaveCount(0);
  await canvas.secondaryTap();
  await expect(screen.getByRole("menuitem", "Close pane")).toBeVisible();
  await expect(screen.getByRole("menuitem", "Split down")).toBeVisible();
  await app.screenshot("plugin-pane-context-menu");
  await browser.keyboard.press("Escape");
  await expect(screen.getByRole("menu")).toHaveCount(0);
  await canvas.secondaryTap();
  await screen.getByRole("menuitem", "Close pane").tap();
  await expect(screen.getByTestId("plugin-pane")).toHaveCount(0);
  await expect(browser.locator("[data-pane-id]")).toHaveCount(1);
});
