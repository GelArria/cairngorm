#!/usr/bin/env python3
# Cairngorm status line relay for Claude Code. Claude Code passes its subscription limits
# (rate_limits) to the status line; this saves them for Cairngorm's usage display, then
# runs the user's previous status line command, if any, with the same input.
import json
import os
import subprocess
import sys
import time

raw = sys.stdin.buffer.read()
hooks_dir = os.path.dirname(os.path.abspath(__file__))
claude_dir = os.path.dirname(hooks_dir)


# Claude Code also redraws the status line for /clear, /usage and mode changes, passing
# the last limits that session saw, which can be older than what another session saved.
# Usage only grows within a window, so an older window, or a lower percentage in the same
# window, keeps the saved one. Windows of the same period reset within minutes of each other.
# A saved reading older than an hour always gives way, so a shifted or wrong reset time can
# never hold the display.
def is_current(saved, new, fresh):
    if not isinstance(new, dict) or not new:
        return False
    try:
        if not fresh or not isinstance(saved, dict) or saved.get("resets_at") is None:
            return True
        if new.get("resets_at") is None:
            return True
        gap = float(new["resets_at"]) - float(saved["resets_at"])
        if gap < -1800:
            return False
        used, before = new.get("used_percentage"), saved.get("used_percentage")
        if gap <= 1800 and float(used or 0) < float(before or 0):
            return False
    except (TypeError, ValueError, AttributeError):
        pass
    return True


try:
    limits = json.loads(raw).get("rate_limits") or {}
    if limits.get("five_hour") or limits.get("seven_day"):
        path = os.path.join(claude_dir, "cairngorm-usage.json")
        try:
            with open(path, encoding="utf-8") as f:
                saved = json.load(f)
        except (OSError, ValueError):
            saved = None
        if not isinstance(saved, dict):
            saved = {}
        now = int(time.time())
        try:
            fresh = now - float(saved.get("updatedAt")) < 3600
        except (TypeError, ValueError):
            fresh = False
        new_five = is_current(saved.get("fiveHour"), limits.get("five_hour"), fresh)
        new_seven = is_current(saved.get("sevenDay"), limits.get("seven_day"), fresh)
        if new_five or new_seven:
            # A temporary file per process, so two sessions saving at once do not collide.
            # Two sessions can still both pass the check; the next redraw corrects that.
            temp = "%s.%d.tmp" % (path, os.getpid())
            try:
                with open(temp, "w", encoding="utf-8") as f:
                    json.dump(
                        {
                            "updatedAt": now,
                            "fiveHour": limits.get("five_hour") if new_five else saved.get("fiveHour"),
                            "sevenDay": limits.get("seven_day") if new_seven else saved.get("sevenDay"),
                        },
                        f,
                    )
                os.replace(temp, path)
            except OSError:
                try:
                    os.remove(temp)
                except OSError:
                    pass
except Exception:
    pass

try:
    with open(os.path.join(hooks_dir, "cairngorm-statusline.chain"), encoding="utf-8") as f:
        command = f.read().strip()
except OSError:
    command = ""
# The guard stops a relay that ends up chained to itself.
if command and not os.environ.get("CAIRNGORM_STATUSLINE"):
    env = dict(os.environ, CAIRNGORM_STATUSLINE="1")
    try:
        # Own process group, so a timeout stops the whole command, not only the shell.
        process = subprocess.Popen(
            command,
            shell=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            env=env,
            start_new_session=True,
        )
        try:
            out, _ = process.communicate(raw, timeout=10)
            sys.stdout.buffer.write(out)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, 9)
            process.communicate()
    except Exception:
        pass
