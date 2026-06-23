# release.ps1 — Auto-increment version, commit, tag, push
#
# Usage:
#   release              → patch bump (x.y.Z+1)
#   release minor        → minor bump (x.Y+1.0)
#   release major        → major bump (X+1.0.0)
param(
    [string]$Bump = "patch"
)
$ErrorActionPreference = "Stop"

# Normalise the bump argument so empty / unknown values fall through to
# the default patch behaviour instead of silently doing nothing.
$Bump = $Bump.Trim().ToLower()
if ([string]::IsNullOrEmpty($Bump)) { $Bump = "patch" }
if ($Bump -notin @("patch", "minor", "major")) {
    Write-Host "FEHLER: Unbekannter Bump '$Bump'. Erlaubt: patch (default), minor, major." -ForegroundColor Red
    Read-Host "Enter druecken"
    exit 1
}

Write-Host ""
Write-Host "=== Auto-Release ($Bump) ===" -ForegroundColor Cyan
Write-Host ""

# Release vom AKTUELL ausgecheckten Branch (nicht mehr fix 'main'). Der
# Release-Workflow baut den getaggten Commit aus, daher landet alles auf dem
# aktuellen Branch (z.B. vtt-integration mit dem VTT-Feature) im Release und
# damit im Auto-Update. So muss das Feature nicht erst nach main gemerged sein.
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ([string]::IsNullOrEmpty($branch) -or $branch -eq "HEAD") {
    Write-Host "FEHLER: Kein Branch ausgecheckt (detached HEAD). Bitte zuerst auschecken." -ForegroundColor Red
    Read-Host "Enter druecken"
    exit 1
}
Write-Host "Release-Branch: $branch" -ForegroundColor Yellow
Write-Host ""

# Read current version from tauri.conf.json
$conf = Get-Content 'src-tauri\tauri.conf.json' -Raw
if ($conf -match '"version": "(\d+)\.(\d+)\.(\d+)"') {
    $curMajor = [int]$Matches[1]
    $curMinor = [int]$Matches[2]
    $curPatch = [int]$Matches[3]
    $old = "$curMajor.$curMinor.$curPatch"
    switch ($Bump) {
        "major" { $new = "$($curMajor + 1).0.0" }
        "minor" { $new = "$curMajor.$($curMinor + 1).0" }
        default { $new = "$curMajor.$curMinor.$($curPatch + 1)" }
    }
} else {
    Write-Host "FEHLER: Version nicht gefunden in tauri.conf.json" -ForegroundColor Red
    Read-Host "Enter druecken"
    exit 1
}

Write-Host "Aktuelle Version: $old"
Write-Host "Neue Version:     $new" -ForegroundColor Green
Write-Host ""

# ── Pre-release gate ───────────────────────────────────────────────────
# Block the release if the WH40K dataset on disk is missing or broken.
# Release builds bundle whatever is under public/data/, so a broken
# dataset here ships to every user via the auto-updater.
Write-Host "[gate] wh40k:check ..." -ForegroundColor Cyan
node scripts/check-wh40k-dataset.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Pre-release gate failed. Aborting." -ForegroundColor Red
    Read-Host "Enter druecken"
    exit 1
}

Write-Host "[gate] wh40k:test ..." -ForegroundColor Cyan
node scripts/wh40k-import test
if ($LASTEXITCODE -ne 0) {
    Write-Host "Dataset tests failed. Aborting." -ForegroundColor Red
    Read-Host "Enter druecken"
    exit 1
}
Write-Host ""

$confirm = Read-Host "Release v$new? (j/n)"
if ($confirm -ne "j") {
    Write-Host "Abgebrochen."
    exit 0
}

# Einzeiliger Changelog. Leer lassen, um den Default-Text zu behalten.
# "; " wird im In-App-Update-Popup zu einem Zeilenumbruch — also kann
# man hier mehrere Punkte aneinander reihen, z.B.:
#   Steady-Aim-Fix; React Hook-Order-Crash; Release-Script: minor/major
Write-Host ""
Write-Host "Changelog (einzeilig; '; ' wird im Popup zu Zeilenumbruch). Enter = leer."
$changelog = Read-Host "Changelog"
$changelog = $changelog.Trim()

Write-Host ""

# Update Cargo.toml
Write-Host "[1/5] Cargo.toml: $old -> $new"
$cargo = Get-Content 'src-tauri\Cargo.toml' -Raw
$cargo = $cargo -replace "version = `"$old`"", "version = `"$new`""
Set-Content 'src-tauri\Cargo.toml' $cargo -NoNewline

# Update tauri.conf.json
Write-Host "[2/5] tauri.conf.json: $old -> $new"
$conf = $conf -replace "`"version`": `"$old`"", "`"version`": `"$new`""
Set-Content 'src-tauri\tauri.conf.json' $conf -NoNewline

# Git
Write-Host "[3/5] Git commit..."
git add -A
if ([string]::IsNullOrEmpty($changelog)) {
    git commit -m "v$new"
} else {
    # Erste -m = Commit-Title, zweite -m = Body. Der Workflow liest
    # den Body via `git log -1 --format=%b` und gibt ihn als
    # releaseBody an tauri-action weiter, sodass das Popup im Client
    # ihn aus latest.json anzeigt.
    git commit -m "v$new" -m "$changelog"
}

Write-Host "[4/5] Git tag v$new..."
git tag "v$new"

Write-Host "[5/5] Push (Branch $branch + Tags)..."
git push origin $branch --tags

Write-Host ""
Write-Host "=== v$new released vom Branch '$branch'! GitHub Actions baut jetzt. ===" -ForegroundColor Green
Write-Host "https://github.com/AuchGit/NerdShelf/actions"
Write-Host ""
Read-Host "Enter druecken"
