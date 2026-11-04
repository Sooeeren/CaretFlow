#!/usr/bin/env bash
# Build CaretFlow for Linux (x86_64): a portable AppImage, .deb, .rpm, and the raw binary.
# Works on native Linux and inside WSL. One-time prerequisites: scripts/linux-setup.sh (as root).
#
# Usage: bash scripts/build-linux.sh [project-dir]
set -euo pipefail

SRC="$(cd "${1:-$(dirname "$0")/..}" && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/.local/node/bin:$PATH"
# linuxdeploy (used for the AppImage) needs these inside containers/WSL and on newer distros
export APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true

# Building on a Windows-mounted drive (/mnt/c) is extremely slow and npm's native
# binaries differ per OS, so build in a Linux-side copy of the sources.
case "$SRC" in
  /mnt/*) WORK="$HOME/.cache/caretflow-build" ;;
  *) WORK="$SRC" ;;
esac
if [ "$WORK" != "$SRC" ]; then
  mkdir -p "$WORK"
  rsync -a --delete \
    --exclude .git --exclude node_modules --exclude dist --exclude release \
    --exclude 'src-tauri/target' --exclude 'src-tauri/gen' \
    "$SRC/" "$WORK/"
fi

cd "$WORK"
# drop bundles from earlier versions so only the current one gets copied out
rm -rf src-tauri/target/release/bundle "$SRC/release/linux"
npm ci --no-audit --no-fund
# sign for the in-app updater when a key is available (passed from build-all.ps1 or ~/.tauri/folio.key)
SIGN=()
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$HOME/.tauri/folio.key" ]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/folio.key")"
fi
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  SIGN=(--config '{"bundle":{"createUpdaterArtifacts":true}}')
fi
npx tauri build --bundles appimage,deb,rpm "${SIGN[@]}"

OUT="$SRC/release/linux"
mkdir -p "$OUT"
B="$WORK/src-tauri/target/release"
cp -f "$B"/bundle/appimage/*.AppImage "$OUT/"
cp -f "$B/caretflow" "$OUT/caretflow"
cp -f "$B"/bundle/appimage/*.sig "$OUT/" 2>/dev/null || true
# Tauri names the packages "caret-flow"; rebuild them as "caretflow", replacing the old "folio" ones
bash scripts/deb-repackage.sh "$B"/bundle/deb/*.deb "$OUT"
bash scripts/rpm-repackage.sh "$B"/bundle/rpm/*.rpm "$OUT"
if [ ${#SIGN[@]} -gt 0 ]; then
  npx tauri signer sign --app-version "$(node -p "require('./package.json').version")" "$OUT"/caretflow-*.rpm
  npx tauri signer sign --app-version "$(node -p "require('./package.json').version")" "$OUT"/CaretFlow_*.deb
fi
chmod +x "$OUT"/*.AppImage "$OUT/caretflow"
echo
echo "Linux build ready in $OUT:"
ls -lh "$OUT"
