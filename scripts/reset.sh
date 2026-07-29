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
(cd apps/api && php artisan migrate:fresh --seed --force)
echo "Reset complete."
