#!/usr/bin/env bash
# Rebuild a stack's database as the one-kitchen HealthZone360 world.
#
# The droplet counterpart of scripts/reset.sh: same sequence, run through the
# stack's one-off containers instead of a local artisan. Runs on the droplet
# from inside the stack directory:
#
#     STACK=dev ./healthzone-rebuild.sh
#
# What it does, in order — each step is the owner-approved one from reset.sh:
#   1. dumps the current database to backup-<timestamp>.sql.gz (insurance)
#   2. migrate:fresh + the reference seed WITHOUT the demo world, so no demo
#      kitchens exist to remove
#   3. kitchen:import-v6 --publish            (committed v6 catalogue)
#   4. kitchen:import-v6-recipes              (PRIVATE v6-recipes.json, staged
#                                              beside this script, deleted after)
#   5. kitchen:apply-allergen-determinations
#   6. kitchen:publish-ready
#   7. inventory:derive-stock-items
#   8. HealthZoneKitchenSeeder                 (owner@/staff@/customer@healthzone360.test)
#   9. the stack's shared tester password onto those logins and the operator
#
# Destructive by design: the target database is emptied. It refuses to run
# unless the one-off container really targets the stack's own database, so it
# cannot be pointed at prod by a stale .env.deploy.
set -euo pipefail
cd "$(dirname "$0")"

STACK="${STACK:-dev}"
case "$STACK" in
    dev)  export COMPOSE_FILE=compose.dev.yaml; EXPECT_DB=healthy360_dev ;;
    prod) export COMPOSE_FILE=compose.yaml;     EXPECT_DB=healthy360 ;;
    *)    echo "STACK must be dev or prod" >&2; exit 1 ;;
esac
PG=healthy360-deploy-postgres-1
ORG=healthzone360-kitchen
RECIPES=./v6-recipes.json

# Every one-off runs as APP_ENV=local: the importers are allowlisted to
# local/testing and the seeders refuse other environments. The running stack
# stays production; only these containers see the value.
run() { docker compose run --rm --no-deps -e APP_ENV=local "$@"; }

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------
ACTUAL_DB="$(run api sh -c 'printf %s "$DB_DATABASE"' | tr -d '\r\n')"
if [ "$ACTUAL_DB" != "$EXPECT_DB" ]; then
    echo "ABORT: the $STACK one-off container targets database '$ACTUAL_DB', expected '$EXPECT_DB'." >&2
    echo "       .env.deploy is wrong for this stack; re-run deploy.sh before rebuilding." >&2
    exit 1
fi
[ -f "$RECIPES" ] || { echo "ABORT: $RECIPES is missing — stage the private converter output beside this script." >&2; exit 1; }
echo "==> target: $STACK / $ACTUAL_DB"

# ---------------------------------------------------------------------------
# 1. Backup
# ---------------------------------------------------------------------------
BACKUP="backup-$(date +%Y%m%d-%H%M%S).sql.gz"
umask 077
docker exec "$PG" pg_dump -U postgres "$ACTUAL_DB" | gzip > "$BACKUP"
echo "==> backup: $BACKUP ($(du -h "$BACKUP" | cut -f1))"

# ---------------------------------------------------------------------------
# 2. Stage the private recipes into the storage volume the one-offs mount
# ---------------------------------------------------------------------------
API_CONTAINER="$(docker compose ps -q api)"
docker cp "$RECIPES" "$API_CONTAINER":/var/www/html/storage/app/v6-recipes.json
docker exec "$API_CONTAINER" chown www-data:www-data /var/www/html/storage/app/v6-recipes.json
trap 'docker exec "$API_CONTAINER" rm -f /var/www/html/storage/app/v6-recipes.json 2>/dev/null || true' EXIT

# ---------------------------------------------------------------------------
# 3. The sequence
# ---------------------------------------------------------------------------
echo "==> migrate:fresh + reference seed (demo world OFF)"
run api php artisan migrate:fresh --database=pgsql_migrations --seed --force

echo "==> kitchen:import-v6 --publish"
run api php artisan kitchen:import-v6 --org="$ORG" --publish

echo "==> kitchen:import-v6-recipes"
run api php artisan kitchen:import-v6-recipes --org="$ORG" --source=storage/app/v6-recipes.json

echo "==> kitchen:apply-allergen-determinations"
run api php artisan kitchen:apply-allergen-determinations --org="$ORG"

echo "==> kitchen:publish-ready"
run api php artisan kitchen:publish-ready --org="$ORG"

echo "==> inventory:derive-stock-items"
run api php artisan inventory:derive-stock-items

echo "==> HealthZone logins"
run api php artisan db:seed --class=HealthZoneKitchenSeeder --force

# ---------------------------------------------------------------------------
# 4. Passwords: the stack's shared tester password, same as deploy.sh applies
# ---------------------------------------------------------------------------
DEMO_PASSWORD="$(sed -n "s/^DEMO_PASSWORD='\(.*\)'$/\1/p" .env)"
if [ -n "$DEMO_PASSWORD" ] && [ "$DEMO_PASSWORD" != "password" ]; then
    echo "==> shared tester password onto the HealthZone logins and the operator"
    run -e DEMO_PASSWORD="$DEMO_PASSWORD" api php artisan tinker --execute='
        $count = App\Models\User::on("pgsql_migrations")
            ->whereIn("email", [
                "owner@healthzone360.test", "staff@healthzone360.test",
                "customer@healthzone360.test", "ops@healthy360.test",
            ])
            ->update(["password" => Illuminate\Support\Facades\Hash::make(getenv("DEMO_PASSWORD"))]);
        echo "updated {$count} accounts\n";
    '
fi

# ---------------------------------------------------------------------------
# 5. Restart the app so nothing holds a stale connection or cache
# ---------------------------------------------------------------------------
docker compose restart api queue scheduler >/dev/null

echo
echo "==> world now"
docker exec "$PG" psql -U postgres -d "$ACTUAL_DB" -tA -F' | ' <<'SQL'
select 'organisations',  count(*) from organisations
union all select 'users',            count(*) from users
union all select 'catalogue_items',  count(*) from catalogue_items
union all select 'published_items',  count(*) from catalogue_items where status = 'published'
union all select 'recipes',          count(*) from recipes
union all select 'recipe_versions',  count(*) from recipe_versions
union all select 'ingredients',      count(*) from ingredients
union all select 'stock_items',      count(*) from stock_items;
SQL
rm -f "$RECIPES"
echo "==> done; private recipes removed from the host and the volume, backup kept at $BACKUP"
