#!/usr/bin/env bash
# Rebuild the .deb that `tauri build` makes under the package name "caretflow" (Tauri derives
# "caret-flow" from the product name). It replaces Folio's old package ("folio", up to 0.5.0):
# with Conflicts + Replaces, apt and dpkg remove that one when this one is installed.
# Needs dpkg-deb (any Debian/Ubuntu). The file name stays the same.
#
# Usage: bash scripts/deb-repackage.sh <tauri .deb> <output dir>
set -euo pipefail

SRC="$(realpath "$1")"
OUT="$(realpath -m "$2")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

dpkg-deb -R "$SRC" "$WORK/pkg"
[ -x "$WORK/pkg/usr/bin/caretflow" ] || { echo "no usr/bin/caretflow in $SRC" >&2; exit 1; }
CTRL="$WORK/pkg/DEBIAN/control"
sed -i 's/^Package: .*/Package: caretflow/' "$CTRL"
grep -q '^Replaces:' "$CTRL" || printf 'Replaces: folio\n' >> "$CTRL"
grep -q '^Conflicts:' "$CTRL" || printf 'Conflicts: folio\n' >> "$CTRL"

mkdir -p "$OUT"
dpkg-deb --root-owner-group -b "$WORK/pkg" "$OUT/$(basename "$SRC")" >/dev/null
ls "$OUT/$(basename "$SRC")"
