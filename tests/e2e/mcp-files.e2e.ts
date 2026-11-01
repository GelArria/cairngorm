import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (!location.protocol.startsWith("http")) {
      return;
    }
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__fileCalls = [];
    w.__fileState = {
      plugins: [],
      agents: [],
      clients: [],
      discoveredClients: [],
      runtime: "node",
      agentsConnected: false,
      filesEnabled: false,
      filesAccess: "ask",
      filesAvailable: true,
      wordAvailable: false,
      bridgeConfig: null,
      error: null,
    };
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      w.__fileCalls.push({ cmd, args });
      if (cmd === "plugins_state") {
        return { ...w.__fileState };
      }
      if (cmd === "plugins_connect_agents") {
        w.__fileState.agentsConnected = true;
        return { ...w.__fileState };
      }
      if (cmd === "plugins_set_files_access") {
        w.__fileState.filesAccess = args.access;
        w.__fileState.filesEnabled = args.access === "always";
        const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
        await emit("plugin-file-access-changed", args.access !== "off");
        return { ...w.__fileState };
      }
      if (cmd === "plugins_forget_app") {
        w.__fileState.appGrants = (w.__fileState.appGrants ?? []).filter(
          (grant: any) => grant.app !== args.id || grant.projectId !== args.projectId,
        );
        return { ...w.__fileState };
      }
      if (cmd === "plugin_file_consent_reply") {
        if (args.decision === "always") w.__fileState.filesAccess = "always";
        return { ...w.__fileState };
      }
      if (cmd === "plugins_sync_workspace") {
        w.__fileScopes = args.terminals;
        return;
      }
      if (cmd === "plugin_file_permission_reply") {
        return;
      }
      return original(cmd, args);
    };
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
});

test("file access asks first by default; always allowing needs consent and connected agents", async ({
  app,
  browser,
  screen,
}) => {
  await browser.locator("body").press("Control+,");
  await screen.getByTestId("settings-dialog").getByRole("button", "Plugins", { exact: true }).tap();
  const mode = (value: string) => screen.getByTestId(`file-access-${value}`);
  await expect(mode("ask")).toHaveAttribute("aria-checked", "true");
  await mode("always").tap();
  const consent = screen.getByRole("dialog", "Always allow project file access");
  await expect(consent).toBeVisible();
  await expect(consent).toContainText("including files that may contain secrets");
  await consent.getByRole("button", "Cancel", { exact: true }).tap();
  const calls = (name: string) =>
    browser.evaluate(
      (name) => (window as any).__fileCalls.filter((call: any) => call.cmd === name),
      name,
    );
  expect(await calls("plugins_set_files_access")).toEqual([]);
  await mode("always").tap();
  await expect
    .poll(() =>
      browser.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"]')]
          .pop()!
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "finished"),
      ),
    )
    .toBe(true);
  await app.screenshot("mcp-file-reading-consent");
  await consent.getByRole("button", "Always allow", { exact: true }).tap();
  const connect = screen.getByRole("dialog", "Connect plugins to your agents");
  await expect(connect).toBeVisible();
  expect(await calls("plugins_set_files_access")).toEqual([]);
  await connect.getByRole("button", "Connect agents", { exact: true }).tap();
  await expect(mode("always")).toHaveAttribute("aria-checked", "true");
  await mode("off").tap();
  await expect(mode("off")).toHaveAttribute("aria-checked", "true");
  await app.screenshot("mcp-file-access-modes");
  expect((await calls("plugins_set_files_access")).map((call: any) => call.args.access)).toEqual([
    "always",
    "off",
  ]);
});

