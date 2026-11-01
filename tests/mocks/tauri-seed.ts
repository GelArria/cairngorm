// E2E seed shared by both runners; unknown commands still reject.
export const SEED_INIT = `
(() => {
  const d = new Date();
  const today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  window.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => {
      (window.__CMD_LOG__ = window.__CMD_LOG__ || []).push(cmd + ":" + JSON.stringify(args ?? {}).slice(0, 80));
      if (cmd === "needs_ai_setup" || cmd === "ai_summary_setup_required") return Promise.resolve(false);
      if (cmd === "get_codex_agent_env" || cmd === "get_gemini_agent_env") return Promise.resolve(null);
      if (cmd === "plugins_sync_workspace") return Promise.resolve();
      if (cmd === "scheduled_tasks_list") return Promise.resolve([]);
      if (cmd === "scheduled_tasks_delete_project") return Promise.resolve();
      if (cmd === "plugin:sql|load") return Promise.resolve(null);
      if (cmd === "plugin:sql|execute" && /DELETE\\s+FROM\\s+calendar_events/i.test(String(args?.query))) return Promise.resolve([1, 1]);
    if (cmd === "detect_shells") return Promise.resolve([]);
    if (cmd === "config_read") return Promise.resolve({ path: "C:/mock/cairngorm.json", text: localStorage.getItem("__mock_cairngorm_json") });
    if (cmd === "config_write") { localStorage.setItem("__mock_cairngorm_json", args.text); return Promise.resolve(); }
    if (cmd === "detect_agent_clis") return Promise.resolve([]);
    if (cmd === "resolve_terminal_profile") return Promise.resolve({ shellPath: args.profile.program, shellArgs: args.profile.args });
    if (cmd === "plugin:path|resolve_directory" && args?.directory === 21) return Promise.resolve("C:/repo"); // homeDir → WorkspacePanel default root
    if (cmd === "fs_list_dir") return Promise.resolve([]);
    if (["pty_ensure", "pty_write", "pty_resize", "pty_kill"].includes(cmd)) return Promise.resolve();
    if (cmd === "pty_replay" || cmd === "pty_test_run") return Promise.resolve(null);
    if (cmd === "detect_home") return Promise.resolve(window.__TAURI_HOME__ ?? "C:/repo");
    if (cmd === "git_status") return Promise.resolve({ files: [{ path: "src/app/main.rs", code: "M " }, { path: "src/new.rs", code: "??" }], error: null });
    if (cmd === "git_branches") return Promise.resolve(["main"]);
    if (cmd === "git_branch") return Promise.resolve("main");
    if (cmd === "git_remotes") return Promise.resolve(["origin"]);
    if (cmd === "git_repo_root") return Promise.resolve("C:/repo");
    if (cmd === "git_remote_status") return Promise.resolve({ ahead: 0, behind: 6, remote: "origin", upstream: true });
    if (cmd === "git_sync") return Promise.resolve(null);
    if (cmd === "git_log") return Promise.resolve([{ hash: "abc1234", author: "dev", time: "now", subject: "seed commit" }]);
    if (cmd === "git_stage" || cmd === "git_unstage" || cmd === "git_commit")
      return Promise.resolve({ files: [], error: null });
    if (cmd === "git_file_details")
      return Promise.resolve([
        { path: "src/app/main.rs", hash: "abc1234", author: "GelArria", email: "dev@example.com", at: Math.floor(Date.now() / 1000) - 3600, subject: "seed commit" },
        { path: "src/new.rs", hash: "abc1234", author: "GelArria", email: "dev@example.com", at: Math.floor(Date.now() / 1000) - 3600, subject: "seed commit" },
      ]);
    if (cmd === "git_diff")
      return Promise.resolve("diff --git a/src/app/main.rs b/src/app/main.rs\\n--- a/src/app/main.rs\\n+++ b/src/app/main.rs\\n@@ -1,2 +1,3 @@\\n fn main() {}\\n+// new line\\n");
    if (cmd === "resolve_agent_runner")
      return Promise.resolve({ agentPath: "agent.js", runnerPath: "bun.exe", name: "bun", args: [] });
    if (cmd === "get_agent_env")
      return Promise.resolve({ apiKeyEnv: "API_KEY", keyAvailable: false, baseUrl: null, model: null });
      if (cmd === "plugin:sql|select") {
        const q = String((args && args.query) || "");
        if (/FROM\\s+calendar_events/i.test(q)) {
          return Promise.resolve([
            { id: "e1", title: "Sprint planning", date: today, end_date: null, start_time: "09:00", end_time: "10:00", color: "blue", description: null },
          ]);
        }
        return Promise.reject("no mock data for query");
      }
      return Promise.reject("Unknown command: " + cmd);
    },
  };
  // Event-API shim: app boots with listen() calls (agent-event, terminal-reattach…);
  // without transformCallback the listen TypeError reaches the crash dialog and
  // blocks every click in E2E. Store callbacks so future specs can emit events.
  let cbId = 0;
  const evtCbs = new Map();
  window.__TAURI_INTERNALS__.transformCallback = (cb, once) => {
    const id = ++cbId;
    evtCbs.set(id, cb);
    if (once) evtCbs.delete(id);
    return id;
  };
})();
`;
