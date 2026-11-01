import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = path.resolve("logs/native/claude-permissions");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "terminal.json");
const windows = process.platform === "win32";
const hook = path.resolve(`src/integrations/assets/agent-session-hook.${windows ? "ps1" : "py"}`);
const program = windows ? "powershell.exe" : "python3";
const args = windows
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", hook, "claude"]
  : [hook, "claude"];
const env = { ...process.env, CAIRNGORM_SESSION_REPORT: file };
delete env.CURSOR_VERSION;
const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
const payload = (extra = {}) => ({ session_id: "claude-root", cwd: "C:/repo", ...extra });
function run(input, overrides = {}) {
  const child = spawnSync(program, args, {
    input: JSON.stringify(input),
    env: { ...env, ...overrides },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
}

run(
  payload({
    hook_event_name: "UserPromptSubmit",
    permission_mode: "bypassPermissions",
    prompt: "do not persist prompts",
  }),
);
assert.equal(read().permission_mode, "bypassPermissions");
assert.equal(read().prompt, undefined);
run(payload({ permission_mode: "private-text" }));
assert.equal(read().permission_mode, undefined, "unknown modes must never be persisted");
run(payload({ hook_event_name: "Stop", permission_mode: "plan" }));
assert.equal(read().permission_mode, "plan", "a more restrictive mode must replace bypass");
run(payload({ hook_event_name: "SessionEnd" }));
assert.equal(
  read().permission_mode,
  "plan",
  "events without a mode must preserve the same session",
);
run(payload({ session_id: "other", hook_event_name: "UserPromptSubmit" }));
assert.equal(read().permission_mode, undefined, "a new session must not inherit permissions");
run(payload({ permission_mode: "bypassPermissions", agent_id: "child-agent" }));
assert.equal(read().id, "other", "subagents must not overwrite the root");
run(payload({ permission_mode: "bypassPermissions" }), { CURSOR_VERSION: "1" });
assert.equal(read().id, "other", "Cursor must not overwrite the root");

// A fake CLI only launches the real bridge: no model, credentials or agent installation needed.
const fixture = path.join(dir, "node_modules/@anthropic-ai/claude-code/cli.js");
fs.mkdirSync(path.dirname(fixture), { recursive: true });
fs.writeFileSync(
  fixture,
  `const { spawnSync } = require("node:child_process");
const child = spawnSync(${JSON.stringify(program)}, ${JSON.stringify(args)}, {
  input: JSON.stringify({ session_id: "startup", hook_event_name: "SessionStart" }),
  env: process.env, stdio: ["pipe", "pipe", "pipe"]
});
process.stderr.write(child.stderr || "");
process.exit(child.status ?? 1);
`,
);
for (const [launchArgs, expected] of [
  [["--dangerously-skip-permissions"], "bypassPermissions"],
  [["--permission-mode", "acceptEdits"], "acceptEdits"],
  [["--permission-mode=plan"], "plan"],
  [["--allow-dangerously-skip-permissions"], undefined],
  [["a prompt mentioning --dangerously-skip-permissions"], undefined],
  [["--system-prompt", "--dangerously-skip-permissions"], undefined],
  [["--system-prompt", "--permission-mode=private-text"], undefined],
  [["--unknown-option", "--dangerously-skip-permissions"], undefined],
  [["--resume", "uuid-123", "--dangerously-skip-permissions"], "bypassPermissions"],
  [["--model=opus", "--dangerously-skip-permissions"], "bypassPermissions"],
  [["--", "--dangerously-skip-permissions"], undefined],
  [[], undefined],
]) {
  const child = spawnSync(process.execPath, [fixture, ...launchArgs], {
    env,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  assert.equal(read().permission_mode, expected, JSON.stringify(launchArgs));
}

if (windows) {
  // Managed Windows may run hooks in ConstrainedLanguage. Simulated only inside this child:
  // its language mode is verified, then the hook receives stdin as it does with -File.
  fs.rmSync(file, { force: true });
  const hookPath = `'${hook.replaceAll("'", "''")}'`;
  const constrained = spawnSync(
    program,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'; ` +
        `Write-Output ('MODE=' + $ExecutionContext.SessionState.LanguageMode); ` +
        `$input | & ${hookPath} claude`,
    ],
    {
      input: JSON.stringify(
        payload({ hook_event_name: "Stop", permission_mode: "plan", prompt: "secret" }),
      ),
      env,
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(constrained.status, 0, constrained.stderr || constrained.error?.message);
  assert.match(constrained.stdout, /MODE=ConstrainedLanguage/);
  assert.ok(fs.existsSync(file), "ConstrainedLanguage must still write the session report");
  assert.notEqual(
    fs.readFileSync(file)[0],
    0xef,
    "the report must not start with a byte-order mark",
  );
  assert.deepEqual(read(), {
    agent: "claude",
    id: "claude-root",
    cwd: "C:/repo",
    permission_mode: "plan",
  });

  // Grok runs Claude's imported hook under Node: without Add-Type it must still be named grok,
  // and a non-ASCII value must be written as escaped ASCII JSON.
  const grok = path.join(dir, "node_modules/@xai-official/grok/cli.js");
  fs.mkdirSync(path.dirname(grok), { recursive: true });
  fs.writeFileSync(
    grok,
    `const { spawnSync } = require("node:child_process");
const child = spawnSync(${JSON.stringify(program)}, ${JSON.stringify([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'; $input | & ${hookPath} claude`,
    ])}, { input: process.argv[2], env: process.env, stdio: ["pipe", "pipe", "pipe"] });
process.stderr.write(child.stderr || "");
process.exit(child.status ?? 1);
`,
  );
  const shared = spawnSync(
    process.execPath,
    [grok, JSON.stringify({ sessionId: "grok-1", cwd: "C:/r\u00e9po \u{1F600}" })],
    { env, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(shared.status, 0, shared.stderr || shared.error?.message);
  assert.equal(read().agent, "grok", "a Node agent running a shared hook must not be misnamed");
  assert.equal(read().id, "grok-1");
  assert.ok(
    fs.readFileSync(file).every((byte) => byte < 0x80),
    "the report must be ASCII JSON",
  );
}
console.log(
  "PASS: Claude permission updates, restrictive changes, session/child isolation and startup argv capture (including prompt injection rejection).",
);
