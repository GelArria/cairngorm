import { test, expect, openFileInGrid } from "./fixtures";

// Completion, not redesign: optional native agent and recoverable Files errors.
test.describe("UI completion", () => {
  test.beforeEach(async ({ app }) => {
    await app.evaluate(() => localStorage.setItem("show-splash", "false"));
    await app.reload();
    await expect(app.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  test("startup does not require or launch the native agent", async ({ app }) => {
    await expect(app.locator('[data-testid="terminal-empty"]')).toBeVisible();
    await app.takeScreenshot("completion-startup");
    await expect(app.locator('[data-testid="agent-problem"]')).toHaveCount(0);
    const calls = await app.evaluate(() => (window as any).__CMD_LOG__ as string[]);
    expect(calls.some((c) => /^(resolve_agent_runner|get_agent_env):/.test(c))).toBe(false);
    await expect(app.getByRole("button", { name: "Terminal", exact: true })).toBeVisible();
    await expect(app.getByText(/Run Claude Code, Codex or another CLI/)).toBeVisible();
  });

  test("manual native launch failure stays visible alongside an open file", async ({ app }) => {
    await openFileInGrid(
      app,
      { title: "notes.md", path: ["notes.md"], content: "# Keep my work", extension: "md" },
      '[data-testid="markdown-viewer"]',
    );
    await app.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(app.locator(".cm-editor")).toBeVisible();
    await app.locator('button[aria-label="New terminal"]').click();
    await app.getByRole("menuitem", { name: /^Cairngorm agent/ }).click();
    await expect
      .poll(async () =>
        app.evaluate(
          () =>
            ((window as any).__CMD_LOG__ as string[]).filter((c) => c.startsWith("get_agent_env:"))
              .length,
        ),
      )
      .toBeGreaterThan(0);
    await app.takeScreenshot("completion-native-agent-failure");
    const problem = app.locator('[data-testid="agent-problem"]');
    await expect(problem).toBeVisible();
    await expect(app.locator(".cm-editor")).toContainText("Keep my work");
    await app.setViewportSize({ width: 1024, height: 640 });
    await expect
      .poll(async () => {
        const bounds = await problem.boundingBox();
        return bounds!.x + bounds!.width;
      })
      .toBeLessThanOrEqual(1024);
    await expect(problem.getByRole("button", { name: "Retry", exact: true })).toBeInViewport();
    await expect(app.locator(".cm-editor")).toBeInViewport();
    await app.takeScreenshot("completion-native-agent-failure-compact");
    await problem.getByRole("button", { name: "Open Settings" }).click();
    await app.getByRole("button", { name: "AI providers", exact: true }).click();
    await expect(app.locator('[data-testid="settings-dialog"]')).toContainText("Cairngorm agent");
    await app.keyboard.press("Escape");
    await problem.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(problem).toHaveCount(0);
    await expect(app.locator(".cm-editor")).toBeVisible();
  });

  test("a failed folder load is not an empty folder and can be retried", async ({ app }) => {
    await app.addInitScript(() => {
      localStorage.setItem("show-splash", "false");
      const internals = (window as any).__TAURI_INTERNALS__;
      const original = internals.invoke;
      (window as any).__FOLDER_FAIL__ = true;
      internals.invoke = (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "fs_list_dir") {
          if ((window as any).__FOLDER_FAIL__) return Promise.reject("Access denied to folder");
          return Promise.resolve([
            {
              name: "recovered.txt",
              path: String(args.path) + "/recovered.txt",
              isDirectory: false,
              size: 12,
            },
          ]);
        }
        return original(cmd, args);
      };
    });
    await app.reload();
    await app.locator('[data-testid="sidebar-files-toggle"]').click();
    await expect(app.getByText("Access denied to folder", { exact: true })).toBeVisible();
    await expect(app.locator('[data-testid="workspace-panel"]').locator("..")).toHaveCSS(
      "opacity",
      "1",
    );
    await app.takeScreenshot("completion-folder-error");
    await expect(app.getByText("This folder is empty", { exact: true })).toHaveCount(0);
    await expect(app.getByText("Could not load this folder", { exact: true })).toBeVisible();
    await app.evaluate(() => {
      (window as any).__FOLDER_FAIL__ = false;
    });
    await app.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(app.getByText("recovered.txt", { exact: true })).toBeVisible();
    await expect(app.getByText("Could not load this folder", { exact: true })).toHaveCount(0);
    await expect(app.getByText("Access denied to folder", { exact: true })).toHaveCount(0);
    await expect(app.locator('[data-testid="workspace-panel"]')).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await app.takeScreenshot("completion-folder-recovered");
  });

  for (const runner of [
    { name: "bun", agentPath: "agent.js", runnerPath: "bun.exe", args: [] },
    {
      name: "node",
      agentPath: "cli.ts",
      runnerPath: "node.exe",
      args: ["--experimental-strip-types"],
    },
    {
      name: "cairngorm-agent",
      agentPath: "cairngorm-agent.exe",
      runnerPath: "cairngorm-agent.exe",
      args: [],
    },
  ]) {
    test(`manual native launch uses the right ${runner.name} command`, async ({ app }) => {
      await app.evaluate((r) => {
        const internals = (window as any).__TAURI_INTERNALS__;
        const original = internals.invoke;
        internals.invoke = (cmd: string, args: Record<string, unknown>) => {
          if (cmd === "resolve_agent_runner") return Promise.resolve(r);
          if (cmd === "get_agent_env")
            return Promise.resolve({ apiKeyEnv: "OPENAI_API_KEY", keyAvailable: true });
          if (cmd === "pty_ensure") {
            (window as any).__NATIVE_COMMAND__ = { shell: args.shell, args: args.args };
            return Promise.resolve();
          }
          return original(cmd, args);
        };
      }, runner);
      await app.getByRole("button", { name: /^Cairngorm agent/ }).click();
      await expect
        .poll(async () => app.evaluate(() => (window as any).__NATIVE_COMMAND__?.shell))
        .toBe(runner.runnerPath);
      const command = await app.evaluate(() => (window as any).__NATIVE_COMMAND__);
      const prefix = runner.name === "cairngorm-agent" ? [] : [...runner.args, runner.agentPath];
      expect(command.args.slice(0, -1)).toEqual([...prefix, "--sidecar", "--session-id"]);
      await expect(app.locator('[data-testid="agent-problem"]')).toHaveCount(0);
    });
  }

  test("a project switch during native setup never launches into the wrong project", async ({
    app,
  }) => {
    await app.evaluate(() => {
      const internals = (window as any).__TAURI_INTERNALS__;
      const original = internals.invoke;
      internals.invoke = (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "resolve_agent_runner")
          return new Promise((resolve) => {
            (window as any).__FINISH_NATIVE_SETUP__ = resolve;
          });
        if (cmd === "get_agent_env")
          return Promise.resolve({ apiKeyEnv: "OPENAI_API_KEY", keyAvailable: true });
        if (cmd === "pty_ensure" && (args.args as string[])?.includes("--sidecar")) {
          (window as any).__WRONG_PROJECT_LAUNCH__ = true;
        }
        return original(cmd, args);
      };
    });
    await app.getByRole("button", { name: /^Cairngorm agent/ }).click();
    await expect(app.getByText("Starting the Cairngorm agent…", { exact: true })).toBeVisible();
    await app.evaluate(() => {
      (window as any).__E2E_PICK__ = "C:/code/beta";
    });
    // "Open" lives in the project picker.
    await app.getByTestId("sidebar-project-picker").click();
    await app.locator('[data-testid="legend-add-projects"]').click();
    await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("beta");
    await app.evaluate(() => {
      (window as any).__FINISH_NATIVE_SETUP__({
        agentPath: "agent.js",
        runnerPath: "bun.exe",
        args: [],
      });
    });
    await expect(
      app.getByText("The Cairngorm agent wasn't started", { exact: true }),
    ).toBeVisible();
    expect(await app.evaluate(() => !!(window as any).__WRONG_PROJECT_LAUNCH__)).toBe(false);
    await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("beta");
  });

  test("shells and files remain usable during a slow native launch", async ({ app }) => {
    await app.evaluate(() => {
      const internals = (window as any).__TAURI_INTERNALS__;
      const original = internals.invoke;
      internals.invoke = (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "resolve_agent_runner") {
          (window as any).__NATIVE_REQUESTS__ = ((window as any).__NATIVE_REQUESTS__ ?? 0) + 1;
          return new Promise(() => {});
        }
        if (cmd === "pty_replay")
          return Promise.resolve({ data: btoa("Shell ready\r\n"), historical: false });
        return original(cmd, args);
      };
    });
    await app.getByRole("button", { name: /^Cairngorm agent/ }).click();
    await expect(app.getByText("Starting the Cairngorm agent…", { exact: true })).toBeVisible();
    await expect(app.getByRole("button", { name: /^Cairngorm agent/ })).toBeDisabled();
    await expect(app.getByRole("button", { name: "Terminal", exact: true })).toBeEnabled();
    expect(await app.evaluate(() => (window as any).__NATIVE_REQUESTS__)).toBe(1);
    await app.takeScreenshot("completion-native-agent-loading");
    await app.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(app.locator(".surface-grid")).toHaveCSS("opacity", "1");
    await expect(app.getByRole("status", { name: "Loading terminal" })).toHaveCount(0);
    await expect(app.locator(".xterm-screen")).toContainText("Shell ready");
    await app.locator(".xterm").click();
    await app.keyboard.type("echo still usable");
    await expect
      .poll(() =>
        app.evaluate(() =>
          ((window as any).__CMD_LOG__ as string[])
            .filter((call) => call.startsWith("pty_write:"))
            .map((call) => JSON.parse(call.slice("pty_write:".length)).data)
            .join(""),
        ),
      )
      .toContain("echo still usable");
    await openFileInGrid(
      app,
      {
        title: "working.txt",
        path: ["working.txt"],
        content: "Keep working",
        extension: "txt",
      },
      ".cm-editor",
    );
    await expect(app.locator(".surface-grid")).toHaveCSS("opacity", "1");
    await app.locator(".cm-content").fill("Edited while agent setup is pending");
    await expect(app.locator(".cm-content")).toContainText("Edited while agent setup is pending");
    expect(await app.evaluate(() => (window as any).__NATIVE_REQUESTS__)).toBe(1);
    await app.takeScreenshot("completion-native-agent-loading-file");
  });
});
