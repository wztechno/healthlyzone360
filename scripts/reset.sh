#!/usr/bin/env bash
# Destroy and recreate the local development environment (data is lost).
set -euo pipefail
cd "$(dirname "$0")/.."

read -r -p "This destroys all local Healthy360 data (volumes included). Continue? [y/N] " reply
case "$reply" in
    [yY]*) ;;
    *) echo "Aborted."; exit 1 ;;
esac

docker compose down -v
docker compose up -d --build --wait
bash scripts/storage-init.sh
# Migrations and seeders run as healthy360_migrator (ADR-0007); the runtime
# healthy360_app role has no DDL rights and is subject to row-level security.
(cd apps/api && php artisan migrate:fresh --database=pgsql_migrations --seed --force)
# The v6 catalogue (sauces, dressings, meals, resale products) into the real
# kitchen org, published where priced; then the derived stock shelves.
(cd apps/api && php artisan kitchen:import-v6 --publish)
# The recipe technical sheets are PRIVATE (costs and quantities) and never committed.
# Stage the converter's output at apps/api/storage/app/v6-recipes.json and a reset
# restores them too; without the file this step is skipped and recipes import later.
if [ -f apps/api/storage/app/v6-recipes.json ]; then
    (cd apps/api && php artisan kitchen:import-v6-recipes --source=storage/app/v6-recipes.json)
else
    echo "v6-recipes.json not staged - skipping technical sheets (regenerate with scripts/convert-v6-workbook.py --recipes)."
fi
# After the recipes: they mint ingredients, and the determinations file carries the
# owner's readings for them. Then publish whatever now clears its gates.
(cd apps/api && php artisan kitchen:apply-allergen-determinations --org=healthzone360-kitchen)
(cd apps/api && php artisan kitchen:publish-ready --org=healthzone360-kitchen)
(cd apps/api && php artisan inventory:derive-stock-items)
# The way in: owner@/staff@/customer@healthzone360.test, all "password".
(cd apps/api && php artisan db:seed --class=HealthZoneKitchenSeeder --force)
echo "Reset complete."
echo "Demo world (Verdant, clinic, corporate buyer, preview kitchens) is OFF by default; opt in with SEED_DEMO_WORLD=true."
echo "Note: subscription plans and costed technical sheets are ABSENT by design after a v6 reset."
echo "The legacy kitchen:import-workbook must NOT be rerun wholesale (it would restore the legacy"
echo "ingredient/product catalogue beside the v6 one); a selective plans-only mode is a pending owner decision."
