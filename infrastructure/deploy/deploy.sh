#!/usr/bin/env bash
# Bring up (or upgrade) the Healthy360 test instance. Runs on the droplet, from
# inside the unpacked package directory:
#
#     ./deploy.sh 203-0-113-5.nip.io
#
# Idempotent. Instance secrets and the application key are generated on the
# first run and reused afterwards, so re-deploying ships new code without
# invalidating sessions, tokens or anything encrypted with the old key.
#
# Environment knobs:
#   DEMO_PASSWORD  password every seeded persona ends up with. Remembered in
#                  .env after the first run, so later deploys keep it without
#                  being told again; pass it to change it.
#   SKIP_SEED=1    migrate but leave existing data alone
#   STACK=dev      run as the dev stack: compose.dev.yaml, database
#                  healthy360_dev, Redis databases 2/3, sharing prod's Postgres
#                  and Redis over the healthy360-shared network. Its data is
#                  kept between deploys (SKIP_SEED defaults to 1 there).
set -euo pipefail
cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# 0. Which stack this is
# ---------------------------------------------------------------------------
# Everything below reads these instead of naming a file or a service, so the
# two stacks share one script. COMPOSE_FILE is exported so every unqualified
# `docker compose` call picks the right file without being told.
STACK="${STACK:-prod}"
DB_CREATED=0
case "$STACK" in
    prod)
        export COMPOSE_FILE=compose.yaml
        WEB_SERVICE=web
        APP_NAME=Healthy360; DB_DATABASE=healthy360; REDIS_DB=0; REDIS_CACHE_DB=1
        ;;
    dev)
        export COMPOSE_FILE=compose.dev.yaml
        WEB_SERVICE=dev-web
        # APP_NAME is the isolation lever: config/database.php, cache.php and
        # horizon.php all derive their Redis prefixes from it. The database
        # indices are belt and braces on top, so flushing dev cannot touch prod.
        APP_NAME="Healthy360 Dev"; DB_DATABASE=healthy360_dev; REDIS_DB=2; REDIS_CACHE_DB=3
        PROD_DIR="${PROD_DIR:-/opt/healthy360}"
        SKIP_SEED="${SKIP_SEED:-1}"
        ;;
    *)
        echo "STACK must be 'prod' or 'dev', not '$STACK'" >&2
        exit 1
        ;;
esac
# External to both projects: created here once, owned by neither, so `down`
# on either stack leaves it standing.
docker network inspect healthy360-shared >/dev/null 2>&1 || docker network create healthy360-shared >/dev/null

SITE_ADDRESS="${1:-${SITE_ADDRESS:-}}"
if [ -z "$SITE_ADDRESS" ] && [ -f .env ]; then
    SITE_ADDRESS="$(sed -n 's/^SITE_ADDRESS=//p' .env)"
fi
if [ -z "$SITE_ADDRESS" ]; then
    echo "usage: ./deploy.sh <site-address>   e.g. ./deploy.sh 203-0-113-5.nip.io" >&2
    exit 1
fi

# Captured before .env is sourced, because sourcing would otherwise clobber an
# override given on the command line with the stored value. Precedence is
# therefore: what this run was told, then what the instance remembers, then the
# seeder's own password.
DEMO_PASSWORD_ARG="${DEMO_PASSWORD:-}"

# 32 URL-safe characters. Deliberately not the raw base64: these values travel
# through an env file, a compose substitution and a psql variable, and the
# stray '/' or '+' that survives all three is not worth the debugging.
secret() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32; }

# ---------------------------------------------------------------------------
# 1. Instance secrets — written once, read by compose for variable substitution
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
    umask 077
    if [ "$STACK" = dev ]; then
        # Copied, not generated. The roles already exist on the shared
        # Postgres with prod's passwords; fresh secrets here would simply fail
        # authentication at the first migration. The tester password comes
        # along too, so one password opens both hosts.
        [ -f "$PROD_DIR/.env" ] || { echo "no $PROD_DIR/.env — deploy the prod stack first" >&2; exit 1; }
        echo "==> adopting prod's database credentials from $PROD_DIR/.env"
        {
            echo "SITE_ADDRESS=$SITE_ADDRESS"
            grep -E '^(DB_PASSWORD|DB_MIGRATIONS_PASSWORD|DEMO_PASSWORD)=' "$PROD_DIR/.env"
        } > .env
    else
        echo "==> generating instance secrets"
        cat > .env <<EOF
SITE_ADDRESS=$SITE_ADDRESS
DEV_SITE_ADDRESS=dev.$SITE_ADDRESS
POSTGRES_SUPERUSER_PASSWORD=$(secret)
DB_PASSWORD=$(secret)
DB_MIGRATIONS_PASSWORD=$(secret)
EOF
    fi
