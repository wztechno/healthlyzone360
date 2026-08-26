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
# The v6 catalogue (sauces, dressings, meals, resale products) into the real
# kitchen org, published where priced; then the derived stock shelves.
php artisan kitchen:import-v6 --publish
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "kitchen:import-v6 failed" }
php artisan inventory:derive-stock-items
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "inventory:derive-stock-items failed" }
Pop-Location
Write-Host "Reset complete."
Write-Host "Reseeding recreates the demo kitchens (their seeder also creates the ops login)."
Write-Host 'To return to the one-kitchen world: php apps/api/artisan tinker --execute "require ''C:/dev/Healthy360/scratchpad/prune-demo-kitchens.php'';"'
Write-Host "Note: subscription plans and costed technical sheets are ABSENT by design after a v6 reset."
Write-Host "The legacy kitchen:import-workbook must NOT be rerun wholesale (it would restore the legacy"
Write-Host "ingredient/product catalogue beside the v6 one); a selective plans-only mode is a pending owner decision."
