# Destroy and recreate the local development environment (data is lost).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$reply = Read-Host "This destroys all local Healthy360 data (volumes included). Continue? [y/N]"
if ($reply -notmatch "^[yY]") { Write-Host "Aborted."; exit 1 }

docker compose down -v
docker compose up -d --build --wait
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }
& (Join-Path $PSScriptRoot "storage-init.ps1")
# Migrations and seeders run as healthy360_migrator (ADR-0007); the runtime
# healthy360_app role has no DDL rights and is subject to row-level security.
Push-Location apps/api
php artisan migrate:fresh --database=pgsql_migrations --seed --force
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "migrate:fresh failed" }
Pop-Location
Write-Host "Reset complete."