fi
# shellcheck disable=SC1091
. ./.env
# .env is write-once, so an instance that predates the dev stack has no
# DEV_SITE_ADDRESS; compose.yaml refuses to start caddy without one.
if [ "$STACK" = prod ] && ! grep -q '^DEV_SITE_ADDRESS=' .env; then
    echo "DEV_SITE_ADDRESS=dev.$SITE_ADDRESS" >> .env
    DEV_SITE_ADDRESS="dev.$SITE_ADDRESS"
fi
# A later run may carry a different address; compose reads this file, so keep it current.
if [ "$SITE_ADDRESS" != "$(sed -n 's/^SITE_ADDRESS=//p' .env)" ]; then
    sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$SITE_ADDRESS|" .env
fi

# The tester password is remembered here rather than passed on every deploy.
# It has to be: the seeders write their own `password` into these accounts, so
# a deploy that does not know the real one silently hands every tester account
# back to the value the repository documents publicly.
DEMO_PASSWORD="${DEMO_PASSWORD_ARG:-${DEMO_PASSWORD:-password}}"
{ grep -v '^DEMO_PASSWORD=' .env || true; } > .env.next
# Single-quoted: this file is sourced by this script and parsed by compose, and
# a password is the one value here not drawn from a restricted alphabet.
printf "DEMO_PASSWORD='%s'\n" "$DEMO_PASSWORD" >> .env.next
mv .env.next .env
chmod 600 .env

# ---------------------------------------------------------------------------
# 2. Application environment — rewritten every run, key preserved
# ---------------------------------------------------------------------------
APP_KEY=""
[ -f .env.deploy ] && APP_KEY="$(sed -n 's/^APP_KEY=//p' .env.deploy)"
[ -n "$APP_KEY" ] || APP_KEY="base64:$(head -c 32 /dev/urandom | base64)"

umask 077
cat > .env.deploy <<EOF
# Generated by deploy.sh — edit deploy.sh, not this file; it is overwritten.
APP_NAME="$APP_NAME"
APP_ENV=production
APP_KEY=$APP_KEY
APP_DEBUG=false
APP_URL=https://$SITE_ADDRESS

APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en_US

LOG_CHANNEL=stack
LOG_STACK=single
LOG_LEVEL=info

# Ten times the shipped default (config/api.php). Testers share seeded personas
# and the throttle keys on the user, so one bucket serves everyone signed in as
# that persona — while a single workspace dashboard costs ~20 requests on load.
API_RATE_LIMIT=600

DB_CONNECTION=pgsql
DB_HOST=postgres
DB_PORT=5432
DB_DATABASE=$DB_DATABASE
DB_USERNAME=healthy360_app
DB_PASSWORD=$DB_PASSWORD
DB_MIGRATIONS_USERNAME=healthy360_migrator
DB_MIGRATIONS_PASSWORD=$DB_MIGRATIONS_PASSWORD

# The web bundle is served from this same origin, so the allow-list has one
# entry and cross-origin requests do not arise for the browser client at all.
FRONTEND_URL=https://$SITE_ADDRESS
FRONTEND_URLS=https://$SITE_ADDRESS
SANCTUM_STATEFUL_DOMAINS=$SITE_ADDRESS

SESSION_DRIVER=redis
SESSION_LIFETIME=120
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=null
SESSION_SECURE_COOKIE=true

BROADCAST_CONNECTION=log
# Only three surfaces write files (B2B exports, KYC documents, workbook
# import). They land on the api storage volume; no object store is deployed.
FILESYSTEM_DISK=local
QUEUE_CONNECTION=redis
CACHE_STORE=redis

REDIS_CLIENT=phpredis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=null
# Prod uses 0/1 (the framework defaults); dev uses 2/3 on the same server.
REDIS_DB=$REDIS_DB
REDIS_CACHE_DB=$REDIS_CACHE_DB

# Mail is written to the container log. Nothing on a test instance should be
# able to email a real person by accident.
MAIL_MAILER=log
MAIL_FROM_ADDRESS=noreply@healthy360.com
MAIL_FROM_NAME="Healthy 360"
EOF

# ---------------------------------------------------------------------------
# 3. Build and start the data layer
# ---------------------------------------------------------------------------
echo "==> building the api image"
docker compose build

if [ "$STACK" = dev ]; then
    # Prod's containers, by their deterministic names. Not `docker compose`
    # against prod's file from this directory: that would read this
    # directory's .env and fail prod's required-variable checks.
    PG=healthy360-deploy-postgres-1
    echo "==> checking prod's postgres and redis are reachable"
    docker network inspect healthy360-shared --format '{{range .Containers}}{{.Name}} {{end}}' | grep -q "$PG" \
        || { echo "$PG is not on healthy360-shared — redeploy the prod stack first" >&2; exit 1; }
    docker exec "$PG" pg_isready -U postgres >/dev/null
    docker exec healthy360-deploy-redis-1 redis-cli ping >/dev/null

    if [ "$(docker exec "$PG" psql -U postgres -tAc "select 1 from pg_database where datname='$DB_DATABASE'" | tr -d '[:space:]')" != "1" ]; then
        echo "==> creating database $DB_DATABASE"
        docker exec "$PG" psql -v ON_ERROR_STOP=1 -U postgres -c "CREATE DATABASE $DB_DATABASE OWNER healthy360_migrator;" >/dev/null
        # Verbatim from postgres-init/01-roles-and-databases.sh: the runtime
        # role owns nothing and holds no DDL, so row-level security still
        # applies to it (ADR-0007).
        docker exec -i "$PG" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_DATABASE" >/dev/null <<'SQL'
