"""Exercise POSIX hook processes and the startup argument parser without a model."""
import json
import os
from pathlib import Path
import subprocess
import runpy
import sys

folder = Path("logs/native/claude-permissions-unix").resolve()
folder.mkdir(parents=True, exist_ok=True)
report = folder / "terminal.json"
hook = Path("src/integrations/assets/agent-session-hook.py").resolve()
env = {**os.environ, "CAIRNGORM_SESSION_REPORT": str(report)}
env.pop("CURSOR_VERSION", None)


def read():
    return json.loads(report.read_text())


def run(**fields):
    subprocess.run(
        [sys.executable, str(hook), "claude"],
        input=json.dumps({"session_id": "root", **fields}),
        text=True, env=env, check=True, timeout=5,
    )


run(hook_event_name="UserPromptSubmit", permission_mode="bypassPermissions")
assert read()["permission_mode"] == "bypassPermissions"
run(permission_mode="private-text")
assert "permission_mode" not in read()
run(hook_event_name="Stop", permission_mode="plan")
assert read()["permission_mode"] == "plan"
run(hook_event_name="SessionEnd")
assert read()["permission_mode"] == "plan"
run(session_id="other", hook_event_name="Stop")
assert "permission_mode" not in read()
run(agent_id="child", permission_mode="bypassPermissions")
assert read()["id"] == "other"

# Codex runs Claude's imported hook through a shell; the launching CLI owns the report.
launcher = (
    "import subprocess, sys, json; subprocess.run(['sh', '-c', sys.argv[1]], check=True, "
    "input=json.dumps({'session_id': 'codex-thread', 'permission_mode': 'bypassPermissions'}), text=True)"
)
subprocess.run(
    ["bash", "-c", 'exec -a codex "$0" -c "$1" "$2"', sys.executable, launcher,
     f"'{sys.executable}' '{hook}' claude"],
    env=env, check=True, timeout=10,
)
assert read() == {"agent": "codex", "id": "codex-thread", "cwd": None, "permission_mode": "bypassPermissions"}, read()

def launch_as(name, payload, *flags):
    runner = (
        "import subprocess, sys; subprocess.run(['sh', '-c', sys.argv[1]], check=True, input=sys.argv[2], text=True)"
    )
    subprocess.run(
        ["bash", "-c", f'exec -a {name} "$0" -c "$1" "$2" "$3" "${{@:4}}"', sys.executable, runner,
         f"'{sys.executable}' '{hook}' claude", json.dumps(payload), *flags],
        env=env, check=True, timeout=10,
    )


launch_as("cursor-agent", {"conversation_id": "chat", "workspace_roots": ["/repo"]}, "--yolo", "--model", "x", "--sandbox=disabled")
assert read() == {"agent": "cursor", "id": "chat", "cwd": "/repo", "flags": ["--yolo", "--sandbox=disabled"]}, read()
launch_as("grok", {"sessionId": "g1", "permissionMode": "plan", "hook_event_name": "SessionStart"})
assert read() == {"agent": "grok", "id": "g1", "cwd": None, "permission_mode": "plan"}, read()
launch_as("grok", {"sessionId": "g1", "hook_event_name": "Stop"})
assert read()["permission_mode"] == "plan", "events without a mode keep the session's mode"
launch_as("codex", {"session_id": "headless"}, "exec", "do it")
assert read()["id"] == "g1", "headless runs must not own the pane"

# The Node suite exercises ancestry too; this parser check also runs where Node is unavailable.
parse = runpy.run_path(str(hook))["launch_permission_mode"]
for args, expected in [
    (["--dangerously-skip-permissions"], "bypassPermissions"),
    (["--permission-mode", "acceptEdits"], "acceptEdits"),
    (["--permission-mode=plan"], "plan"),
    (["--allow-dangerously-skip-permissions"], None),
    (["a prompt mentioning --dangerously-skip-permissions"], None),
    (["--system-prompt", "--dangerously-skip-permissions"], None),
    (["--system-prompt", "--permission-mode=private-text"], None),
    (["--unknown-option", "--dangerously-skip-permissions"], None),
    (["--resume", "uuid-123", "--dangerously-skip-permissions"], "bypassPermissions"),
    (["--model=opus", "--dangerously-skip-permissions"], "bypassPermissions"),
    (["--", "--dangerously-skip-permissions"], None),
    ([], None),
]:
    assert parse(args) == expected, args
print("PASS: POSIX permission updates, startup argv, session isolation and prompt injection rejection.")
