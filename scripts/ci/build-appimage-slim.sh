#!/usr/bin/env bash
# Build the slim AppImage: only Cairngorm's own binaries, with WebKitGTK 4.1 and GTK taken
# from the system (every library the app needs comes with webkit2gtk-4.1). About 48 MB
# instead of 120 MB, so it fits download hosts that cap files at 100 MiB. The full AppImage
# (build-appimage.sh) needs nothing installed and stays the choice for release pages.
# Usage: build-appimage-slim.sh <rust-target-triple>   (after `tauri build` made the .deb)
set -euo pipefail

target="$1"
case "$target" in
  x86_64-*) arch=x86_64 debarch=amd64 ;;
  aarch64-*) arch=aarch64 debarch=arm64 ;;
  *) echo "Unsupported target: $target" >&2; exit 2 ;;
esac
bundle="src-tauri/target/$target/release/bundle"
debs=("$bundle"/deb/*.deb)
if [ "${#debs[@]}" -ne 1 ] || [ ! -f "${debs[0]}" ]; then
  echo "Expected exactly one .deb in $bundle/deb, found: ${debs[*]}" >&2
  exit 1
fi
deb="${debs[0]}"
tools="$HOME/.cache/tauri"
work="$bundle/appimage-slim"
appdir="$work/Cairngorm.AppDir"
mkdir -p "$tools"
if [ ! -s "$tools/linuxdeploy-plugin-appimage-x86_64.AppImage" ]; then
  # appimagetool packs any architecture; it runs on the x86_64 build host.
  curl -fsSL https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage \
    -o "$tools/linuxdeploy-plugin-appimage-x86_64.AppImage.tmp"
  mv "$tools/linuxdeploy-plugin-appimage-x86_64.AppImage.tmp" "$tools/linuxdeploy-plugin-appimage-x86_64.AppImage"
fi
chmod +x "$tools/linuxdeploy-plugin-appimage-x86_64.AppImage"

rm -rf "$work"
mkdir -p "$appdir"
dpkg-deb -x "$deb" "$appdir"
desktop="$(ls "$appdir"/usr/share/applications/*.desktop | head -1)"
icon_name="$(sed -n 's/^Icon=//p' "$desktop" | head -1)"
cp "$(ls -S "$appdir"/usr/share/icons/hicolor/*/apps/*.png | head -1)" "$appdir/$icon_name.png"
ln -s "$icon_name.png" "$appdir/.DirIcon"
ln -s "usr/share/applications/$(basename "$desktop")" "$appdir/$(basename "$desktop")"

cat >"$appdir/AppRun" <<'APPRUN'
#!/bin/sh
# Cairngorm slim AppImage: WebKitGTK 4.1 and GTK come from this system.
here="$(dirname "$(readlink -f "$0")")"
app="$here/usr/bin/cairngorm"
missing="$(ldd "$app" 2>/dev/null | awk '/not found/ {print $1}')"
if [ -n "$missing" ]; then
  message="Cairngorm needs WebKitGTK 4.1, which this AppImage uses from your system.
Missing: $(echo $missing)

Install it, then start Cairngorm again:
  Arch, Manjaro:         sudo pacman -S webkit2gtk-4.1
  Ubuntu, Debian, Mint:  sudo apt install libwebkit2gtk-4.1-0
  Fedora:                sudo dnf install webkit2gtk4.1
  openSUSE:              sudo zypper install libwebkit2gtk-4_1-0

Or use the .deb or .rpm package, which installs it for you."
  echo "$message" >&2
  # Started from a file manager there is no terminal: show it in a window when possible.
  if [ ! -t 2 ]; then
    if command -v zenity >/dev/null 2>&1; then zenity --error --title=Cairngorm --text="$message" 2>/dev/null
    elif command -v kdialog >/dev/null 2>&1; then kdialog --title Cairngorm --error "$message" 2>/dev/null
    elif command -v notify-send >/dev/null 2>&1; then notify-send Cairngorm "Cairngorm needs WebKitGTK 4.1 (webkit2gtk-4.1)." 2>/dev/null
    fi
  fi
  exit 1
fi
exec "$app" "$@"
APPRUN
chmod 755 "$appdir/AppRun"

version="$(dpkg-deb -f "$deb" Version)"
output="$work/Cairngorm_${version}_${debarch}.slim.AppImage"
OUTPUT="$output" ARCH="$arch" APPIMAGE_EXTRACT_AND_RUN=1 \
  "$tools/linuxdeploy-plugin-appimage-x86_64.AppImage" --appdir "$appdir"
size="$(stat -c%s "$output")"
limit=$((100 * 1024 * 1024))
if [ "$size" -ge "$limit" ]; then
  echo "Slim AppImage is $size bytes, over the 100 MiB download-host limit" >&2
  exit 1
fi
echo "Slim AppImage: $output ($size bytes)"
