import { describe, expect, it } from "vitest";
import path from "node:path";
import { freshProfileEnv } from "../native/fresh-profile-env.mjs";

describe("fresh native profile environment", () => {
  it("does not inherit any agent config override, including Windows case variants", () => {
    const keys = [
      "PI_CODING_AGENT_DIR",
      "CLAUDE_CONFIG_DIR",
      "CODEX_HOME",
      "XDG_CONFIG_HOME",
      "KIMI_CODE_HOME",
      "KIRO_HOME",
      "GEMINI_CLI_HOME",
      "CAIRNGORM_AGENT_DIR",
      "PANEL_AGENT_DIR",
    ];
    const inherited = Object.fromEntries(
      keys.flatMap((key) => [
        [key, "outside"],
        [key.toLowerCase(), "outside"],
      ]),
    );
    const env = freshProfileEnv(inherited, "scratch", "http://127.0.0.1:9337");
    for (const key of keys) {
      expect(env).not.toHaveProperty(key);
      expect(env).not.toHaveProperty(key.toLowerCase());
      expect(inherited[key]).toBe("outside");
    }
  });

  it("does not lend inherited provider credentials to the QA profile", () => {
    const env = freshProfileEnv(
      {
        ANTHROPIC_API_KEY: "test-key",
        openai_api_key: "test-key",
        ANTHROPIC_AUTH_TOKEN: "test-token",
        PATH: "runtime",
      },
      "scratch",
      "http://127.0.0.1:9337",
    );
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("openai_api_key");
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(env.PATH).toBe("runtime");
  });

  it("replaces profile paths and removes observation/native opt-ins without losing PATH", () => {
    const env = freshProfileEnv(
      {
        home: "outside",
        APPDATA: "outside",
        NODE_OPTIONS: "preload",
        cairngorm_native_plugin_check: "1",
        PATH: "runtime",
      },
      "scratch",
      "http://127.0.0.1:9337",
    );
    expect(env).toMatchObject({
      HOME: "scratch",
      USERPROFILE: "scratch",
      APPDATA: path.join("scratch", "AppData/Roaming"),
      LOCALAPPDATA: path.join("scratch", "AppData/Local"),
      CAIRNGORM_FRESH_HOME: "scratch",
      CAIRNGORM_FRESH_CDP: "http://127.0.0.1:9337",
      PATH: "runtime",
    });
    expect(env).not.toHaveProperty("home");
    expect(env).not.toHaveProperty("NODE_OPTIONS");
    expect(env).not.toHaveProperty("cairngorm_native_plugin_check");
  });
});
