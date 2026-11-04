# Build CaretFlow for Windows (installer + exe) and Linux (AppImage + .deb + binary, via WSL).
# Output: release\windows and release\linux
# Usage:  npm run app:build:all        (add -SkipLinux / -SkipWindows to build just one)
param([switch]$SkipWindows, [switch]$SkipLinux, [string]$Distro = 'Ubuntu')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# Sign the installers for the in-app updater when the key exists (npx tauri signer generate -w ~/.tauri/folio.key)
$sign = @()
$key = Join-Path $HOME '.tauri\folio.key'
if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and (Test-Path $key)) { $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Raw $key).Trim() }
if ($env:TAURI_SIGNING_PRIVATE_KEY) {
  if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '' }
  $env:WSLENV = (@($env:WSLENV, 'TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD') | Where-Object { $_ }) -join ':'
  # Windows PowerShell drops bare quotes when passing arguments to native programs
  $sign = @('--config', '{\"bundle\":{\"createUpdaterArtifacts\":true}}')
} else {
  Write-Host "No signing key ($key): building without in-app update files" -ForegroundColor Yellow
}

if (-not $SkipWindows) {
  Write-Host "== Windows build ==" -ForegroundColor Cyan
  Push-Location $root
  # drop bundles from earlier versions so only the current one gets copied out
  foreach ($d in "$root\src-tauri\target\release\bundle\nsis", "$root\release\windows") { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
  npx tauri build --bundles nsis @sign
  if ($LASTEXITCODE -ne 0) { throw "Windows build failed" }
  Pop-Location
  $out = Join-Path $root 'release\windows'
  New-Item -ItemType Directory -Force $out | Out-Null
  Copy-Item "$root\src-tauri\target\release\bundle\nsis\*.exe" $out -Force
  Copy-Item "$root\src-tauri\target\release\bundle\nsis\*.exe.sig" $out -Force -ErrorAction SilentlyContinue
  Copy-Item "$root\src-tauri\target\release\caretflow.exe" (Join-Path $out 'CaretFlow-portable.exe') -Force
}

if (-not $SkipLinux) {
  Write-Host "== Linux build (WSL: $Distro) ==" -ForegroundColor Cyan
  $wslRoot = (wsl -d $Distro wslpath -a ($root -replace '\\', '/')).Trim()
  wsl -d $Distro -- bash "$wslRoot/scripts/build-linux.sh" "$wslRoot"
  if ($LASTEXITCODE -ne 0) {
    throw "Linux build failed. First-time setup: wsl -d $Distro -u root -- bash $wslRoot/scripts/linux-setup.sh"
  }
}

# latest.json for the in-app updater (it contains the signatures): upload it with the other files, the .sig files aren't needed
if ($sign) { node "$root\scripts\update-manifest.mjs" (Join-Path $root 'release') --out (Join-Path $root 'release\latest.json') }

Write-Host "`nDone. Artifacts:" -ForegroundColor Green
Get-ChildItem (Join-Path $root 'release') -Recurse -File | ForEach-Object { '{0,-60} {1,8:N1} MB' -f $_.FullName.Substring($root.Length + 1), ($_.Length / 1MB) }
