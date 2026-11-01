#!/usr/bin/env bash
# Build the AppImage from the .deb payload, keeping the Bun agent sidecar intact.
# Tauri's own AppImage step runs linuxdeploy over every ELF in usr/bin, and its
# RUNPATH rewrite corrupts `bun --compile` executables (tauri-apps/tauri#11898):
# the agent segfaults. So linuxdeploy runs without the sidecar, the original
# binary is restored, and the AppDir is packed without further patching.
# Usage: build-appimage.sh <rust-target-triple>   (after `tauri build` made the .deb)
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
work="$bundle/appimage"
appdir="$work/Cairngorm.AppDir"
mkdir -p "$tools"

fetch() {
  # Download to a temp name so an interrupted transfer is never reused.
  if [ ! -s "$tools/$1" ]; then
    curl -fsSL "$2" -o "$tools/$1.tmp"
    mv "$tools/$1.tmp" "$tools/$1"
  fi
  chmod +x "$tools/$1"
}
fetch "linuxdeploy-$arch.AppImage" \
  "https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/linuxdeploy-$arch.AppImage"
fetch linuxdeploy-plugin-gtk.sh \
  https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh
# linuxdeploy finds its plugins by name on PATH.
fetch linuxdeploy-plugin-appimage.AppImage \
  "https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-$arch.AppImage"
fetch "AppRun-$arch" \
  "https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-$arch"
if [ "$arch" = aarch64 ]; then
  # ARM64 is packed under qemu emulation, whose binfmt handler rejects the AppImage
  # magic ("AI\x02" at ELF offset 8). Without it the tools still run as plain ELF files.
  for tool in "linuxdeploy-$arch.AppImage" linuxdeploy-plugin-appimage.AppImage; do
    printf '\0\0\0' | dd of="$tools/$tool" bs=1 seek=8 count=3 conv=notrunc status=none
  done
fi

rm -rf "$work"
mkdir -p "$appdir"
dpkg-deb -x "$deb" "$appdir"

# Same AppDir preparation as Tauri's bundler (tauri-bundler linuxdeploy.rs):
# WebKit's helper processes are spawned by path, so linuxdeploy cannot find them.
for dir in "/usr/lib/$arch-linux-gnu" /usr/lib64 /usr/lib /usr/libexec; do
  for file in WebKitNetworkProcess WebKitWebProcess injected-bundle/libwebkit2gtkinjectedbundle.so; do
    source="$dir/webkit2gtk-4.1/$file"
    if [ -e "$source" ]; then
      mkdir -p "$appdir$(dirname "$source")"
      cp "$source" "$appdir$source"
    fi
  done
done
ls "$appdir/usr/lib/$arch-linux-gnu/webkit2gtk-4.1/WebKitWebProcess" >/dev/null
cp "$tools/AppRun-$arch" "$appdir/AppRun"
icon="$(ls -S "$appdir"/usr/share/icons/hicolor/*/apps/*.png | head -1)"
cp "$icon" "$appdir/Cairngorm.png"
ln -s Cairngorm.png "$appdir/.DirIcon"
ln -s "usr/share/applications/$(basename "$(ls "$appdir"/usr/share/applications/*.desktop | head -1)")" \
  "$appdir/Cairngorm.desktop"
agent="$appdir/usr/bin/cairngorm-agent"
pristine="$work/cairngorm-agent.pristine"
mv "$agent" "$pristine"

export APPIMAGE_EXTRACT_AND_RUN=1 DEPLOY_GTK_VERSION=3 ARCH="$arch"
export PATH="$tools:$PATH"
desktop="$(ls "$appdir"/usr/share/applications/*.desktop | head -1)"
"linuxdeploy-$arch.AppImage" --appdir "$appdir" --plugin gtk --desktop-file "$desktop"

# The Wayland client libraries must come from the user's system: bundled
# Ubuntu 22.04 copies break EGL on newer Mesa (Arch: EGL_BAD_PARAMETER).
for lib in libwayland-client libwayland-cursor libwayland-egl; do
  rm -f "$appdir"/usr/lib/"$lib".so*
done
# GObject introspection typelibs only serve language bindings (Python, GJS); the app is Rust.
rm -rf "$appdir/usr/lib/girepository-1.0"

cp "$pristine" "$agent"
chmod 755 "$agent"
cmp "$pristine" "$agent"

version="$(dpkg-deb -f "$deb" Version)"
output="$work/Cairngorm_${version}_${debarch}.AppImage"
# zstd stays: the static AppImage runtime (no libfuse2 needed) reads only zstd squashfs.
OUTPUT="$output" linuxdeploy-plugin-appimage.AppImage --appdir "$appdir"
rm -f "$pristine"
echo "AppImage: $output ($(stat -c%s "$output") bytes)"
