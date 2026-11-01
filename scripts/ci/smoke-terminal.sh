#!/usr/bin/env bash
# WebKitGTK has no Playwright CDP endpoint: exercise native input/output under Xvfb.
set -euo pipefail
out="$1"
window="$(xdotool search --onlyvisible --class cairngorm | head -1)"
xdotool windowfocus --sync "$window"
xdotool key --clearmodifiers Escape
# Let the modal unmount before the workspace shortcut is dispatched on slow WebKitGTK.
sleep 0.5
xdotool key --clearmodifiers ctrl+n
for ((i=0; i<30; i++)); do
  import -window root "$out/terminal.png"
  tesseract "$out/terminal.png" "$out/terminal-ready" --psm 11 2>/dev/null
  if grep -qi root "$out/terminal-ready.txt"; then break; fi
  sleep 0.5
done
grep -qi root "$out/terminal-ready.txt"
# The complete marker is not in the echoed command: OCR must see shell output.
xdotool type --clearmodifiers --delay 10 "printf '12345%s\\n' 67890; printf ok > \"\$HOME/pty-smoke-ok\""
xdotool key Return
for ((i=0; i<50; i++)); do
  if [[ -f "$HOME/pty-smoke-ok" ]]; then break; fi
  sleep 0.2
done
import -window root "$out/terminal.png"
[[ -f "$HOME/pty-smoke-ok" ]] && [[ "$(<"$HOME/pty-smoke-ok")" == ok ]]
for ((i=0; i<20; i++)); do
  import -window root "$out/terminal.png"
  # Tesseract 4 (Ubuntu 22.04) needs enlarged dark text without the surrounding app chrome.
  convert "$out/terminal.png" -crop 1200x130+0+38 -resize 300% -colorspace Gray -negate "$out/terminal-ocr.png"
  tesseract "$out/terminal-ocr.png" "$out/terminal" --psm 6 2>/dev/null
  if grep -q 1234567890 "$out/terminal.txt"; then
    echo "PASS: native terminal accepted input, ran the shell and rendered 1234567890"
    exit 0
  fi
  sleep 0.5
done
echo "FAIL: terminal output was not rendered; inspect terminal.png and terminal.txt" >&2
exit 1
