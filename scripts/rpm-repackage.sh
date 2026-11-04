#!/usr/bin/env bash
# Rebuild the .rpm that `tauri build` makes as "folio-markdown" (see packaging/rpm/folio-markdown.spec).
# Needs rpmbuild, rpm2cpio and cpio (Debian/Ubuntu: apt install rpm cpio).
#
# Usage: bash scripts/rpm-repackage.sh <tauri .rpm> <output dir>
set -euo pipefail

SRC_RPM="$(realpath "$1")"
OUT="$(realpath -m "$2")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(rpm -qp --qf '%{VERSION}' "$SRC_RPM")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/payload" "$OUT"
# rpm2cpio (rpm 4.17, Ubuntu 22.04) exits with 1 on Tauri's packages although the payload is complete,
# so check the result instead of its exit code
rpm2cpio "$SRC_RPM" > "$WORK/payload.cpio" || true
(cd "$WORK/payload" && cpio -idm --quiet < "$WORK/payload.cpio")
[ -x "$WORK/payload/usr/bin/folio" ] || { echo "no usr/bin/folio in $SRC_RPM" >&2; exit 1; }

rpmbuild -bb "$ROOT/packaging/rpm/folio-markdown.spec" --quiet \
  --define "_topdir $WORK/build" \
  --define "_rpmdir $OUT" \
  --define "_build_name_fmt %%{NAME}-%%{VERSION}-%%{RELEASE}.%%{ARCH}.rpm" \
  --define "_ver $VER" \
  --define "payload $WORK/payload"

ls "$OUT"/folio-markdown-"$VER"-*.rpm