ALTER SCHEMA public OWNER TO healthy360_migrator;
GRANT USAGE ON SCHEMA public TO healthy360_app;
ALTER DEFAULT PRIVILEGES FOR ROLE healthy360_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthy360_app;
ALTER DEFAULT PRIVILEGES FOR ROLE healthy360_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO healthy360_app;
SQL
        DB_CREATED=1
    fi
else
    echo "==> starting postgres and redis"
    docker compose up -d --wait postgres redis
fi

# ---------------------------------------------------------------------------
# 4. Schema and data
# ---------------------------------------------------------------------------
# Migrations run as healthy360_migrator over the pgsql_migrations connection:
# the runtime role owns nothing and holds no DDL rights, which is what keeps
# row-level security meaningful (ADR-0007).
echo "==> migrating"
docker compose run --rm --no-deps api php artisan migrate --database=pgsql_migrations --force

# A database this run created is always seeded — there is no first-run flag
# to forget. After that, dev keeps its data unless told otherwise.
if [ "$DB_CREATED" = 1 ] || [ "${SKIP_SEED:-0}" != "1" ]; then
    # APP_ENV=local for this container only. Every demo seeder refuses to run
    # outside local/testing, and that guard is worth keeping: it is the reason
    # a real deployment of this code cannot invent tenants. The instance itself
    # keeps APP_ENV=production, so nothing else inherits local behaviour.
    # SEED_DEMO_WORLD: since the kitchen redesign, DatabaseSeeder adds the demo
    # tenants only when told to. Without it a fresh database has exactly one
    # login (the platform operator) and an empty marketplace.
    echo "==> seeding demo data"
    docker compose run --rm --no-deps -e APP_ENV=local -e SEED_DEMO_WORLD=true api \
        php artisan db:seed --database=pgsql_migrations --force
fi

if [ "$DEMO_PASSWORD" != "password" ]; then
    echo "==> setting the shared tester password"
    docker compose run --rm --no-deps -e DEMO_PASSWORD="$DEMO_PASSWORD" api \
        php artisan tinker --execute='
            $count = App\Models\User::on("pgsql_migrations")
                ->whereIn("email", [
                    "ops@healthy360.test", "owner@cedar.test", "dietitian@cedar.test",
                    "two-factor@cedar.test", "owner@verdant.test", "chef@verdant.test",
                    "patient@healthy360.test", "nour@healthy360.test",
                    "buyer@acme-wellness.test",
                ])
                ->update(["password" => Illuminate\Support\Facades\Hash::make(getenv("DEMO_PASSWORD"))]);
            echo "updated {$count} accounts\n";
        '
fi

# ---------------------------------------------------------------------------
# 5. Everything else
# ---------------------------------------------------------------------------
echo "==> starting the full stack"
docker compose up -d --remove-orphans

# The web root is a bind mount, and the documented upgrade replaces ./web on the
# host wholesale. A running nginx keeps its handle on the *deleted* directory, so
# it goes on serving the old export — or nothing at all — while compose sees a
# service whose configuration has not changed and leaves it alone. Recreating it
# rebinds the mount to the directory that now exists.
docker compose up -d --force-recreate "$WEB_SERVICE"

# Horizon holds its supervisor configuration in memory; a new image means a new
# container, but an already-running one has to be told to pick the code up.
docker compose restart queue scheduler >/dev/null 2>&1 || true

echo
echo "==> smoke check"
sleep 5
docker compose ps
echo
# 127.0.0.1, not localhost: inside the container localhost resolves to ::1
# first, and nginx's IPv6 listener is declared in nginx.conf rather than added
# by the image entrypoint, which cannot write to a read-only config mount.
printf 'api health   (internal): '
docker compose exec -T "$WEB_SERVICE" wget -q -O- http://127.0.0.1/up >/dev/null 2>&1 && echo OK || echo FAILED
printf 'web bundle   (internal): '
docker compose exec -T "$WEB_SERVICE" wget -q -O- http://127.0.0.1/ >/dev/null 2>&1 && echo OK || echo FAILED
printf 'seeded data  (internal): '
docker compose exec -T "$WEB_SERVICE" wget -q -O- 'http://127.0.0.1/api/v1/marketplace/kitchens?limit=1' 2>/dev/null \
    | grep -q '"data"' && echo OK || echo FAILED
echo
echo "Site: https://$SITE_ADDRESS"
echo "Certificate issuance can take up to a minute on the very first run."
