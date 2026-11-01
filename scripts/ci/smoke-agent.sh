#!/usr/bin/env bash
# The bundled agent sidecar must start. Without credentials it exits after
# asking for a provider, which proves the compiled binary and its runtime load.
# Usage: smoke-agent.sh <agent-binary> <log-dir>
set -uo pipefail

agent="$1"
out="$2"
echo "== Agent sidecar"
file "$agent" | tee "$out/agent-file.txt"
# macOS has no `timeout`; perl's alarm ends a hung agent the same way.
if command -v timeout >/dev/null; then
  limit=(timeout 60)
else
  limit=(perl -e 'alarm shift; exec @ARGV' 60)
fi
HOME="$(mktemp -d)" "${limit[@]}" "$agent" </dev/null >"$out/agent.log" 2>&1
code=$?
cat "$out/agent.log"
if [ "$code" -ge 124 ]; then
  echo "Agent sidecar hung or crashed (exit $code)" >&2
  exit 1
fi
if ! grep -q "Configure your provider" "$out/agent.log"; then
  echo "Agent sidecar did not reach its startup check (exit $code)" >&2
  exit 1
fi
echo "Agent sidecar OK"
