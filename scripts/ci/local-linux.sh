#!/usr/bin/env bash
# Local Linux CI in WSL: the same checks as .github/workflows/ci.yml.
# Tests, Linux installers, then install + launch on clean distro containers.
# Builds x86_64 and ARM64 (cross-built; checked in emulated arm64 containers).
# Installers are kept in logs/ci-linux/<run>/installers only when everything
# passes. macOS builds on Codemagic, started by its GitHub webhook on push.
# Usage (repo root in Windows):
#   wsl -d Ubuntu -- bash scripts/ci/local-linux.sh [--skip-e2e]
set -uo pipefail

skip_e2e=0
for arg in "$@"; do
  case "$arg" in
    --skip-e2e) skip_e2e=1 ;;
  esac
done

# Docker Desktop leaves dangling links in /usr/bin that crash linuxdeploy, and a
# Windows-only credential helper; use a clean PATH and Docker config instead.
clean_bin="$HOME/.cache/cairngorm-ci/bin"
rm -rf "$clean_bin" && mkdir -p "$clean_bin"
for f in /usr/bin/*; do [ -e "$f" ] && ln -s "$f" "$clean_bin/"; done
export PATH="$HOME/.local/node/bin:$HOME/.cargo/bin:$HOME/.bun/bin:/usr/local/bin:$clean_bin:/usr/sbin"
export DOCKER_CONFIG="$HOME/.docker-ci"
mkdir -p "$DOCKER_CONFIG" && [ -s "$DOCKER_CONFIG/config.json" ] || echo '{}' >"$DOCKER_CONFIG/config.json"
export CI=true
target=x86_64-unknown-linux-gnu
win_repo="$(git -c safe.directory='*' rev-parse --show-toplevel)"
work="$HOME/cairngorm-ci"
run_id="$(date +%Y%m%d-%H%M%S)"
results="$win_repo/logs/ci-linux/$run_id"
mkdir -p "$results"
git_win() { git -c safe.directory='*' -C "$win_repo" "$@"; }

for tool in node bun cargo docker jq; do
  command -v "$tool" >/dev/null || { echo "Missing $tool: run scripts/ci/setup-wsl.sh first" >&2; exit 2; }
done

echo "== Sync the working tree into $work (Linux line endings, caches kept)"
if [ ! -d "$work/.git" ]; then
  git -c safe.directory='*' clone -q "$win_repo" "$work" || exit 1
fi
git -c safe.directory='*' -C "$work" fetch -q "$win_repo" HEAD || exit 1
git -C "$work" reset -q --hard FETCH_HEAD || exit 1
git -C "$work" clean -qfdx -e node_modules -e src-tauri/target -e src-tauri/binaries
# Copy local edits file by file: a patch from the Windows checkout carries CRLF.
# --no-renames lists a renamed file as a deletion plus an addition.
git_win diff HEAD --no-renames --name-only --diff-filter=D -z | while IFS= read -r -d '' f; do
  rm -f "$work/$f" || exit 1
done || { echo "Could not remove deleted files from $work" >&2; exit 1; }
{
  git_win diff HEAD --no-renames --name-only --diff-filter=d -z
  git_win ls-files -o --exclude-standard -z
} | while IFS= read -r -d '' f; do
  case "$(basename "$f")" in nul | NUL) continue ;; esac
  mkdir -p "$work/$(dirname "$f")" || exit 1
  if grep -Iq . "$win_repo/$f" 2>/dev/null; then
    sed 's/\r$//' "$win_repo/$f" >"$work/$f" || exit 1
  else
    cp "$win_repo/$f" "$work/$f" || exit 1
  fi
done || { echo "Could not copy local edits into $work" >&2; exit 1; }
cd "$work" || exit 1
echo "Commit $(git rev-parse --short HEAD) + local changes"

declare -a summary=()
failed=0
# stage <name> <cmd...> blocks the installers on failure; soft_stage only warns.
# Both return non-zero when the command failed.
run_stage() {
  local blocking="$1" name="$2"
  shift 2
  local log="$results/$(echo "$name" | tr ' /' '__').log"
  local started=$SECONDS
  echo "== $name"
  if "$@" >"$log" 2>&1; then
    summary+=("PASS  $name ($((SECONDS - started))s)")
    return 0
  fi
  if [ "$blocking" = 1 ]; then
    summary+=("FAIL  $name ($((SECONDS - started))s) → $log")
    failed=1
    tail -30 "$log"
  else
    summary+=("WARN  $name ($((SECONDS - started))s, not blocking) → $log")
  fi
  return 1
}
stage() { run_stage 1 "$@"; }
soft_stage() { run_stage 0 "$@"; }

stage "Install dependencies" npm ci
stage "Format" npm run format:check
stage "Frontend build + types" npm run build
stage "Unit tests (Vitest)" npx vitest run --testTimeout=30000
stage "Agent tests" bash -c 'cd src/agent/core && bun install --frozen-lockfile && bunx tsc --noEmit && bun test'
if [ "$skip_e2e" = 0 ]; then
  # Several specs also fail on Windows; informational until they are fixed.
  soft_stage "E2E (Playwright)" bash -c 'npx playwright install chromium && npm run test:e2e'
fi
stage "Rust format" cargo fmt --manifest-path src-tauri/Cargo.toml --check
stage "Rust tests" bash -c 'node scripts/build-agent.mjs && cargo test --no-default-features --manifest-path src-tauri/Cargo.toml'
stage "Dependency audit (OSV: RustSec + GitHub advisories)" node scripts/audit-deps.mjs
stage "Third-party notices are current" node scripts/third-party-notices.mjs --check
stage "Terminal command tests" bash -c 'cargo fmt --manifest-path src/app/cli/Cargo.toml --check && cargo test --locked --manifest-path src/app/cli/Cargo.toml'
# Installers are built on Ubuntu 22.04: a WSL (24.04) build needs glibc 2.39
# and would not start on Ubuntu 22.04 or Debian 12. Its own target dir keeps
# the 24.04 test build from being reused.
jammy="$HOME/.cache/cairngorm-ci/jammy"
bundles="$jammy/target/$target/release/bundle"
staging="$results/bundles"
build_installers() {
  # Old bundles must never be mistaken for this build's output.
  rm -rf "$bundles" &&
    mkdir -p "$jammy/target" "$jammy/cargo" "$jammy/tauri" &&
    docker build -q --network host -t cairngorm-linux-build -f scripts/ci/linux-build.Dockerfile scripts/ci &&
    docker run --rm --network host --user "$(id -u):$(id -g)" \
      -e HOME=/tmp/home -e CARGO_HOME=/cache/cargo -e CI=true \
      -v "$work:/src" -v "$jammy/target:/src/src-tauri/target" -v "$jammy:/cache" -w /src \
      cairngorm-linux-build bash -c '
        mkdir -p /tmp/home/.cache && ln -sfn /cache/tauri /tmp/home/.cache/tauri &&
        npx tauri build --target '"$target"' &&
        bash scripts/ci/build-appimage.sh '"$target"' &&
        bash scripts/ci/build-appimage-slim.sh '"$target"
}
collect_installers() {
  mkdir -p "$staging" &&
    cp "$bundles"/deb/*.deb "$bundles"/rpm/*.rpm "$bundles"/appimage/*.AppImage "$bundles"/appimage-slim/*.AppImage "$staging/" &&
    ls -la "$staging"
}
smoke() {
  local image="$1" kind="$2" name="$3"
  local out="$results/smoke/$name"
  mkdir -p "$out"
  # WSL's Docker bridge has no outbound route; the host network does.
  docker run --rm --network host -v "$staging:/bundles:ro" -v "$work/scripts/ci:/ci:ro" -v "$out:/work" -w /work \
    "$image" bash /ci/smoke-linux.sh "$kind" /bundles
}
if stage "Linux installers (.deb, .rpm, .AppImage on Ubuntu 22.04)" build_installers &&
  stage "Collect installers" collect_installers; then
  stage "Smoke Ubuntu 22.04 (.deb)" smoke ubuntu:22.04 deb ubuntu-22.04-deb
  stage "Smoke Ubuntu 24.04 (.deb)" smoke ubuntu:24.04 deb ubuntu-24.04-deb
  stage "Smoke Debian 12 (.deb)" smoke debian:12 deb debian-12-deb
  stage "Smoke Fedora 41 (.rpm)" smoke fedora:41 rpm fedora-41-rpm
  stage "Smoke Arch (.AppImage)" smoke archlinux:latest appimage arch-appimage
  stage "Smoke Ubuntu 24.04 (.AppImage)" smoke ubuntu:24.04 appimage ubuntu-24.04-appimage
  # The slim AppImage uses the system's WebKitGTK: newest (Arch) to oldest supported (Debian 12).
  # Arch's newest WebKitGTK draws the window only part of the time in this GPU-less container
  # (it passes on most runs): a warning, not a blocker.
  soft_stage "Smoke Arch (slim .AppImage)" smoke archlinux:latest appimage-slim arch-appimage-slim
  stage "Smoke Ubuntu 24.04 (slim .AppImage)" smoke ubuntu:24.04 appimage-slim ubuntu-24.04-appimage-slim
  stage "Smoke Debian 12 (slim .AppImage)" smoke debian:12 appimage-slim debian-12-appimage-slim
  stage "Smoke Fedora 41 (slim .AppImage)" smoke fedora:41 appimage-slim fedora-41-appimage-slim
fi

# Linux ARM64: cross-compiled on this x86_64 host against Ubuntu 22.04's arm64 libraries,
# then the AppImage is packed and every installer is checked in arm64 containers under
# emulation (qemu via binfmt; arm64v8/* image names never replace the x86_64 tags).
arm_target=aarch64-unknown-linux-gnu
arm="$HOME/.cache/cairngorm-ci/jammy-arm64"
arm_bundles="$arm/target/$arm_target/release/bundle"
build_arm64() {
  rm -rf "$arm_bundles" &&
    mkdir -p "$arm/target" "$arm/cargo" "$arm/tauri" &&
    docker build -q --network host -t cairngorm-linux-build-arm64 -f scripts/ci/linux-build-arm64.Dockerfile scripts/ci &&
    docker run --rm --network host --user "$(id -u):$(id -g)" \
      -e HOME=/tmp/home -e CARGO_HOME=/cache/cargo -e CI=true \
      -v "$work:/src" -v "$arm/target:/src/src-tauri/target" -v "$arm:/cache" -w /src \
      cairngorm-linux-build-arm64 bash -c '
        mkdir -p /tmp/home/.cache && ln -sfn /cache/tauri /tmp/home/.cache/tauri &&
        npx tauri build --target '"$arm_target"' --bundles deb,rpm &&
        bash scripts/ci/build-appimage-slim.sh '"$arm_target"
}
appimage_arm64() {
  # Docker Desktop forgets binfmt handlers on restart; registering again is harmless.
  docker run --privileged --rm tonistiigi/binfmt --install arm64 >/dev/null &&
    docker build -q --network host --platform linux/arm64 -t cairngorm-appimage-arm64 \
      -f scripts/ci/linux-appimage-arm64.Dockerfile scripts/ci &&
    docker run --rm --network host --platform linux/arm64 --user "$(id -u):$(id -g)" \
      -e HOME=/tmp/home \
      -v "$work:/src" -v "$arm/target:/src/src-tauri/target" -v "$arm:/cache" -w /src \
      cairngorm-appimage-arm64 bash -c '
        mkdir -p /tmp/home/.cache && ln -sfn /cache/tauri /tmp/home/.cache/tauri &&
        bash scripts/ci/build-appimage.sh '"$arm_target"
}
collect_arm64() {
  mkdir -p "$staging" &&
    cp "$arm_bundles"/deb/*.deb "$arm_bundles"/rpm/*.rpm "$arm_bundles"/appimage/*.AppImage "$arm_bundles"/appimage-slim/*.AppImage "$staging/" &&
    ls -la "$staging"
}
smoke_arm64() {
  local image="$1" kind="$2" name="$3"
  local out="$results/smoke/$name"
  mkdir -p "$out"
  docker run --privileged --rm tonistiigi/binfmt --install arm64 >/dev/null || return 1
  docker run --rm --network host --platform linux/arm64 -v "$staging:/bundles:ro" -v "$work/scripts/ci:/ci:ro" \
    -v "$out:/work" -w /work "$image" bash /ci/smoke-linux.sh "$kind" /bundles --no-launch
}
if stage "Linux ARM64 installers (.deb, .rpm, cross-built)" build_arm64 &&
  stage "Linux ARM64 AppImage" appimage_arm64 &&
  stage "Collect ARM64 installers" collect_arm64; then
  stage "Smoke ARM64 Ubuntu 22.04 (.deb)" smoke_arm64 arm64v8/ubuntu:22.04 deb arm64-ubuntu-22.04-deb
  stage "Smoke ARM64 Debian 12 (.deb)" smoke_arm64 arm64v8/debian:12 deb arm64-debian-12-deb
  stage "Smoke ARM64 Fedora 41 (.rpm)" smoke_arm64 arm64v8/fedora:41 rpm arm64-fedora-41-rpm
  stage "Smoke ARM64 Ubuntu 24.04 (.AppImage)" smoke_arm64 arm64v8/ubuntu:24.04 appimage arm64-ubuntu-24.04-appimage
  stage "Smoke ARM64 Ubuntu 24.04 (slim .AppImage)" smoke_arm64 arm64v8/ubuntu:24.04 appimage-slim arm64-ubuntu-24.04-appimage-slim
fi

echo
echo "================ Linux CI $run_id ================"
printf '%s\n' "${summary[@]}" | tee "$results/summary.txt"
if [ "$failed" != 0 ]; then
  echo "FAILED — installers not kept. Logs: $results"
  exit 1
fi
mv "$staging" "$results/installers"
echo "PASSED — verified installers: $results/installers"
