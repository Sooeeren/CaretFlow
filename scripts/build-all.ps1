# Build Folio for Windows (installer + exe) and Linux (AppImage + .deb + binary, via WSL).
# Output: release\windows and release\linux
# Usage:  npm run app:build:all        (add -SkipLinux / -SkipWindows to build just one)
param([switch]$SkipWindows, [switch]$SkipLinux, [string]$Distro = 'Ubuntu')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $SkipWindows) {
  Write-Host "== Windows build ==" -ForegroundColor Cyan
  Push-Location $root
  # drop bundles from earlier versions so only the current one gets copied out
  foreach ($d in "$root\src-tauri\target\release\bundle\nsis", "$root\release\windows") { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
  npx tauri build --bundles nsis
  if ($LASTEXITCODE -ne 0) { throw "Windows build failed" }
  Pop-Location
  $out = Join-Path $root 'release\windows'
  New-Item -ItemType Directory -Force $out | Out-Null
  Copy-Item "$root\src-tauri\target\release\bundle\nsis\*.exe" $out -Force
  Copy-Item "$root\src-tauri\target\release\folio.exe" (Join-Path $out 'Folio-portable.exe') -Force
}

if (-not $SkipLinux) {
  Write-Host "== Linux build (WSL: $Distro) ==" -ForegroundColor Cyan
  $wslRoot = (wsl -d $Distro wslpath -a ($root -replace '\\', '/')).Trim()
  wsl -d $Distro -- bash "$wslRoot/scripts/build-linux.sh" "$wslRoot"
  if ($LASTEXITCODE -ne 0) {
    throw "Linux build failed. First-time setup: wsl -d $Distro -u root -- bash $wslRoot/scripts/linux-setup.sh"
  }
}

Write-Host "`nDone. Artifacts:" -ForegroundColor Green
Get-ChildItem (Join-Path $root 'release') -Recurse -File | ForEach-Object { '{0,-60} {1,8:N1} MB' -f $_.FullName.Substring($root.Length + 1), ($_.Length / 1MB) }
