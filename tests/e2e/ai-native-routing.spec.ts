import { test, expect, SEED_INIT } from "./fixtures";

async function seed(page: import("@playwright/test").Page, selected = false) {
  await page.addInitScript(SEED_INIT);
  await page.addInitScript(
    ({ selected }) => {
      localStorage.setItem("show-splash", "false");
      localStorage.setItem("sidebar-side", "left");
      const w = window as any,
        original = w.__TAURI_INTERNALS__.invoke;
      let commitProvider = selected ? "codex" : null;
      const services = ["codex", "claude"].map((id) => ({
        id,
        name: id === "codex" ? "Codex" : "Claude Code",
        cliPath: id + ".exe",
        homePath: "C:/accounts/" + id,
        runtime: { binaryPath: "", homePath: "" },
        localSetup: true,
        status: "session-detected",
        authKind: "subscription",
        message: "Existing login found. Verify access before using it.",
      }));
      w.__AI_CALLS__ = [];
      w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
        w.__AI_CALLS__.push({ cmd, args });
        if (cmd === "detect_ai_services")
          return Promise.resolve({ setupComplete: true, commitProvider, services });
        if (cmd === "ai_summary_setup_required") return Promise.resolve(!commitProvider);
        if (cmd === "connect_ai_service") {
          commitProvider = args.id;
          return Promise.resolve();
        }
        if (cmd === "finish_ai_setup") {
          if (args.useApi) commitProvider = null;
          return Promise.resolve();
        }
        if (cmd === "get_gemini_agent_env") return Promise.resolve(null);
        if (cmd === "get_codex_agent_env")
          return Promise.resolve(
            commitProvider === "codex"
              ? {
                  CAIRNGORM_CODEX_COMMAND: JSON.stringify({
                    program: "codex.exe",
                    args: ["-c", 'sandbox_mode="workspace-write"'],
                  }),
                  CODEX_HOME: "C:/accounts/codex",
                }
              : null,
          );
        if (cmd === "get_agent_config")
          return Promise.resolve({
            provider: "openai",
            model: "gpt-4o",
            baseUrl: "https://api.openai.com/v1",
            apiKeyEnv: "OPENAI_API_KEY",
            keySource: "none",
            keyHint: null,
          });
        if (cmd === "get_agent_env")
          return Promise.resolve({
            apiKeyEnv: "OPENAI_API_KEY",
            keyAvailable: false,
            model: null,
            baseUrl: null,
          });
        if (cmd === "git_summarize") return Promise.resolve("feat: generate a draft with Codex");
        return original(cmd, args);
      };
    },
    { selected },
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
}

test("AI summary offers consent-based provider setup then generates without requiring an API key", async ({
  page,
}) => {
  await seed(page);
  await page.getByTestId("sidebar-git-toggle").click();
  await page.getByRole("button", { name: "AI summarize", exact: true }).click();
  const picker = page.getByTestId("ai-provider-picker");
  await expect(picker).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).__AI_CALLS__.some(
        (c: any) => c.cmd === "git_summarize" || c.cmd === "connect_ai_service",
      ),
    ),
  ).toBe(false);
  const consent = page.getByRole("dialog", { name: "Use your existing subscriptions?" });
  await expect(consent).toBeVisible();
  await consent.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(consent).toHaveCount(0);
  await picker.screenshot({
    path: "logs/e2e/ai-summary-provider-picker.png",
    animations: "disabled",
  });
  const codex = picker.getByRole("listitem", { name: "Codex subscription", exact: true });
  await codex.getByRole("button", { name: "Verify & use", exact: true }).click();
  await expect(codex.getByText("In use by Cairngorm", { exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Continue to AI summary" }).click();
  await expect(picker).not.toBeVisible();
  await expect(page.getByTestId("git-commit-message")).toHaveValue(
    "feat: generate a draft with Codex",
  );
  expect(
    await page.evaluate(() =>
      (window as any).__AI_CALLS__.some((c: any) => c.cmd === "git_commit"),
    ),
  ).toBe(false);
  await page.screenshot({ path: "logs/e2e/ai-summary-codex-draft.png", animations: "disabled" });
});

test("a cancelled picker sends no model request and a changed draft is not overwritten after setup", async ({
  page,
}) => {
  await seed(page);
  await page.getByTestId("sidebar-git-toggle").click();
  await page.getByRole("button", { name: "AI summarize", exact: true }).click();
  const consent = page.getByRole("dialog", { name: "Use your existing subscriptions?" });
  await expect(consent).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(consent).toHaveCount(0);
  await expect(page.getByTestId("ai-provider-picker")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ai-provider-picker")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).__AI_CALLS__.some(
        (c: any) => c.cmd === "connect_ai_service" || c.cmd === "git_summarize",
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "AI summarize", exact: true }).click();
  await page.getByTestId("git-commit-message").evaluate((el: HTMLTextAreaElement) => {
    el.value = "my own draft";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const picker = page.getByTestId("ai-provider-picker");
  await picker
    .getByRole("listitem", { name: "Codex subscription", exact: true })
    .getByRole("button", { name: "Verify & use", exact: true })
    .click();
  await expect(consent).toBeVisible();
  await consent.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(consent).toHaveCount(0);
  await expect(picker.getByText("In use by Cairngorm", { exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Continue to AI summary" }).click();
  await expect(page.getByTestId("git-commit-message")).toHaveValue("my own draft");
  expect(
    await page.evaluate(() =>
      (window as any).__AI_CALLS__.some((c: any) => c.cmd === "git_summarize"),
    ),
  ).toBe(false);
});

test("native agent starts the Cairngorm sidecar with the Codex engine and Chat UI stays available", async ({
  page,
}) => {
  await seed(page, true);
  await page.getByRole("button", { name: /^Cairngorm agent/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__AI_CALLS__.find((c: any) => c.cmd === "pty_ensure" && c.args.parseJsonl)
            ?.args,
      ),
    )
    .toBeTruthy();
  const launch = await page.evaluate(
    () =>
      (window as any).__AI_CALLS__.find((c: any) => c.cmd === "pty_ensure" && c.args.parseJsonl)
        .args,
  );
  expect(launch.args).toContain("--codex");
  expect(launch.args).toContain("--sidecar");
  expect(launch.env).toContainEqual(["CODEX_HOME", "C:/accounts/codex"]);
  expect(launch.env.some(([key]: [string, string]) => key === "OPENAI_API_KEY")).toBe(false);
  expect(
    await page.evaluate(() =>
      (window as any).__AI_CALLS__.some((c: any) => c.cmd === "get_agent_env"),
    ),
  ).toBe(false);
  await expect(page.getByTestId("agent-problem")).toHaveCount(0);
  await page
    .locator("[data-pane-id]")
    .last()
    .click({ button: "right", position: { x: 20, y: 20 } });
  await page.getByRole("menuitem", { name: "Show Chat UI", exact: true }).click();
  const composer = page.getByPlaceholder("Type a message…");
  await expect(composer).toBeVisible();
  await composer.fill("Explain this project");
  await composer.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__AI_CALLS__.filter((c: any) => c.cmd === "pty_write").length,
      ),
    )
    .toBeGreaterThan(0);
  const input = await page.evaluate(
    () => (window as any).__AI_CALLS__.filter((c: any) => c.cmd === "pty_write").at(-1).args.data,
  );
  expect(JSON.parse(input)).toEqual({ type: "prompt", content: "Explain this project" });
  await page.screenshot({ path: "logs/e2e/native-codex-chat.png", animations: "disabled" });
});
