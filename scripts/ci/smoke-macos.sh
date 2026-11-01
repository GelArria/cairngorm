#!/usr/bin/env bash
# Mount the built .dmg like a user would, check architecture and signature,
# then launch the app and prove it stays up and renders.
# Usage: smoke-macos.sh <rust-target-triple>
set -euo pipefail

target="$1"
here="$(cd "$(dirname "$0")" && pwd)"
out="$(pwd)/logs/smoke"
mkdir -p "$out"
case "$target" in
  aarch64-apple-darwin) arch=arm64 ;;
  x86_64-apple-darwin) arch=x86_64 ;;
  *) echo "Unsupported target: $target" >&2; exit 2 ;;
esac

dmg="$(ls src-tauri/target/"$target"/release/bundle/dmg/*.dmg | head -1)"
echo "== Mount $dmg"
mount="$(mktemp -d)"
hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount" >/dev/null
trap 'hdiutil detach "$mount" -force >/dev/null 2>&1 || true' EXIT
src_app="$(ls -d "$mount"/*.app | head -1)"
app="$(mktemp -d)/$(basename "$src_app")"
ditto "$src_app" "$app"
ls -la "$mount" | tee "$out/dmg-contents.txt"
if [ ! -L "$mount/Applications" ]; then
  echo "WARN: the .dmg has no Applications shortcut"
fi

main="$app/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
agent="$app/Contents/MacOS/cairngorm-agent"
cli="$app/Contents/MacOS/cairngorm-cli"
plutil -lint "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print' "$app/Contents/Info.plist" >"$out/Info.plist.txt"

echo "== Architecture ($arch)"
for bin in "$main" "$agent" "$cli"; do
  archs="$(lipo -archs "$bin")"
  echo "$(basename "$bin"): $archs"
  case " $archs " in
    *" $arch "*) ;;
    *) echo "FAIL: $(basename "$bin") is not built for $arch" >&2; exit 1 ;;
  esac
done
otool -L "$main" | tee "$out/otool.txt"
if otool -L "$main" | grep -E "/usr/local/|/opt/homebrew/"; then
  echo "FAIL: the app links against Homebrew libraries users will not have" >&2
  exit 1
fi

echo "== Signature"
if codesign -dv --verbose=2 "$app" 2>"$out/codesign.txt"; then
  cat "$out/codesign.txt"
  if grep -q "Signature=adhoc" "$out/codesign.txt"; then
    echo "Ad-hoc signed (no Developer ID): users must right-click → Open"
  else
    codesign --verify --deep --strict --verbose=2 "$app"
    spctl -a -vv -t exec "$app"
  fi
else
  echo "Unsigned app: users must right-click → Open"
fi

can_run=1
if [ "$arch" = x86_64 ] && [ "$(uname -m)" = arm64 ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then
  echo "Rosetta is missing: skipping launch checks for the Intel build"
  can_run=0
fi
[ "$can_run" = 1 ] || exit 0

bash "$here/smoke-agent.sh" "$agent" "$out"

version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
bash "$here/smoke-command.sh" "$cli" "$out" cli "$version"
bash "$here/smoke-command.sh" "$main" "$out/app-binary" app "$version"

echo "== cairngorm command opens the app"
# Linked from another folder, as a user does into /usr/local/bin.
bin="$(mktemp -d)"
ln -s "$cli" "$bin/cairngorm"
project="$(cd "$(mktemp -d)" && pwd -P)"
"$bin/cairngorm" "$project" | tee "$out/command-launch.txt"
opened=0
for _ in $(seq 40); do
  if pgrep -f "$main" >/dev/null; then opened=1; break; fi
  sleep 0.5
done
pkill -f "$main" || true
sleep 2
[ "$opened" = 1 ] || { echo "FAIL: cairngorm did not open the app" >&2; exit 1; }

echo "== Launch"
"$main" >"$out/app.log" 2>&1 &
sleep 25
alive=1
pgrep -f "$main" >/dev/null || alive=0
screencapture -x "$out/screenshot.png" 2>/dev/null || true
pkill -f "$main" || true

bash "$here/smoke-verdict.sh" "$alive" "$out" "$HOME/Library/Application Support/Cairngorm/logs"
