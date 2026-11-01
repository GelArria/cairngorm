import { test, expect, SEED_INIT } from "./fixtures";

async function seed(page: import("@playwright/test").Page, completed = false) {
  await page.addInitScript(SEED_INIT);
  await page.addInitScript(
    ({ completed }) => {
      localStorage.setItem("show-splash", "false");
      if (completed) localStorage.setItem("cairngorm.subscriptionConsent", "granted");
      localStorage.setItem("sidebar-side", "left");
      const w = window as any,
        original = w.__TAURI_INTERNALS__.invoke;
      let setupComplete = completed,
        commitProvider: string | null = null;
      const services = [
        {
          id: "codex",
          name: "Codex",
          cliPath: "C:/Users/Developer/.local/bin/codex.exe",
          homePath: "C:/Users/Developer/.codex",
          runtime: { binaryPath: "", homePath: "" },
          localSetup: true,
          status: "session-detected",
          authKind: "subscription",
          message: "Existing login found. Verify access before using it.",
        },
        {
          id: "claude",
          name: "Claude Code",
          cliPath: "C:/Users/Developer/.local/bin/claude.exe",
          homePath: "C:/Users/Developer/.claude",
          runtime: { binaryPath: "", homePath: "" },
          localSetup: true,
          status: "signed-out",
          authKind: null,
          message:
            "Sign in with the official CLI using this configuration folder, then scan again.",
        },
      ];
      const view = () => ({
        setupComplete,
        commitProvider,
        claudeApiConsentGranted: false,
        services,
      });
      w.__AI_CALLS__ = [];
      w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
        w.__AI_CALLS__.push({ cmd, args });
        if (cmd === "needs_ai_setup") return Promise.resolve(!setupComplete);
        if (cmd === "ai_summary_setup_required") return Promise.resolve(!commitProvider);
        if (cmd === "get_gemini_agent_env") return Promise.resolve(null);
        if (cmd === "get_codex_agent_env")
          return Promise.resolve(
            commitProvider === "codex"
              ? { CAIRNGORM_CODEX_COMMAND: JSON.stringify({ program: "codex.exe", args: [] }) }
              : null,
          );
        if (cmd === "detect_ai_services") return Promise.resolve(view());
        if (cmd === "connect_ai_service") {
          commitProvider = args.id;
          setupComplete = true;
          return Promise.resolve();
        }
        if (cmd === "save_ai_runtime") {
          if (w.__RUNTIME_ERROR__) return Promise.reject("CLI executable not found at this path.");
          const service = services.find((s) => s.id === args.id)!;
          service.runtime = args.runtime;
          service.cliPath = args.runtime.binaryPath;
          service.homePath = args.runtime.homePath;
          if (commitProvider === args.id) commitProvider = null;
          return Promise.resolve(view());
        }
        if (cmd === "finish_ai_setup") {
          setupComplete = true;
          if (args.useApi) commitProvider = null;
          return Promise.resolve();
        }
        if (cmd === "get_agent_config")
          return Promise.resolve({
            provider: "openai",
            model: "gpt-4o",
            baseUrl: "https://api.openai.com/v1",
            apiKeyEnv: "OPENAI_API_KEY",
            keySource: "none",
            keyHint: null,
          });
        if (cmd === "save_agent_config") {
          w.__SAVED_API__ = args.input;
          return Promise.resolve({ ...args.input, keySource: "none", keyHint: null });
        }
        if (cmd === "git_summarize") return Promise.resolve("feat: reuse the existing Codex login");
        return original(cmd, args);
      };
    },
    { completed },
  );
  await page.goto("/", { timeout: 90000 });
}

async function declineClaudeBilling(page: import("@playwright/test").Page) {
  const billing = page.getByRole("dialog", { name: "Claude Code uses paid API billing" });
  await expect(billing).toBeVisible();
  await expect(billing).toContainText("not included in a Claude Free, Pro or Max subscription");
  await expect(billing.getByRole("button", { name: "Verify & enable API billing" })).toBeDisabled();
  await billing.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(billing).toBeHidden();
  expect(
    await page.evaluate(() =>
      (window as any).__AI_CALLS__.filter(
        (x: any) => x.cmd === "connect_ai_service" && x.args.id === "claude",
      ),
    ),
  ).toEqual([]);
}

async function openProviders(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("agent-settings")).toHaveCount(0);
  await page.getByRole("button", { name: "AI providers", exact: true }).click();
  await declineClaudeBilling(page);
  await expect(page.getByTestId("cairngorm-agent")).toBeVisible();
  await expect(
    page.getByTestId("integration-codex").getByText("Login detected", { exact: true }),
  ).toBeVisible();
}

const openConfigure = (page: import("@playwright/test").Page) =>
  page.getByTestId("integration-codex").getByRole("button", { name: "Configure" }).click();

