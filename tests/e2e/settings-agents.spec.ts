import { test, expect } from "./fixtures";

// Stateful fakes of the native skills and MCP commands.
test.beforeEach(async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app.waitForSelector('[data-testid="sidebar"]');
  await app.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    const skill = (name: string, harness: string, harnessName: string, description: string) => ({
      name,
      description,
      harness,
      harnessName,
      linkedFrom: harness === "agents" ? ["droid"] : [],
      dir: `C:/Users/Dev/.${harness}/skills/${name}`,
      file: `C:/Users/Dev/.${harness}/skills/${name}/SKILL.md`,
      enabled: true,
    });
    const skills = [
      skill("code-review", "agents", "Agents", "Review changes since a fixed point."),
      skill("diagnosing-bugs", "claude", "Claude Code", "Diagnosis loop for hard bugs."),
      skill("caveman", "opencode", "opencode", "Ultra-compressed communication mode."),
    ];
    const server = (agent: string, agentName: string, name: string, extra: object = {}) => ({
      agent,
      agentName,
      name,
      scope: "user",
      transport: "stdio",
      target: `npx -y @example/${name}`,
      configPath:
        agent === "codex" ? "C:/Users/Dev/.codex/config.toml" : "C:/Users/Dev/.claude.json",
      enabled: true,
      managed: false,
      ...extra,
    });
    let servers = [
      server("claude", "Claude Code", "cairngorm", {
        managed: true,
        target: "node C:/plugins/mcp-bridge.cjs",
      }),
      server("claude", "Claude Code", "firecrawl", {
        transport: "http",
        target: "https://mcp.firecrawl.dev/mcp",
      }),
      server("claude", "Claude Code", "paper", { scope: "local" }),
      server("codex", "Codex", "github", { enabled: false }),
    ];
    const agents = [
      { id: "claude", name: "Claude Code", configPath: "C:/Users/Dev/.claude.json" },
      { id: "codex", name: "Codex", configPath: "C:/Users/Dev/.codex/config.toml" },
    ];
    (window as any).__MCP_ADDED__ = [];
    internals.invoke = (cmd: string, args: any) => {
      if (cmd === "skills_list") return Promise.resolve(skills);
      if (cmd === "skills_roots")
        return Promise.resolve([
          { id: "agents", name: "Agents", path: "C:/Users/Dev/.agents/skills", exists: true },
          { id: "claude", name: "Claude Code", path: "C:/Users/Dev/.claude/skills", exists: true },
        ]);
      if (cmd === "skills_set_enabled") {
        skills.find((s) => s.dir === args.dir)!.enabled = args.enabled;
        return Promise.resolve(skills);
      }
      if (cmd === "mcp_servers_list") return Promise.resolve({ servers, agents });
      if (cmd === "mcp_server_remove") {
        servers = servers.filter((s) => !(s.agent === args.agent && s.name === args.name));
        return Promise.resolve({ servers, agents });
      }
      if (cmd === "mcp_server_add") {
        (window as any).__MCP_ADDED__.push(args);
        return Promise.resolve([]);
      }
      return original(cmd, args);
    };
  });
  await app.keyboard.press("Control+Comma");
});

test("settings pages live in a grouped sidebar", async ({ app }) => {
  const dialog = app.getByTestId("settings-dialog");
  const nav = dialog.getByRole("navigation", { name: "Settings pages" });
  await expect(nav.getByRole("group", { name: "Cairngorm agent" })).toContainText("AI providers");
  await expect(nav.getByRole("group", { name: "Your CLI agents" })).toContainText("MCP servers");
  await expect(nav.getByRole("group", { name: "Your CLI agents" })).not.toContainText(
    "AI providers",
  );
  await nav.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Skills", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dialog.getByTestId("skill-settings")).toBeVisible();
});

test("skills: filter by folder, turn one off, preview the file", async ({ app }) => {
  const dialog = app.getByTestId("settings-dialog");
  await dialog.getByRole("button", { name: "Skills", exact: true }).click();
  const page = dialog.getByTestId("skill-settings");
  await expect(page).toContainText("3 skills");
  await expect(page).toContainText("also in Droid");
  await page.screenshot({ path: "logs/e2e/settings-skills.png", animations: "disabled" });
  await page
    .getByRole("group", { name: "Skill folders" })
    .getByRole("button", { name: /Claude Code/ })
    .click();
  await expect(page.getByTestId("skill-claude-diagnosing-bugs")).toBeVisible();
  await expect(page.getByTestId("skill-agents-code-review")).toHaveCount(0);
  await page.getByTestId("skill-toggle-diagnosing-bugs").click();
  await expect(page.getByTestId("skill-toggle-diagnosing-bugs")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page).toContainText("1 off");
});

test("mcp: lists servers per agent, removes one and adds one", async ({ app }) => {
  const dialog = app.getByTestId("settings-dialog");
  await dialog.getByRole("button", { name: "MCP servers", exact: true }).click();
  const page = dialog.getByTestId("mcp-settings");
  await expect(page.getByTestId("mcp-claude-user-firecrawl")).toContainText(
    "https://mcp.firecrawl.dev/mcp",
  );
  await expect(page.getByTestId("mcp-claude-local-paper")).toContainText("This project (private)");
  await expect(page.getByTestId("mcp-claude-user-cairngorm")).toContainText("Cairngorm plugins");
  await expect(
    page.getByTestId("mcp-claude-user-cairngorm").getByRole("button", { name: "Remove" }),
  ).toHaveCount(0);
  await page.screenshot({ path: "logs/e2e/settings-mcp.png", animations: "disabled" });
  await page
    .getByTestId("mcp-claude-user-firecrawl")
    .getByRole("button", { name: "Remove" })
    .click();
  await app.getByTestId("confirm-dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("mcp-claude-user-firecrawl")).toHaveCount(0);
  await page.getByRole("button", { name: "Add server" }).click();
  const add = app.getByRole("dialog", { name: "Add MCP server" });
  await add.getByLabel("Name").fill("github");
  await add.getByLabel("Command").fill('npx -y "@modelcontextprotocol/server-github"');
  await add.getByRole("switch", { name: "Add to Codex" }).click();
  await add.getByRole("button", { name: "Add server" }).click();
  await expect(add).toHaveCount(0);
  const added = await app.evaluate(() => (window as any).__MCP_ADDED__);
  expect(added).toEqual([
    {
      agents: ["claude"],
      server: {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        url: "",
      },
    },
  ]);
});
