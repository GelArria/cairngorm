#!/usr/bin/env bash
# Install a Linux bundle on a clean distro container, then prove it starts:
# libraries resolve, the agent sidecar runs, and the window renders under Xvfb.
# Usage: smoke-linux.sh <deb|rpm|appimage|appimage-slim> <bundle-dir> [--no-launch]
# appimage-slim uses the system's WebKitGTK: the test first checks the message shown when it
# is missing, then installs it the way a user would.
# --no-launch stops before the window check, for containers of another architecture
# that run under emulation (WebKit there is too slow to judge a launch).
set -euo pipefail

kind="$1"
bundles="$(cd "$2" && pwd)"
launch=1
[ "${3:-}" = --no-launch ] && launch=0
# The bundle folder may hold installers for several architectures.
case "$(uname -m)" in
  x86_64) debarch=amd64 rpmarch=x86_64 ;;
  aarch64) debarch=arm64 rpmarch=aarch64 ;;
  *) echo "Unsupported machine: $(uname -m)" >&2; exit 2 ;;
esac
here="$(cd "$(dirname "$0")" && pwd)"
# Containers have no GPU: WebKit renders in software. Newer WebKitGTK (2.46+, the system one
# under appimage-slim) draws with Skia and needs these from the start of the run.
export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_SKIA_ENABLE_CPU_RENDERING=1 WEBKIT_DISABLE_ACCELERATED_COMPOSITING=1
out="$(pwd)/logs/smoke"
mkdir -p "$out"

if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # GTK 3 and Mesa GL/EGL: every desktop has them; AppImages rely on them.
  apt-get install -y -qq xvfb dbus procps imagemagick file xdotool tesseract-ocr \
    libegl1 libgl1 libgles2 libegl-mesa0 libgl1-mesa-dri libgtk-3-0 >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y -q xorg-x11-server-Xvfb dbus-daemon procps-ng ImageMagick file xdotool tesseract tesseract-langpack-eng >/dev/null
elif command -v pacman >/dev/null; then
  # A typical desktop already has these; the AppImage relies on them.
  pacman -Syu --noconfirm --needed xorg-server-xvfb dbus procps-ng imagemagick file xdotool tesseract tesseract-data-eng \
    mesa fontconfig ttf-dejavu libx11 gtk3 >/dev/null
fi

case "$kind" in
  deb)
    apt-get install -y -qq "$bundles"/*_"$debarch".deb >/dev/null
    app="$(command -v cairngorm)"
    agent="$(command -v cairngorm-agent)"
    ;;
  rpm)
    dnf install -y -q "$bundles"/*."$rpmarch".rpm >/dev/null
    app="$(command -v cairngorm)"
    agent="$(command -v cairngorm-agent)"
    ;;
  appimage | appimage-slim)
    image=/tmp/Cairngorm.AppImage
    suffix=AppImage
    [ "$kind" = appimage-slim ] && suffix=slim.AppImage
    cp "$(ls "$bundles"/*_"$debarch"."$suffix" | head -1)" "$image"
    chmod +x "$image"
    # Under emulation (--no-launch) qemu's binfmt handler rejects the AppImage magic at
    # ELF offset 8; this copy runs as a plain ELF without it.
    [ "$launch" = 0 ] && printf '\0\0\0' | dd of="$image" bs=1 seek=8 count=3 conv=notrunc status=none
    # Containers have no FUSE; extracting runs the same payload.
    (cd /tmp && "$image" --appimage-extract >/dev/null)
    app=/tmp/squashfs-root/AppRun
    agent=/tmp/squashfs-root/usr/bin/cairngorm-agent
    if [ "$kind" = appimage-slim ]; then
      echo "== Without WebKitGTK the slim AppImage explains what to install"
      if "$app" --version 2>"$out/missing-webkit.txt"; then
        echo "FAIL: the slim AppImage started without WebKitGTK" >&2
        exit 1
      fi
      cat "$out/missing-webkit.txt"
      grep -q "Cairngorm needs WebKitGTK 4.1" "$out/missing-webkit.txt"
      grep -q "sudo apt install libwebkit2gtk-4.1-0" "$out/missing-webkit.txt"
      echo "== Install WebKitGTK 4.1"
      if command -v apt-get >/dev/null; then apt-get install -y -qq libwebkit2gtk-4.1-0 >/dev/null
      elif command -v dnf >/dev/null; then dnf install -y -q webkit2gtk4.1 >/dev/null
      elif command -v pacman >/dev/null; then pacman -S --noconfirm --needed webkit2gtk-4.1 >/dev/null
      fi
    fi
    ;;
  *)
    echo "Unknown bundle kind: $kind" >&2
    exit 2
    ;;
esac

echo "App: $app"
echo "Agent: $agent"

if [ "$kind" = deb ] || [ "$kind" = rpm ]; then
  echo "== Shared libraries"
  if ldd "$app" | tee "$out/ldd.txt" | grep "not found"; then
    echo "Missing shared libraries" >&2
    exit 1
  fi
fi

bash "$here/smoke-agent.sh" "$agent" "$out"

# deb and rpm put the app on PATH as `cairngorm`; the AppImage runs it the same way.
if { [ "$kind" = deb ] || [ "$kind" = rpm ]; } && [ "$app" != /usr/bin/cairngorm ]; then
  echo "FAIL: the package installed the app as $app, not /usr/bin/cairngorm" >&2
  exit 1
fi
bash "$here/smoke-command.sh" "$app" "$out" app

if [ "$launch" = 0 ]; then
  echo "Installed, libraries resolve, agent and command answer (launch skipped)"
  exit 0
fi

echo "== Launch under Xvfb"
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
export DISPLAY=:99
# Xvfb has no GPU: render in software, as on a VM without graphics drivers.
export HOME="$(mktemp -d)"
sleep 2
dbus-run-session -- "$app" >"$out/app.log" 2>&1 &
sleep 25

alive=1
pgrep -x cairngorm >/dev/null || alive=0
import -window root "$out/screenshot.png" || true
terminal_ok=0
if [[ "$alive" == 1 ]] && bash "$here/smoke-terminal.sh" "$out"; then terminal_ok=1; fi
pkill -x cairngorm || true

bash "$here/smoke-verdict.sh" "$alive" "$out" "$HOME/.config/Cairngorm/logs"
[[ "$terminal_ok" == 1 ]]
