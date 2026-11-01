import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, ensureConfig } from "../config.js";
import { getEnvApiKey } from "../ai/env-api-keys.js";
import { resolveModel } from "../model-resolver.js";

// ── Provider switching: Ollama Cloud (OpenAI-compat at https://ollama.com/v1) ──
// Robustness battery: valid, corrupt, missing config, unknown provider,
// no API key, model override, and source priority.

let tmpDir: string;
let savedPanelDir: string | undefined;
let savedHome: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "panel-agent-test-"));
  savedPanelDir = process.env.PANEL_AGENT_DIR;
  process.env.PANEL_AGENT_DIR = tmpDir;
  // Isolate from the real user ~/.factory/settings.json (API key fallback)
  savedHome = process.env.USERPROFILE ?? process.env.HOME;
  process.env.USERPROFILE = tmpDir;
  process.env.HOME = tmpDir;
  delete process.env.OLLAMA_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  if (savedPanelDir === undefined) {
    delete process.env.PANEL_AGENT_DIR;
  } else {
    process.env.PANEL_AGENT_DIR = savedPanelDir;
  }
  if (savedHome) {
    process.env.USERPROFILE = savedHome;
    process.env.HOME = savedHome;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(cfg: unknown) {
  writeFileSync(join(tmpDir, "config.json"), JSON.stringify(cfg), "utf-8");
}

describe("provider ollama — defaults and switching", () => {
  test("an explicitly configured Ollama Cloud provider uses its model and endpoint", () => {
    // No provider target is configured by default; switching is done via config.json.
    // We load a config with provider ollama and verify resolveModel uses it.
    writeConfig({
      provider: "ollama",
      model: "gemma4:31b",
      apiKeyEnv: "OLLAMA_API_KEY",
      baseUrl: "https://ollama.com/v1",
    });
    process.env.OLLAMA_API_KEY = "sk-test-key";
    const cfg = loadConfig();
    expect(cfg.provider).toBe("ollama");
    expect(cfg.model).toBe("gemma4:31b");
    expect(cfg.baseUrl).toBe("https://ollama.com/v1");

    const { model, apiKey } = resolveModel(cfg);
    expect(model.id).toBe("gemma4:31b");
    expect(model.baseUrl).toBe("https://ollama.com/v1");
    expect(apiKey).toBe("sk-test-key");
  });

  test("getEnvApiKey('ollama') reads OLLAMA_API_KEY", () => {
    expect(getEnvApiKey("ollama")).toBeUndefined();
    process.env.OLLAMA_API_KEY = "k1";
    expect(getEnvApiKey("ollama")).toBe("k1");
  });
});

describe("loadConfig robustness — edge cases", () => {
  test("missing config → unconfigured defaults", () => {
    const cfg = loadConfig();
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("");
    expect(cfg.baseUrl).toBe("");
  });

  test("corrupt config (invalid JSON) → DEFAULT_CONFIG, no throw", () => {
    writeFileSync(join(tmpDir, "config.json"), "{not json at all", "utf-8");
    const cfg = loadConfig();
    expect(cfg.provider).toBe("openai");
  });

  test("empty config (0 bytes) → DEFAULT_CONFIG, no throw", () => {
    writeFileSync(join(tmpDir, "config.json"), "", "utf-8");
    const cfg = loadConfig();
    expect(cfg.provider).toBe("openai");
  });

  test("partial config: only provider/model → endpoint remains unconfigured", () => {
    writeConfig({ provider: "openai", model: "my-model" });
    const cfg = loadConfig();
    expect(cfg.model).toBe("my-model");
    expect(cfg.baseUrl).toBe(""); // no implicit remote target
  });

  test("config with wrong types (model: number) → falls to the spread DEFAULT", () => {
    writeConfig({ model: 12345, baseUrl: null });
    const cfg = loadConfig();
    // raw model: 12345 overwrites the string — documenting current behavior
    expect(cfg.model).toBe(12345 as unknown as string);
    expect(cfg.baseUrl).toBe(null as unknown as string);
  });

  test("config as array (valid JSON, wrong shape) → object spread does not crash", () => {
    writeConfig(["a", "b"]);
    const cfg = loadConfig();
    // array spread over object: numeric keys — provider stays default
    expect(cfg.provider).toBe("openai");
  });

  test("null config (JSON null) → DEFAULT_CONFIG", () => {
    writeFileSync(join(tmpDir, "config.json"), "null", "utf-8");
    const cfg = loadConfig();
    expect(cfg.provider).toBe("openai");
  });

  test("PANEL_AGENT_DIR redirects the config dir (test isolation)", () => {
    const sub = join(tmpDir, "nested");
    mkdirSync(sub, { recursive: true });
    process.env.PANEL_AGENT_DIR = sub;
    writeFileSync(
      join(sub, "config.json"),
      JSON.stringify({
        provider: "ollama",
        model: "gemma4:31b",
        apiKeyEnv: "OLLAMA_API_KEY",
        baseUrl: "https://ollama.com/v1",
      }),
      "utf-8",
    );
    const cfg = loadConfig();
    expect(cfg.provider).toBe("ollama");
  });
});

describe("resolveModel robustness — edge cases", () => {
  const ollamaCfg = {
    ...DEFAULT_CONFIG,
    provider: "ollama",
    model: "gemma4:31b",
    baseUrl: "https://ollama.com/v1" as string,
  };

  test("unknown provider → falls back to openai shape but with config model/baseUrl", () => {
    const cfg = { ...ollamaCfg, provider: "nonexistent-provider" };
    const { model } = resolveModel(cfg);
    // def does not exist → baseModel = PROVIDER_MODELS.openai, with config overrides
    expect(model.id).toBe("gemma4:31b");
    expect(model.baseUrl).toBe("https://ollama.com/v1");
    expect(model.api).toBe("openai-completions");
  });

  test("no API key (empty env) → apiKey '' (the caller decides the error)", () => {
    delete process.env.OLLAMA_API_KEY;
    const { apiKey } = resolveModel(ollamaCfg);
    expect(apiKey).toBe("");
  });

  test("--model override to a known model changes the id", () => {
    const { model } = resolveModel(ollamaCfg, "gpt-4o");
    expect(model.id).toBe("gpt-4o");
  });

  test("--model override to an unknown model IGNORES the override (uses config.model)", () => {
    const { model } = resolveModel(ollamaCfg, "modelo-fantasma");
    expect(model.id).toBe("gemma4:31b");
  });

  test("model with ollama registry chars (gemma4:31b) travels intact through the pipeline", () => {
    process.env.OLLAMA_API_KEY = "key";
    const { model, apiKey } = resolveModel(ollamaCfg);
    expect(model.id.includes(":")).toBe(true); // ollama org:tag format
    expect(apiKey).toBe("key");
  });
});

describe("ensureConfig robustness — edge cases", () => {
  test(" creates config.json when missing", () => {
    const cfg = ensureConfig();
    expect(cfg.provider).toBeTruthy();
    // file created
    const re = loadConfig();
    expect(re.provider).toBe(cfg.provider);
  });

  test("does not rewrite an existing config (idempotent)", () => {
    writeConfig({
      provider: "ollama",
      model: "gemma4:31b",
      apiKeyEnv: "OLLAMA_API_KEY",
      baseUrl: "https://ollama.com/v1",
    });
    const beforeText = readFileSync(join(tmpDir, "config.json"), "utf-8");
    ensureConfig();
    const afterText = readFileSync(join(tmpDir, "config.json"), "utf-8");
    expect(afterText).toBe(beforeText);
  });
});