test("first launch asks consent for detected subscriptions, then verifies and drafts a commit", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1200, height: 900 });
  await seed(page);
  const setup = page.getByTestId("integration-onboarding");
  await expect(setup).toBeVisible();
  await expect(setup.getByTestId("cairngorm-agent")).toContainText("Used by");
  await declineClaudeBilling(page);
  const consent = page.getByTestId("subscription-consent");
  await expect(consent).toBeVisible();
  await expect(consent).toContainText("Codex");
  await expect(consent).not.toContainText("Claude Code");
  await consent.screenshot({
    path: "logs/e2e/ai-subscription-consent.png",
    animations: "disabled",
  });
  await consent.getByRole("button", { name: "Not now" }).click();
  await expect(setup).toContainText(
    "does not export logins, copy tokens or transfer subscriptions",
  );
  await expect(
    setup.getByTestId("integration-claude").getByRole("button", { name: "Verify & use" }),
  ).toBeDisabled();
  await setup.screenshot({
    path: "logs/e2e/ai-integrations-first-run.png",
    animations: "disabled",
  });
  await setup
    .getByTestId("integration-codex")
    .getByRole("button", { name: "Verify & use" })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).__AI_CALLS__.filter((x: any) => x.cmd === "connect_ai_service"),
    ),
  ).toEqual([]);
  await consent.getByRole("button", { name: "Allow" }).click();
  await expect(setup.getByText("In use by Cairngorm", { exact: true })).toBeVisible();
  await setup.screenshot({
    path: "logs/e2e/ai-integrations-connected.png",
    animations: "disabled",
  });
  await setup.getByRole("button", { name: "Continue to Cairngorm" }).click();
  await expect(setup).not.toBeVisible();
  await page.getByTestId("sidebar-git-toggle").click();
  await page.getByRole("button", { name: "AI summarize", exact: true }).click();
  await expect(page.getByTestId("git-commit-message")).toHaveValue(
    "feat: reuse the existing Codex login",
  );
  expect(
    await page.evaluate(() =>
      (window as any).__AI_CALLS__.some((x: any) => x.cmd === "git_commit"),
    ),
  ).toBe(false);
});

test("settings shows the Cairngorm agent and subscriptions, keeps API fields out of General and works narrow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await seed(page, true);
  await openProviders(page);
  await expect(page.getByTestId("integration-onboarding")).not.toBeVisible();
  for (const id of ["codex", "claude"]) {
    const logo = page.getByTestId(`integration-${id}`).locator("img").first();
    await expect(logo).toBeVisible();
    await expect
      .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
  }
  await page.getByRole("button", { name: "Scan again" }).click();
  await expect(page.getByRole("button", { name: "Scan again" })).toBeEnabled();
  const api = page.getByTestId("agent-settings");
  await api.getByLabel("Model", { exact: true }).fill("gpt-4o-mini");
  await api.getByRole("button", { name: "Save", exact: true }).click();
  await expect(api.getByTestId("agent-status")).toContainText("Saved");
  expect(await page.evaluate(() => (window as any).__SAVED_API__.model)).toBe("gpt-4o-mini");
  await page
    .getByTestId("settings-dialog")
    .screenshot({ path: "logs/e2e/ai-providers-api.png", animations: "disabled" });
  await page.setViewportSize({ width: 720, height: 780 });
  const body = page.locator("[data-settings-body]");
  expect(await body.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  await api.getByLabel("Model", { exact: true }).fill("gpt-4o");
  await api.getByRole("button", { name: "Save", exact: true }).click();
  await expect(api.getByTestId("agent-status")).toContainText("Saved");
  expect(await page.evaluate(() => (window as any).__SAVED_API__.model)).toBe("gpt-4o");
  await page
    .getByTestId("settings-dialog")
    .screenshot({ path: "logs/e2e/ai-providers-narrow.png", animations: "disabled" });
  await page.getByRole("button", { name: "General", exact: true }).click();
  await expect(api).toHaveCount(0);
  await expect(page.getByLabel("API key", { exact: true })).toHaveCount(0);
});

test("runtime paths require saving before verification, and changing accounts requires re-verification", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await seed(page, true);
  await openProviders(page);
  const codex = page.getByTestId("integration-codex");
  await codex.getByRole("button", { name: "Verify & use" }).click();
  await expect(codex.getByText("In use by Cairngorm")).toBeVisible();
  await openConfigure(page);
  await codex.getByLabel("Binary path", { exact: true }).fill("C:/tools/Codex/codex.exe");
  await codex.getByLabel("CODEX_HOME path", { exact: true }).fill("C:/accounts/codex-existing");
  await expect(codex.getByRole("button", { name: "Verify again" })).toBeDisabled();
  await codex.getByRole("button", { name: "Save paths & scan" }).click();
  await expect(
    page.getByText("Codex paths saved. Verify access before using this setup for commits."),
  ).toBeVisible();
  await expect(codex.getByText("In use by Cairngorm")).not.toBeVisible();
  const saved = await page.evaluate(() =>
    (window as any).__AI_CALLS__.find((x: any) => x.cmd === "save_ai_runtime"),
  );
  expect(saved.args).toEqual({
    id: "codex",
    runtime: { binaryPath: "C:/tools/Codex/codex.exe", homePath: "C:/accounts/codex-existing" },
  });
  await codex.getByRole("button", { name: "Verify & use" }).click();
  await expect(codex.getByText("In use by Cairngorm")).toBeVisible();
  await page.evaluate(() => {
    (window as any).__RUNTIME_ERROR__ = true;
  });
  await codex.getByLabel("Binary path", { exact: true }).fill("C:/missing/codex.exe");
  await codex.getByRole("button", { name: "Save paths & scan" }).click();
  await expect(page.getByRole("alert")).toContainText("CLI executable not found");
  await expect(codex.getByText("In use by Cairngorm")).toBeVisible();
  await expect(codex.getByLabel("Binary path", { exact: true })).toHaveValue(
    "C:/missing/codex.exe",
  );
});
