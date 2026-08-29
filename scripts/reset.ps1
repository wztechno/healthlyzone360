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
# The recipe technical sheets are PRIVATE (costs and quantities) and never committed.
# Stage the converter's output at apps/api/storage/app/v6-recipes.json and a reset
# restores them too; without the file this step is skipped and recipes import later.
if (Test-Path "storage/app/v6-recipes.json") {
    php artisan kitchen:import-v6-recipes --source=storage/app/v6-recipes.json
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "kitchen:import-v6-recipes failed" }
} else {
    Write-Host "v6-recipes.json not staged - skipping technical sheets (regenerate with scripts/convert-v6-workbook.py --recipes)."
}
# After the recipes: they mint ingredients, and the determinations file carries the
# owner's readings for them. Then publish whatever now clears its gates.
php artisan kitchen:apply-allergen-determinations --org=healthzone360-kitchen
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "kitchen:apply-allergen-determinations failed" }
php artisan kitchen:publish-ready --org=healthzone360-kitchen
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "kitchen:publish-ready failed" }
php artisan inventory:derive-stock-items
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "inventory:derive-stock-items failed" }
# The way in: owner@/staff@/customer@healthzone360.test, all "password".
php artisan db:seed --class=HealthZoneKitchenSeeder --force
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "HealthZoneKitchenSeeder failed" }
Pop-Location
Write-Host "Reset complete."
Write-Host "Demo world (Verdant, clinic, corporate buyer, preview kitchens) is OFF by default; opt in with SEED_DEMO_WORLD=true."
Write-Host "Note: subscription plans and costed technical sheets are ABSENT by design after a v6 reset."
Write-Host "The legacy kitchen:import-workbook must NOT be rerun wholesale (it would restore the legacy"
Write-Host "ingredient/product catalogue beside the v6 one); a selective plans-only mode is a pending owner decision."
