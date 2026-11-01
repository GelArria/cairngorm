import path from "node:path";

/** Native QA may register agents: no inherited configuration path may escape its profile. */
export function freshProfileEnv(inherited, scratch, endpoint) {
  const env = { ...inherited };
  const replaced = new Set([
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "WEBVIEW2_USER_DATA_FOLDER",
    "CAIRNGORM_FRESH_HOME",
    "CAIRNGORM_FRESH_CDP",
    "NODE_OPTIONS",
    "CAIRNGORM_TEST_ENDPOINT",
    "CAIRNGORM_TEST_TOKEN",
    "CAIRNGORM_TEST_BINARY",
    "CAIRNGORM_NATIVE_PLUGIN_CHECK",
    "PANEL_REMOTE_DEBUGGING",
    "CAIRNGORM_AGENT_DIR",
    "PANEL_AGENT_DIR",
    "PI_CODING_AGENT_DIR",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "KIMI_CODE_HOME",
    "GEMINI_CLI_HOME",
    "KIRO_HOME",
  ]);
  // Windows environment names are case-insensitive, even when this plain object is not.
  for (const key of Object.keys(env)) {
    if (replaced.has(key.toUpperCase()) || /(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/i.test(key)) {
      delete env[key];
    }
  }
  return {
    ...env,
    HOME: scratch,
    USERPROFILE: scratch,
    APPDATA: path.join(scratch, "AppData/Roaming"),
    LOCALAPPDATA: path.join(scratch, "AppData/Local"),
    WEBVIEW2_USER_DATA_FOLDER: path.join(scratch, "webview"),
    CAIRNGORM_FRESH_HOME: scratch,
    CAIRNGORM_FRESH_CDP: endpoint,
  };
}
