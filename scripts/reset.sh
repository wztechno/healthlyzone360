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
(cd apps/api && php artisan inventory:derive-stock-items)
echo "Reset complete."
echo "Demo world (Verdant, clinic, corporate buyer, preview kitchens) is OFF by default; opt in with SEED_DEMO_WORLD=true."
echo "Note: subscription plans and costed technical sheets are ABSENT by design after a v6 reset."
echo "The legacy kitchen:import-workbook must NOT be rerun wholesale (it would restore the legacy"
echo "ingredient/product catalogue beside the v6 one); a selective plans-only mode is a pending owner decision."
