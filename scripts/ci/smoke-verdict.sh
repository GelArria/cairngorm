#!/usr/bin/env bash
# Decide whether a launched app passed: still running, no panic, no crash
# report, and a screenshot that shows rendered content rather than a blank window.
# Usage: smoke-verdict.sh <alive 0|1> <log-dir> <app-crash-log-dir>
set -uo pipefail

alive="$1"
out="$2"
crash_dir="$3"
failed=0

echo "== App output"
cat "$out/app.log" || true

if [ "$alive" != 1 ]; then
  echo "FAIL: the app exited within 25 seconds" >&2
  failed=1
fi
if grep -qi "panicked" "$out/app.log"; then
  echo "FAIL: Rust panic in app output" >&2
  failed=1
fi
if ls "$crash_dir"/crash-*.json >/dev/null 2>&1; then
  echo "FAIL: crash report written" >&2
  cat "$crash_dir"/crash-*.json >&2
  cp "$crash_dir"/crash-*.json "$out/" || true
  failed=1
fi

colors=""
if [ -s "$out/screenshot.png" ]; then
  colors="$( (magick identify -format '%k' "$out/screenshot.png" ||
    identify -format '%k' "$out/screenshot.png") 2>/dev/null | head -1)"
fi
if [ -n "$colors" ] && ! [[ "$colors" =~ ^[0-9]+$ ]]; then
  echo "FAIL: could not count screenshot colors ($colors)" >&2
  failed=1
elif [ -n "$colors" ]; then
  echo "Screenshot colors: $colors"
  # A blank window is one or two flat colors; real UI has text and icons.
  if [ "$colors" -lt 50 ]; then
    echo "FAIL: the window looks blank ($colors colors)" >&2
    failed=1
  fi
else
  # macOS: no ImageMagick, and screencapture needs Screen Recording permission.
  echo "WARN: no countable screenshot; render check skipped (only liveness was verified)"
fi

if [ "$failed" = 0 ]; then
  echo "SMOKE TEST PASSED"
fi
exit "$failed"
