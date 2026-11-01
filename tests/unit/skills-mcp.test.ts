import { describe, expect, it } from "vitest";
import { filterSkills, skillNameProblem, type Skill } from "@/skills/data/skills-api";
import { filterServers, splitCommand, type McpServer } from "@/plugins/data/mcp-api";

const skill = (name: string, harness: string, linkedFrom: string[] = []): Skill => ({
  name,
  description: `${name} description`,
  harness,
  harnessName: harness,
  linkedFrom,
  dir: `/s/${name}`,
  file: `/s/${name}/SKILL.md`,
  enabled: true,
});

describe("skills", () => {
  it("validates names every harness accepts", () => {
    expect(skillNameProblem("review-db")).toBeUndefined();
    expect(skillNameProblem("Review")).toBeTruthy();
    expect(skillNameProblem("-x")).toBeTruthy();
    expect(skillNameProblem("x-")).toBeTruthy();
  });
  it("filters by text and by harness, counting linked folders", () => {
    const list = [skill("alpha", "agents", ["claude"]), skill("beta", "claude")];
    expect(filterSkills(list, "alp", "all").map((s) => s.name)).toEqual(["alpha"]);
    expect(filterSkills(list, "", "claude").map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(filterSkills(list, "", "agents").map((s) => s.name)).toEqual(["alpha"]);
  });
});

describe("mcp servers", () => {
  it("splits commands keeping quoted parts", () => {
    expect(splitCommand('npx -y "@scope/pkg name" --flag')).toEqual([
      "npx",
      "-y",
      "@scope/pkg name",
      "--flag",
    ]);
  });
  it("filters by agent and text", () => {
    const server = (name: string, agent: string): McpServer => ({
      agent,
      agentName: agent,
      name,
      scope: "user",
      transport: "stdio",
      target: "node x.js",
      configPath: "/c",
      enabled: true,
      managed: false,
    });
    const list = [server("github", "claude"), server("paper", "codex")];
    expect(filterServers(list, "", "codex").map((s) => s.name)).toEqual(["paper"]);
    expect(filterServers(list, "git", "all").map((s) => s.name)).toEqual(["github"]);
  });
});
