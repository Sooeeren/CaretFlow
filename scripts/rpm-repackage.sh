#!/usr/bin/env bash
# Rebuild the .rpm that `tauri build` makes as "caretflow" (see packaging/rpm/caretflow.spec).
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
[ -x "$WORK/payload/usr/bin/caretflow" ] || { echo "no usr/bin/caretflow in $SRC_RPM" >&2; exit 1; }
# "Open with" offers CaretFlow only if its desktop file takes a file and names Markdown
# (src-tauri/linux/caretflow.desktop)
for d in "$WORK"/payload/usr/share/applications/*.desktop; do
  grep -q '^Exec=caretflow %f$' "$d" && grep -q '^MimeType=text/markdown;' "$d" || { echo "desktop file without %f or the Markdown type:" >&2; cat "$d" >&2; exit 1; }
done

rpmbuild -bb "$ROOT/packaging/rpm/caretflow.spec" --quiet \
  --define "_topdir $WORK/build" \
  --define "_rpmdir $OUT" \
  --define "_build_name_fmt %%{NAME}-%%{VERSION}-%%{RELEASE}.%%{ARCH}.rpm" \
  --define "_ver $VER" \
  --define "payload $WORK/payload"

ls "$OUT"/caretflow-"$VER"-*.rpm