test("the first file tool use from a terminal asks once and a grant answers its siblings", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect
    .poll(() => browser.evaluate(() => (window as any).__fileScopes?.length ?? 0))
    .toBe(1);
  await browser.evaluate(async () => {
    const scope = (window as any).__fileScopes[0];
    const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    for (const requestId of ["consent-1", "consent-2"]) {
      await emit("plugin-file-permission", {
        requestId,
        terminal: scope.sessionId,
        projectId: scope.projectId,
        rootPath: scope.rootPath,
        path: scope.rootPath,
        access: "consent",
        directory: false,
      });
    }
  });
  const dialog = screen.getByRole("dialog", "Let agents use files here?");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("create documents and open them in Cairngorm panes");
  await expect
    .poll(() =>
      browser.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"]')]
          .pop()!
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "finished"),
      ),
    )
    .toBe(true);
  await app.screenshot("mcp-file-first-use-consent");
  await screen.getByTestId("file-consent-session").tap();
  await expect(dialog).toHaveCount(0);
  expect(
    await browser.evaluate(() =>
      (window as any).__fileCalls
        .filter((call: any) => call.cmd === "plugin_file_consent_reply")
        .map((call: any) => call.args),
    ),
  ).toEqual([{ requestId: "consent-1", decision: "session" }]);
});

test("external approval is queued one dialog at a time with source labels and native request IDs", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect
    .poll(() => browser.evaluate(() => (window as any).__fileScopes?.length ?? 0))
    .toBe(1);
  await browser.evaluate(async () => {
    const scope = (window as any).__fileScopes[0];
    const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    for (const [index, path] of [
      "C:/Outside Folder/notes.txt",
      "C:/Outside Folder/second.txt",
    ].entries()) {
      await emit("plugin-file-permission", {
        requestId: `approval-${index}`,
        terminal: scope.sessionId,
        projectId: scope.projectId,
        rootPath: scope.rootPath,
        path,
        access: "read",
        directory: false,
      });
    }
  });
  const approval = screen.getByRole("dialog", "Allow external file access?");
  await expect(approval).toHaveCount(1);
  await expect(approval).toContainText("Code");
  await expect(approval).toContainText("Home");
  await expect(approval).toContainText("C:/Outside Folder/notes.txt");
  await expect
    .poll(() =>
      browser.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"]')]
          .pop()!
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "finished"),
      ),
    )
    .toBe(true);
  await app.screenshot("mcp-external-file-approval-desktop");
  await browser.setViewport({ width: 420, height: 780 });
  await app.screenshot("mcp-external-file-approval-narrow");
  await approval.getByRole("button", "Deny", { exact: true }).tap();
  await expect(approval).toContainText("C:/Outside Folder/second.txt");
  await approval.getByRole("button", "Allow this file", { exact: true }).tap();
  await expect(approval).toHaveCount(0);
  expect(
    await browser.evaluate(() =>
      (window as any).__fileCalls
        .filter((call: any) => call.cmd === "plugin_file_permission_reply")
        .map((call: any) => call.args),
    ),
  ).toEqual([
    { requestId: "approval-0", decision: "deny" },
    { requestId: "approval-1", decision: "file" },
  ]);
  expect(
    await browser.evaluate(() =>
      (window as any).__fileCalls.filter((call: any) => call.cmd === "pty_kill"),
    ),
  ).toEqual([]);
});

