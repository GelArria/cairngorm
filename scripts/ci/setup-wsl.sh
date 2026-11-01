#!/usr/bin/env bash
# One-time setup of the WSL Ubuntu toolchain for the local Linux CI.
# Asks for your sudo password once. Safe to run again.
# Usage (from the repo root in Windows): wsl -d Ubuntu -- bash scripts/ci/setup-wsl.sh
set -euo pipefail

NODE_VERSION=24
BUN_VERSION=1.3.14

echo "== System packages (Tauri, Playwright, Docker)"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential curl git jq rsync file unzip ca-certificates \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev \
  docker.io
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker 2>/dev/null || sudo service docker start

echo "== Rust"
if [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    RUSTUP_INIT_SKIP_PATH_CHECK=yes sh -s -- -y --profile minimal --component rustfmt
fi
"$HOME/.cargo/bin/rustup" toolchain install stable --profile minimal --component rustfmt

echo "== Node $NODE_VERSION (user-local, ahead of the Windows node on PATH)"
if [ ! -x "$HOME/.local/node/bin/node" ]; then
  version="$(curl -fsSL https://nodejs.org/dist/index.json |
    jq -r "[.[] | select(.version | startswith(\"v$NODE_VERSION.\"))][0].version")"
  mkdir -p "$HOME/.local/node"
  curl -fsSL "https://nodejs.org/dist/$version/node-$version-linux-x64.tar.xz" |
    tar -xJ -C "$HOME/.local/node" --strip-components=1
fi

echo "== Bun $BUN_VERSION"
curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION" >/dev/null

export PATH="$HOME/.local/node/bin:$HOME/.cargo/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"
echo "== Playwright system libraries"
sudo env PATH="$PATH" npx -y playwright@1 install-deps chromium

echo
node --version; bun --version; rustc --version; docker --version
echo "Setup done. Close and reopen WSL once so the docker group applies."
