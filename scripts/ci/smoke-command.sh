#!/usr/bin/env bash
# Checks an installed `cairngorm` command answers like a user expects, without a display.
# Usage: smoke-command.sh <command> <out-dir> <app|cli> [expected-version]
#   app: the app itself is the command (Linux packages); only --version and --help apply.
#   cli: the bundled command (macOS); also checks errors and that a request is forwarded.
set -euo pipefail

command="$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"
out="$2"
kind="$3"
expected="${4:-}"
mkdir -p "$out"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== cairngorm command ($command)"
version="$("$command" --version)"
echo "$version" | tee "$out/command-version.txt"
[[ "$version" =~ ^cairngorm\ [0-9]+\.[0-9]+\.[0-9]+ ]] || fail "--version printed '$version'"
if [ -n "$expected" ] && [ "$version" != "cairngorm $expected" ]; then
  fail "--version printed '$version', the bundle is $expected"
fi
"$command" --help >"$out/command-help.txt"
grep -q "Usage: cairngorm \[path\] \[options\]" "$out/command-help.txt" || fail "--help has no usage line"
grep -q -- "--agent <cli>" "$out/command-help.txt" || fail "--help does not list --agent"

[ "$kind" = cli ] || { echo "Command answers"; exit 0; }

set +e
"$command" --bogus 2>"$out/command-error.txt"
status=$?
set -e
[ "$status" = 2 ] || fail "an unknown option exited with $status, expected 2"
grep -q "Unknown option '--bogus'" "$out/command-error.txt" || fail "no message for an unknown option"

# A stand-in app records the request the command forwards.
# Physical path: macOS temp folders are links, and the command sees the real folder.
work="$(cd "$(mktemp -d)" && pwd -P)"
mkdir "$work/my project"
cat >"$work/app" <<'APP'
#!/bin/sh
printf '%s\n' "$PWD" "$@" >"$CAIRNGORM_ECHO_OUT.partial" && mv "$CAIRNGORM_ECHO_OUT.partial" "$CAIRNGORM_ECHO_OUT"
APP
chmod +x "$work/app"
(cd "$work" && CAIRNGORM_APP="$work/app" CAIRNGORM_ECHO_OUT="$work/record" "$command" "my project" -a claude --git) |
  tee "$out/command-open.txt"
for _ in $(seq 100); do [ -f "$work/record" ] && break; sleep 0.1; done
[ -f "$work/record" ] || fail "the command never started the app"
cat "$work/record" >"$out/command-forwarded.txt"
tail -n +2 "$work/record" | tr '\n' '|' | grep -qx -- "--agent=claude|--git|--|$work/my project|" ||
  fail "unexpected forwarded request: $(tail -n +2 "$work/record" | tr '\n' ' ')"
rm -rf "$work"
echo "Command answers and forwards requests"
