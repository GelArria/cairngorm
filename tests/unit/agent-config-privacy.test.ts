import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "agent-privacy-"));
  dirs.push(home);
  mkdirSync(join(home, ".factory"));
  writeFileSync(
    join(home, ".factory", "settings.json"),
    JSON.stringify({
      customModels: [
        {
          model: "personal-model",
          baseUrl: "https://personal.invalid/v1",
          apiKey: "private-factory-test-key",
        },
      ],
    }),
  );
  const dir = join(home, ".panel", "agent");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CAIRNGORM_AGENT_DIR: dir,
    PANEL_AGENT_DIR: dir,
    OPENAI_API_KEY: "private-env-test-key",
    OLLAMA_API_KEY: "private-ollama-test-key",
  };
  return { dir, env, path: join(dir, "config.json") };
}

const script = resolve("scripts/ensure-agent-config.mjs");
describe("agent credential privacy", () => {
  it("setup starts blank, preserves saved settings and only clears them on explicit reset", () => {
    const f = fixture();
    const run = (...args: string[]) =>
      execFileSync(process.execPath, [script, ...args], { env: f.env });
    run();
    expect(JSON.parse(readFileSync(f.path, "utf8"))).toMatchObject({ model: "", baseUrl: "" });
    expect(readFileSync(f.path, "utf8")).not.toContain("private-");
    const saved = JSON.stringify({
      provider: "ollama",
      model: "user-model",
      baseUrl: "https://user.invalid/v1",
      apiKey: "explicit-test-key",
    });
    writeFileSync(f.path, saved);
    run();
    expect(readFileSync(f.path, "utf8")).toBe(saved);
    run("--reset");
    expect(JSON.parse(readFileSync(f.path, "utf8"))).toMatchObject({ model: "", baseUrl: "" });
    expect(readFileSync(f.path, "utf8")).not.toContain("explicit-test-key");
  });

  it("agent runtime neither auto-selects from env/Factory nor borrows a Factory key", () => {
    const f = fixture();
    const config = resolve("src/agent/core/src/config.ts").replaceAll("\\", "/");
    const resolver = resolve("src/agent/core/src/model-resolver.ts").replaceAll("\\", "/");
    const source = `
      import { ensureConfig } from ${JSON.stringify(config)};
      import { resolveModel } from ${JSON.stringify(resolver)};
      const config = ensureConfig();
      if (config.model || config.baseUrl || resolveModel(config, 'gpt-4o').apiKey) throw Error('Implicit provider');
      delete process.env.OPENAI_API_KEY;
      const configured = { ...config, model: 'explicit-model', baseUrl: 'https://user.invalid/v1' };
      if (resolveModel(configured).apiKey) throw Error('Borrowed Factory key');
      process.env.OPENAI_API_KEY = 'explicit-test-key';
      if (resolveModel(configured).apiKey !== 'explicit-test-key') throw Error('Explicit config broken');
      console.log('privacy checks passed');
    `;
    const output = execFileSync("bun", ["--eval", source], { env: f.env, encoding: "utf8" });
    expect(output.trim()).toBe("privacy checks passed");
    expect(readFileSync(f.path, "utf8")).not.toContain("private-");
  });
});
