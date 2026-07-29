#!/usr/bin/env bash
# Healthy360 clean-clone setup (plan §22).
# Prerequisites: Docker Desktop running, PHP 8.4 + Composer on the host.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Checking Docker"
docker info >/dev/null 2>&1 || { echo "Docker daemon is not running." >&2; exit 1; }

echo "==> Preparing apps/api/.env"
if [ ! -f apps/api/.env ]; then
    cp apps/api/.env.example apps/api/.env
fi

echo "==> Installing Composer dependencies"
(cd apps/api && composer install --no-interaction)

echo "==> Starting Docker services"
docker compose up -d --build --wait

echo "==> Initialising object storage"
bash scripts/storage-init.sh

echo "==> Application key"
if ! grep -qE '^APP_KEY=.+' apps/api/.env || grep -qE '^APP_KEY=$' apps/api/.env; then
    (cd apps/api && php artisan key:generate --force)
fi

echo "==> Migrating and seeding"
(cd apps/api && php artisan migrate --seed --force)

echo ""
echo "Setup complete."
echo "  API (containerised) : http://localhost:8080  (health: /up)"
echo "  Mailpit             : http://localhost:8025"
echo "  Garage S3           : http://localhost:3900"
echo "  PostgreSQL          : localhost:5432 (db healthy360)"
echo "  Redis               : localhost:6379"
echo "  Host dev server     : cd apps/api && php artisan serve"
