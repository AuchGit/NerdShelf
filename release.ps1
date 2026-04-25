# release.ps1 — Auto-increment version, commit, tag, push
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Auto-Release ===" -ForegroundColor Cyan
Write-Host ""

# Read current version from tauri.conf.json
$conf = Get-Content 'src-tauri\tauri.conf.json' -Raw
if ($conf -match '"version": "(\d+)\.(\d+)\.(\d+)"') {
    $major = $Matches[1]
    $minor = $Matches[2]
    $patch = [int]$Matches[3] + 1
    $old = "$major.$minor.$($Matches[3])"
    $new = "$major.$minor.$patch"
} else {
    Write-Host "FEHLER: Version nicht gefunden in tauri.conf.json" -ForegroundColor Red
    Read-Host "Enter druecken"
    exit 1
}

Write-Host "Aktuelle Version: $old"
Write-Host "Neue Version:     $new" -ForegroundColor Green
Write-Host ""
$confirm = Read-Host "Release v$new? (j/n)"
if ($confirm -ne "j") {
    Write-Host "Abgebrochen."
    exit 0
}

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
git commit -m "v$new"

Write-Host "[4/5] Git tag v$new..."
git tag "v$new"

Write-Host "[5/5] Push..."
git push origin main --tags

Write-Host ""
Write-Host "=== v$new released! GitHub Actions baut jetzt. ===" -ForegroundColor Green
Write-Host "https://github.com/AuchGit/NerdShelf/actions"
Write-Host ""
Read-Host "Enter druecken"
