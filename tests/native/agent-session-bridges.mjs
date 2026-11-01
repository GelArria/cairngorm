import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const dir = path.resolve("logs/native/session-bridges");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "terminal.json");
process.env.CAIRNGORM_SESSION_REPORT = file;
const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
const source = fs.readFileSync("src/integrations/assets/pi-session.ts", "utf8");
fs.writeFileSync(
  path.join(dir, "pi.mjs"),
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText,
);
const pi = (await import(pathToFileURL(path.join(dir, "pi.mjs")))).default;
const handlers = {};
pi({
  on: (name, cb) => {
    handlers[name] = cb;
  },
});
const ctx = (id) => ({
  mode: "tui",
  cwd: "C:/repo",
  sessionManager: { getSessionId: () => id, getSessionFile: () => `C:/sessions/${id}.jsonl` },
});
handlers.session_start({}, ctx("pi-first"));
assert.equal(read().id, "pi-first");
handlers.session_start({}, ctx("pi-new-or-resumed"));
assert.equal(read().id, "pi-new-or-resumed");
handlers.agent_start({}, { ...ctx("child-agent"), mode: "json" });
assert.equal(read().id, "pi-new-or-resumed", "headless child must not steal the pane UUID");
{
  // Restrictive launch flags travel with the session; trust (--approve) and prompts never do.
  const argv = process.argv;
  process.argv = [argv[0], "cli.js", "--tools", "read,grep", "--approve", "--plan", "a prompt"];
  const launched = {};
  pi({ on: (name, cb) => (launched[name] = cb) });
  process.argv = argv;
  launched.session_start({}, ctx("pi-flags"));
  assert.deepEqual(read().flags, ["--tools", "read,grep", "--plan"]);
}

const plugin = (
  await import(pathToFileURL(path.resolve("src/integrations/assets/opencode-session.js")))
).default;
let route = { type: "session", sessionID: "ses_first" };
const dispose = plugin.setup({
  ui: { router: { current: () => route } },
  data: { session: { get: (id) => ({ id, directory: "C:/repo" }) } },
});
assert.equal(read().id, "ses_first");
route = { type: "session", sessionID: "ses_selected" };
await new Promise((r) => setTimeout(r, 350));
assert.equal(read().id, "ses_selected");
dispose();
let stop;
await plugin.tui({
  route: { current: { name: "session", params: { sessionID: "ses_v2" } } },
  state: { session: { get: (id) => ({ id }) } },
  lifecycle: {
    onDispose: (cb) => {
      stop = cb;
    },
  },
});
assert.equal(read().id, "ses_v2");
stop();

if (process.platform === "win32") {
  for (const agent of ["droid", "claude"]) {
    const child = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "src/integrations/assets/agent-session-hook.ps1",
        agent,
      ],
      {
        input: JSON.stringify({ session_id: `${agent}-native-uuid`, cwd: "C:/repo" }),
        encoding: "utf8",
        env: process.env,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(read().agent, agent);
    assert.equal(read().id, `${agent}-native-uuid`);
    if (agent === "claude") {
      spawnSync(
        "powershell.exe",
        ["-NoProfile", "-File", "src/integrations/assets/agent-session-hook.ps1", agent],
        {
          input: JSON.stringify({
            session_id: "child-uuid",
            agent_id: "subagent-1",
            cwd: "C:/repo",
          }),
          env: process.env,
        },
      );
      assert.equal(
        read().id,
        "claude-native-uuid",
        "Claude subagent must not steal the root reference",
      );
    }
  }
}
if (process.platform === "win32") {
  // Codex, Grok and Cursor import Claude's hook: the launching agent decides the report.
  const hook = path.resolve("src/integrations/assets/agent-session-hook.ps1");
  for (const [folder, payload, expected, flags = []] of [
    [
      "@openai/codex",
      { session_id: "codex-thread", permission_mode: "bypassPermissions", cwd: "C:/repo" },
      { agent: "codex", id: "codex-thread", permission_mode: "bypassPermissions" },
    ],
    [
      "cursor-agent",
      { conversation_id: "cursor-chat", workspace_roots: ["C:/repo"] },
      { agent: "cursor", id: "cursor-chat", cwd: "C:/repo", flags: ["--yolo", "--mode", "ask"] },
      ["--yolo", "--model", "x", "--mode", "ask"],
    ],
    [
      "@xai-official/grok",
      { sessionId: "grok-session", permissionMode: "auto", hook_event_name: "SessionStart" },
      { agent: "grok", id: "grok-session", permission_mode: "auto" },
    ],
  ]) {
    const fake = path.join(dir, "node_modules", folder, "fake-agent.mjs");
    fs.mkdirSync(path.dirname(fake), { recursive: true });
    fs.writeFileSync(
      fake,
      `import { spawnSync } from "node:child_process";
const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ${JSON.stringify(hook)}, "claude"], { input: process.argv[2], encoding: "utf8" });
process.exit(r.status ?? 1);`,
    );
    const child = spawnSync(process.execPath, [fake, JSON.stringify(payload), ...flags], {
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(child.status, 0, child.stderr);
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(read()[key], value, `${folder} ${key}`);
    }
  }
}
if (process.platform === "win32") {
  // A print/headless run inside the pane must not replace the pane's interactive session.
  const before = read();
  const fake = path.join(dir, "node_modules", "cursor-agent", "fake-agent.mjs");
  const child = spawnSync(
    process.execPath,
    [fake, JSON.stringify({ conversation_id: "headless" }), "-p", "--force"],
    { encoding: "utf8", env: process.env },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(read(), before, "headless runs must not own the pane");
}
if (process.platform === "win32") {
  // Cursor's global hooks also run in the IDE: without a cursor-agent ancestor, never report.
  const before = read();
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "src/integrations/assets/agent-session-hook.ps1",
      "cursor",
    ],
    { input: JSON.stringify({ conversation_id: "ide-chat" }), env: process.env },
  );
  assert.deepEqual(read(), before, "the Cursor IDE must not overwrite the pane");
}
delete process.env.CAIRNGORM_SESSION_REPORT;
const previous = read();
handlers.session_start({}, ctx("outside"));
assert.deepEqual(read(), previous, "outside Cairngorm the report must remain untouched");
assert.equal(plugin.setup({}), undefined, "outside Cairngorm no polling or API access");
console.log(
  "PASS: Pi session switches + child isolation; OpenCode selected TUI v1/v2; native Droid/Claude hooks; inert outside Cairngorm.",
);
