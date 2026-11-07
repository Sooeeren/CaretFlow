# Releasing CaretFlow

Releases are built by GitHub Actions. Pushing a tag like `v0.6.1` runs
`.github/workflows/release.yml`, which builds all the files listed in [BUILDING.md](BUILDING.md#outputs)
and attaches them to a draft release.

## Packaging

- The Arch package is made from the `.deb` by `packaging/arch/PKGBUILD` (in an Arch container). The
  same `PKGBUILD` can be published to the AUR as `caretflow-bin`.
- The `.deb` and `.rpm` are rebuilt by `scripts/deb-repackage.sh` and `scripts/rpm-repackage.sh` as
  `caretflow` (Tauri would call them `caret-flow`). They replace the packages of the Folio days
  (`folio`, and `folio-markdown` for the `.rpm`).
- The Windows installer removes an old Folio install first (`src-tauri/windows/installer-hooks.nsh`).

## Signed updates

The in-app updater only installs files signed with CaretFlow's private key (the public key is in
`src-tauri/tauri.conf.json`). The key lives outside the repository in `~/.tauri/folio.key` (the file
keeps its old name); keep a backup, since updates for existing installs can't be signed without it.
Never commit the private key.

- **Local builds** (`npm run app:build:all`) sign automatically when that file exists and write
  `release/latest.json`, the manifest the app reads.
- **GitHub Actions** reads the key from the repository secret `TAURI_SIGNING_PRIVATE_KEY` (contents
  of the key file; set with `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/folio.key`). A key
  with a password also needs `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the current key has none. The
  workflow then adds `latest.json` (which contains the signatures) to the release.
- Installed copies see a release once it is **published** (drafts and pre-releases are ignored, since
  the app reads `releases/latest/download/latest.json`). Write the release notes before tagging, or
  run the workflow again from the Actions tab afterwards, so the update popup can show them.

## Android signing

Android installs an update only when it is signed with the same key as the installed app, so the
Android key must never change or get lost. Keep it outside the repository with a backup.

1. Make it once: `keytool -genkeypair -v -keystore caretflow.jks -alias caretflow -keyalg RSA -keysize 4096 -validity 36500`
2. Store it in GitHub: `base64 -w0 caretflow.jks | gh secret set ANDROID_KEYSTORE`, then
   `gh secret set ANDROID_KEYSTORE_PASSWORD`, `gh secret set ANDROID_KEY_ALIAS` (`caretflow`) and,
   if it differs from the store password, `gh secret set ANDROID_KEY_PASSWORD`.

The `android` job in `release.yml` then adds `CaretFlow-X.Y.Z.apk` (and an `.aab` for app stores) to the
release. Without the secret it skips the Android files with a warning instead of shipping an APK
that later versions couldn't update. For a local signed build, put a `keystore.properties`
(`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) in `src-tauri/gen/android/`; it is ignored by git.

## Release checklist

1. Bump the version in `package.json` (+ `package-lock.json`), `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml` (+ `Cargo.lock`). Commit as `Release X.Y.Z` with a short list of changes.
   In `packaging/arch/PKGBUILD` set `_ver` and `sha256sums=('SKIP')`.
2. Write the release notes (same layout as the previous release: New / Fixed / Updating / Downloads).
   Push the commit and the `vX.Y.Z` tag, and **right away** create the draft yourself:
   `gh release create vX.Y.Z --draft --title "CaretFlow X.Y.Z" --notes-file notes.md`.
   The release is then listed as made by the repository owner, not by `github-actions[bot]`, and the
   workflow puts the notes into `latest.json`, so the update popup shows them.
3. When the workflow is done, put the sha256 of the release `.deb` into `PKGBUILD`
   (`PKGBUILD: checksum of the X.Y.Z .deb`), then publish the draft.

## Dependency updates and audits

- Dependabot (`.github/dependabot.yml`) opens weekly pull requests for npm, Cargo and GitHub Actions.
- `.github/workflows/audit.yml` runs `cargo audit` and `npm audit` on every change to a lockfile and
  once a week. Because CaretFlow ships an auto-updater, treat a failing audit as a release blocker.
