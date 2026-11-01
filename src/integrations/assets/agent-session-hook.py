# Managed by Cairngorm. Inert outside its PTYs.
import json
import os
import sys

PERMISSION_MODES = {"default", "manual", "acceptEdits", "plan", "dontAsk", "auto", "bypassPermissions"}
# Executable name or Node package folder => reported agent.
COMMANDS = {"claude": "claude", "codex": "codex", "gemini": "gemini", "qwen": "qwen", "copilot": "copilot", "cursor-agent": "cursor", "grok": "grok", "droid": "droid"}
PACKAGES = {
    "/@anthropic-ai/claude-code/": "claude",
    "/@openai/codex/": "codex",
    "/@google/gemini-cli/": "gemini",
    "/@qwen-code/qwen-code/": "qwen",
    "/@github/copilot/": "copilot",
    "/cursor-agent/": "cursor",
    "/@xai-official/grok/": "grok",
}
SHELLS = {"sh", "bash", "zsh", "dash", "fish", "env"}
# Launch flags carried over on resume (True = takes a value); Cairngorm validates them again.
LAUNCH_FLAGS = {
    "cursor": {"--force": False, "-f": False, "--yolo": False, "--plan": False, "--mode": True, "--sandbox": True},
    "gemini": {"--yolo": False, "-y": False, "--approval-mode": True},
    "qwen": {"--yolo": False, "-y": False, "--approval-mode": True},
}


def launch_flags(args, known):
    flags = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--":
            break
        name = arg.split("=", 1)[0]
        if name in known:
            flags.append(arg)
            if known[name] and "=" not in arg and i + 1 < len(args):
                i += 1
                flags.append(args[i])
        i += 1
    return flags


def launch_permission_mode(args):
    mode = None
    values = {"--model", "--effort", "--agent", "--settings", "--name", "-n", "--session-id", "--system-prompt", "--append-system-prompt", "--system-prompt-file", "--append-system-prompt-file"}
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--":
            break
        if arg == "--dangerously-skip-permissions":
            mode = "bypassPermissions"
        elif arg == "--permission-mode" and i + 1 < len(args):
            i += 1
            mode = args[i]
        elif arg.startswith("--permission-mode="):
            mode = arg.split("=", 1)[1]
        elif "=" in arg and arg.split("=", 1)[0] in values | {"--resume", "-r"}:
            pass
        elif arg in values and i + 1 < len(args):
            i += 1
        elif arg in {"--resume", "-r"}:
            if i + 1 < len(args) and not args[i + 1].startswith("-"):
                i += 1
        elif arg not in {"--continue", "-c", "--allow-dangerously-skip-permissions", "--verbose"}:
            return None  # unknown argument roles must never infer extra permissions
        i += 1
    return mode if mode in PERMISSION_MODES else None


def process(pid):
    # NUL-delimited argv, never shell text.
    import pathlib
    import subprocess

    if sys.platform == "darwin":
        import ctypes
        import struct
        libc = ctypes.CDLL(None, use_errno=True)
        mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2
        size = ctypes.c_size_t(1024 * 1024)
        data = ctypes.create_string_buffer(size.value)
        if libc.sysctl(mib, 3, data, ctypes.byref(size), None, 0) != 0:
            raise OSError(ctypes.get_errno())
        count = struct.unpack_from("i", data.raw)[0]
        raw = data.raw[4:size.value].split(b"\0", 1)[1].lstrip(b"\0")
        argv = raw.split(b"\0")[:count]
        parent = int(subprocess.check_output(["ps", "-o", "ppid=", "-p", str(pid)], timeout=1))
    else:
        root = pathlib.Path(f"/proc/{pid}")
        argv = (root / "cmdline").read_bytes().rstrip(b"\0").split(b"\0")
        parent = int((root / "stat").read_text().rsplit(")", 1)[1].split()[1])
    return parent, [os.fsdecode(arg) for arg in argv]