test("folder approval and revocation clear pending dialogs without changing terminal focus", async ({
  browser,
  screen,
}) => {
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect
    .poll(() => browser.evaluate(() => (window as any).__fileScopes?.length ?? 0))
    .toBe(1);
  await browser.evaluate(async () => {
    const scope = (window as any).__fileScopes[0];
    const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    await emit("plugin-file-permission", {
      requestId: "folder",
      terminal: scope.sessionId,
      projectId: scope.projectId,
      rootPath: scope.rootPath,
      path: "C:/External folder",
      access: "read",
      directory: true,
    });
  });
  const approval = screen.getByRole("dialog", "Allow external file access?");
  await expect(approval.getByRole("button", "Allow this file", { exact: true })).toBeDisabled();
  await approval.getByRole("button", "Allow this folder for this session").tap();
  await expect(approval).toHaveCount(0);
  expect(
    await browser.evaluate(
      () =>
        (window as any).__fileCalls.find((call: any) => call.cmd === "plugin_file_permission_reply")
          .args,
    ),
  ).toEqual({ requestId: "folder", decision: "folder" });
  await browser.evaluate(async () => {
    const scope = (window as any).__fileScopes[0];
    const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    await emit("plugin-file-permission", {
      requestId: "revoked",
      terminal: scope.sessionId,
      projectId: scope.projectId,
      rootPath: scope.rootPath,
      path: "C:/External folder/file.txt",
      access: "read",
      directory: false,
    });
  });
  await expect(approval).toBeVisible();
  await browser.evaluate(async () => {
    const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    await emit("plugin-file-access-changed", false);
  });
  await expect(approval).toHaveCount(0);
  await expect(
    screen.getByRole("tablist", "Workspace tabs").getByRole("tab", "Code", { exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("an application asks for its own permission naming the application", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect
    .poll(() => browser.evaluate(() => (window as any).__fileScopes?.length ?? 0))
    .toBe(1);
  await browser.evaluate(async () => {
    const scope = (window as any).__fileScopes[0];
    const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    await emit("plugin-file-permission", {
      requestId: "excel",
      subject: "app:excel",
      label: "Microsoft Excel",
      script: "$app.Workbooks.Add() | Out-Null",
      terminal: scope.sessionId,
      projectId: scope.projectId,
      rootPath: scope.rootPath,
      path: scope.rootPath,
      access: "consent",
      directory: false,
    });
  });
  const dialog = screen.getByRole(
    "dialog",
    "Let agents run commands as you through Microsoft Excel?",
  );
  await expect(dialog).toContainText("scripts that use its automation features");
  await expect(dialog.getByTestId("consent-script")).toContainText("$app.Workbooks.Add()");
  await expect
    .poll(() =>
      browser.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"]')]
          .pop()!
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "finished"),
      ),
    )
    .toBe(true);
  await app.screenshot("mcp-app-consent");
  await screen.getByTestId("file-consent-session").tap();
  await expect(dialog).toHaveCount(0);
  expect(
    await browser.evaluate(() =>
      (window as any).__fileCalls
        .filter((call: any) => call.cmd === "plugin_file_consent_reply")
        .map((call: any) => call.args),
    ),
  ).toEqual([{ requestId: "excel", decision: "session" }]);
});

test("an application always allowed can be asked about again from Settings", async ({
  browser,
  screen,
}) => {
  await browser.evaluate(() => {
    (window as any).__fileState.agentsConnected = true;
    (window as any).__fileState.appGrants = [
      { app: "excel", projectId: "gone" },
      { app: "word", projectId: "gone" },
    ];
  });
  await browser.locator("body").press("Control+,");
  await screen.getByTestId("settings-dialog").getByRole("button", "Plugins", { exact: true }).tap();
  const apps = screen.getByTestId("always-allowed-apps");
  await expect(apps).toContainText(/excel/i);
  await screen
    .getByRole("button", "Ask again before agents control excel in a removed project")
    .tap();
  await expect(apps).not.toContainText(/excel/i);
  await expect(apps).toContainText(/word/i);
});

test("clicking outside a first-use question does not answer it", async ({ browser, screen }) => {
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  await expect
    .poll(() => browser.evaluate(() => (window as any).__fileScopes?.length ?? 0))
    .toBe(1);
  await browser.evaluate(async () => {
    const scope = (window as any).__fileScopes[0];
    const { emit } = await import(/* @vite-ignore */ "/tests/mocks/tauri-event.ts");
    await emit("plugin-file-permission", {
      requestId: "outside",
      subject: "app:word",
      label: "Microsoft Word",
      terminal: scope.sessionId,
      projectId: scope.projectId,
      rootPath: scope.rootPath,
      path: scope.rootPath,
      access: "consent",
      directory: false,
    });
  });
  const dialog = screen.getByRole(
    "dialog",
    "Let agents run commands as you through Microsoft Word?",
  );
  await expect(dialog).toBeVisible();
  await browser.evaluate(() => {
    const outside = document.elementFromPoint(5, 5)!;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      outside.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 5, clientY: 5 }));
    }
  });
  await browser.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(
    await browser.evaluate(() =>
      (window as any).__fileCalls.filter((call: any) => call.cmd === "plugin_file_consent_reply"),
    ),
  ).toEqual([]);
});
