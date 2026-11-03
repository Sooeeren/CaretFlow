#!/usr/bin/env bash
# Build Folio for Linux (x86_64): a portable AppImage, a .deb, and the raw binary.
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
  /mnt/*) WORK="$HOME/.cache/folio-build" ;;
  *) WORK="$SRC" ;;
esac
if [ "$WORK" != "$SRC" ]; then
  mkdir -p "$WORK"
  rsync -a --delete \
    --exclude node_modules --exclude dist --exclude release \
    --exclude 'src-tauri/target' --exclude 'src-tauri/gen' \
    "$SRC/" "$WORK/"
fi

cd "$WORK"
npm ci --no-audit --no-fund
npx tauri build --bundles appimage,deb

OUT="$SRC/release/linux"
mkdir -p "$OUT"
B="$WORK/src-tauri/target/release"
cp -f "$B"/bundle/appimage/*.AppImage "$OUT/"
cp -f "$B"/bundle/deb/*.deb "$OUT/"
cp -f "$B/folio" "$OUT/folio"
chmod +x "$OUT"/*.AppImage "$OUT/folio"
echo
echo "Linux build ready in $OUT:"
ls -lh "$OUT"