def find_agent():
    # Agents import each other's hooks (Codex, Grok and Cursor run Claude's), so the hook's
    # launching agent decides which CLI owns the session, not the configured argument.
    pid = os.getppid()
    for _ in range(10):
        if pid <= 1:
            return None
        parent, argv = process(pid)
        if not argv:
            return None
        name = os.path.basename(argv[0]).lower()
        if name in COMMANDS:
            return COMMANDS[name], argv[1:]
        if name in {"node", "bun"}:
            # The entry script is the first argument after runtime options such as --max-old-space-size.
            index = next((i for i, arg in enumerate(argv[1:], 1) if not arg.startswith("-")), None)
            script = argv[index].replace("\\", "/") if index else ""
            for package, agent in PACKAGES.items():
                if package in script:
                    return agent, argv[index + 1:]
        # Only the shells an agent runs hook commands through sit between it and this hook.
        if name.lstrip("-") not in SHELLS:
            return None
        pid = parent
    return None


file = os.environ.get("CAIRNGORM_SESSION_REPORT")
if file:
    try:
        payload = json.load(sys.stdin)
        session = next((v for v in (payload.get("session_id"), payload.get("sessionId"), payload.get("conversation_id")) if isinstance(v, str) and v), None)
        if session and not payload.get("agent_id"):  # subagents never own the pane
            cwd = payload.get("cwd") or next(iter(payload.get("workspace_roots") or []), None)
            previous = None
            try:
                with open(file, encoding="utf-8") as old:
                    previous = json.load(old)
            except Exception:
                pass  # corrupt old metadata must not prevent a fresh report
            same = isinstance(previous, dict) and previous.get("id") == session and previous.get("agent") in COMMANDS.values()
            start = payload.get("hook_event_name") == "SessionStart"
            found = None
            # A (re)started session can come from another CLI or other launch flags: inspect it again.
            if start or not same:
                try:
                    found = find_agent()
                except Exception:
                    pass  # detection is best effort
            fallback = sys.argv[1] if len(sys.argv) > 1 else ""
            agent = None
            # Print/headless runs (claude -p, codex exec, ...) never own the interactive pane.
            if found and (
                any(a in {"-p", "--print", "--prompt"} or a.startswith(("--print=", "--prompt=")) for a in found[1])
                or (found[0] == "codex" and "exec" in found[1])
            ):
                found, same, fallback = None, False, ""
            elif found:
                agent = found[0]
            elif same:
                agent = previous["agent"]
            elif fallback == "claude" and (payload.get("cursor_version") or os.environ.get("CURSOR_VERSION")):
                agent = None
            elif fallback == "cursor":
                agent = None  # Cursor's global hooks.json also runs in the IDE
            elif fallback in COMMANDS.values():
                agent = fallback
            if agent:
                report = {"agent": agent, "id": session, "cwd": cwd}
                # Claude saves a conversation only after its first message: restore checks this file.
                transcript = payload.get("transcript_path")
                if agent == "claude" and isinstance(transcript, str) and transcript:
                    report["path"] = transcript
                if agent in LAUNCH_FLAGS:
                    if found:
                        flags = launch_flags(found[1], LAUNCH_FLAGS[agent])
                    else:
                        flags = list(previous.get("flags") or []) if same else []
                    if flags:
                        report["flags"] = flags
                mode = payload.get("permission_mode") or payload.get("permissionMode")  # Grok uses camelCase
                if not mode and same and agent in {"grok", "codex"}:
                    mode = previous.get("permission_mode")
                if agent == "grok":
                    if mode in {"default", "auto", "plan", "bypassPermissions"}:
                        report["permission_mode"] = mode
                elif agent == "claude":
                    # shortcut: mode-only UI toggles have no hook; capture the next prompt/stop until Claude exposes one.
                    if not mode and start:
                        mode = launch_permission_mode(found[1]) if found else None
                    elif not mode and same:
                        mode = previous.get("permission_mode")
                    if isinstance(mode, str) and mode in PERMISSION_MODES:
                        report["permission_mode"] = mode
                elif agent == "codex" and mode in {"default", "bypassPermissions"}:
                    report["permission_mode"] = mode
                tmp = f"{file}.{os.getpid()}.tmp"
                with open(tmp, "w", encoding="utf-8") as out:
                    json.dump(report, out)
                os.replace(tmp, file)
    except Exception:
        pass  # reporting cannot block an agent
