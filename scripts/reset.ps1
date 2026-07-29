# Destroy and recreate the local development environment (data is lost).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$reply = Read-Host "This destroys all local Healthy360 data (volumes included). Continue? [y/N]"
if ($reply -notmatch "^[yY]") { Write-Host "Aborted."; exit 1 }

docker compose down -v
docker compose up -d --build --wait
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }
& (Join-Path $PSScriptRoot "storage-init.ps1")
Push-Location apps/api
php artisan migrate:fresh --seed --force
Pop-Location
Write-Host "Reset complete."
