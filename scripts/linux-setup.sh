#!/usr/bin/env bash
# One-time setup of a Linux (Ubuntu/Debian, incl. WSL) machine for building CaretFlow.
# Run as root (or with sudo). Installs Tauri's system deps, then Rust + Node for the target user.
set -euo pipefail
TARGET_USER="${1:-${SUDO_USER:-$(id -un 1000)}}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q build-essential curl wget file pkg-config libssl-dev \
  libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev \
  patchelf xdg-utils rsync rpm cpio
sudo -u "$TARGET_USER" -H bash -lc '
  set -e
  if ! command -v cargo >/dev/null && [ ! -x "$HOME/.cargo/bin/cargo" ]; then
    curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  fi
  if [ ! -x "$HOME/.local/node/bin/node" ]; then
    mkdir -p "$HOME/.local/node"
    curl -sSfL https://nodejs.org/dist/v22.21.1/node-v22.21.1-linux-x64.tar.xz | tar -xJ -C "$HOME/.local/node" --strip-components=1
  fi
  "$HOME/.cargo/bin/cargo" --version
  "$HOME/.local/node/bin/node" --version
'
echo "setup done"
