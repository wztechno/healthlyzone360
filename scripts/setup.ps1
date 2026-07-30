# Healthy360 clean-clone setup (plan §22).
# Prerequisites: Docker Desktop running, PHP 8.4 + Composer on the host.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "==> Checking Docker"
docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker daemon is not running." }

Write-Host "==> Preparing apps/api/.env"
if (-not (Test-Path "apps/api/.env")) {
    Copy-Item "apps/api/.env.example" "apps/api/.env"
}

Write-Host "==> Installing Composer dependencies"
Push-Location apps/api
composer install --no-interaction
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "composer install failed" }
Pop-Location

Write-Host "==> Starting Docker services"
docker compose up -d --build --wait
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

Write-Host "==> Installing Composer dependencies inside the container"
# The container has its own vendor volume: host vendor contains Windows
# junctions for app-modules that do not resolve inside Linux.
docker compose exec -T api composer install --no-interaction
if ($LASTEXITCODE -ne 0) { throw "container composer install failed" }
docker compose restart queue nginx

Write-Host "==> Initialising object storage"
& (Join-Path $PSScriptRoot "storage-init.ps1")

Write-Host "==> Application key"
$envContent = Get-Content "apps/api/.env" -Raw
if ($envContent -notmatch "(?m)^APP_KEY=.+") {
    Push-Location apps/api
    php artisan key:generate --force
    Pop-Location
}

Write-Host "==> Migrating and seeding"
# Schema and seed data are written by healthy360_migrator, the owner role, via
# the pgsql_migrations connection; the application itself runs as
# healthy360_app, which is subject to row-level security (ADR-0007).
Push-Location apps/api
php artisan migrate --database=pgsql_migrations --seed --force
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "migrate failed" }
Pop-Location

Write-Host ""
Write-Host "Setup complete."
Write-Host "  API (containerised) : http://localhost:8080  (health: /up)"
Write-Host "  Mailpit             : http://localhost:8025"
Write-Host "  Garage S3           : http://localhost:3900"
Write-Host "  PostgreSQL          : localhost:55432 (db healthy360, app role healthy360_app)"
Write-Host "  Redis               : localhost:6379"
Write-Host "  Host dev server     : cd apps/api; php artisan serve"
