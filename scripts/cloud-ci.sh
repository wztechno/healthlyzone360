#!/usr/bin/env bash
# The CI suite for a Claude cloud session: the stages of .github/workflows/backend.yml,
# contracts.yml and frontend.yml, run in that VM instead of on GitHub Actions.
#
#   bash scripts/cloud-ci.sh                     every stage
#   bash scripts/cloud-ci.sh --only backend-test,expo
#
# Stage logs go to /tmp/cloud-ci/<stage>.log; the last lines printed are a PASS/FAIL table.
# PHP runs in the compose `api` image (PHP 8.4 - the VM only ships 8.3) with host networking, so
# phpunit.xml's 127.0.0.1:55432 reaches compose's postgres exactly as it does on a developer machine.
# Node 24 comes from /opt/node24, which scripts/cloud-env-setup.sh installs.
# When a workflow changes, change the matching stage here.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
LOGS=/tmp/cloud-ci
STAGES=(backend-static backend-test openapi contracts frontend expo)

only=""
if [ "${1:-}" = "--only" ]; then only=",${2:?--only needs a comma-separated stage list},"; fi

export PATH="/opt/node24/bin:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 EXPO_NO_TELEMETRY=1 CI=true
mkdir -p "$LOGS"
cd "$ROOT"

# PHP inside the PHP 8.4 image; vendor lives in a volume so the checkout stays clean.
php84() {
    docker run --rm --network host \
        -v "$ROOT/apps/api:/var/www/html" -v h360-cloud-vendor:/var/www/html/vendor \
        -w /var/www/html healthy360/php-dev bash -c "$1"
}

prepare() {
    echo "== prepare (docker, services, dependencies)"
    if ! docker info >/dev/null 2>&1; then
        (dockerd >/tmp/dockerd.log 2>&1 &)
        for _ in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
    fi
    docker compose up -d --wait postgres redis &&
        docker compose build api &&
        php84 'composer install --prefer-dist --no-interaction --no-progress' &&
        corepack enable &&
        pnpm install --frozen-lockfile
}

backend-static() {
    php84 'set -e
        composer validate --no-check-publish
        for f in app-modules/*/composer.json; do composer validate --no-check-publish "$f"; done
        vendor/bin/pint --test
        php -d memory_limit=-1 vendor/bin/phpstan analyse --no-progress'
}

# The roles and databases come from infrastructure/docker/postgres/init, which compose mounts.
backend-test() {
    php84 'set -e
        cp .env.example .env
        php artisan key:generate --force
        php artisan migrate:fresh --database=pgsql_migrations --force
        php artisan migrate:rollback --database=pgsql_migrations --force
        php artisan migrate --database=pgsql_migrations --seed --force
        php -d memory_limit=-1 artisan test --compact'
}

openapi() (
    set -e
    cd apps/api
    npx --yes @redocly/cli lint openapi/healthy360.v1.yaml --config openapi/redocly.yaml
    npx --yes @redocly/cli bundle openapi/healthy360.v1.yaml --config openapi/redocly.yaml -o openapi/dist/healthy360.v1.yaml
    git diff --exit-code -- openapi/dist/healthy360.v1.yaml
)

contracts() (
    set -e
    pnpm run gen:api
    git diff --exit-code -- packages/api-client/src/generated
    pnpm --filter @healthy360/api-client run test
    pnpm --filter @healthy360/api-client run typecheck
)

frontend() (
    set -e
    pnpm turbo run typecheck
    pnpm turbo run lint
    pnpm run format:check
    pnpm turbo run test --filter=!universal --filter=!@healthy360/design-system
    pnpm turbo run test --filter=universal --filter=@healthy360/design-system
)

# Last and alone: Metro needs the 6 GB heap deploy.yml gives it, and the VM has 16 GB in all.
expo() (
    set -e
    cd apps/universal
    APP_MODE=all-dev APP_ENV=development EXPO_PUBLIC_API_URL=http://localhost:8080 \
        NODE_OPTIONS=--max-old-space-size=6144 pnpm run build:web:api
    pnpm run budget:export
    APP_MODE=customer APP_ENV=production EXPO_PUBLIC_API_URL=https://api.healthy360.invalid \
        NODE_OPTIONS=--max-old-space-size=6144 pnpm run build:web:api
)

if ! prepare >"$LOGS/prepare.log" 2>&1; then
    echo "FAIL  prepare  (see $LOGS/prepare.log)"
    tail -n 40 "$LOGS/prepare.log"
    exit 2
fi

declare -A result
failed=0
for stage in "${STAGES[@]}"; do
    if [ -n "$only" ] && [[ $only != *",$stage,"* ]]; then continue; fi
    echo "== $stage"
    start=$SECONDS
    if "$stage" >"$LOGS/$stage.log" 2>&1; then
        result[$stage]="PASS  $((SECONDS - start))s"
    else
        result[$stage]="FAIL  $((SECONDS - start))s  $LOGS/$stage.log"
        failed=1
    fi
    echo "   ${result[$stage]}"
done

echo
echo "stage            result"
for stage in "${STAGES[@]}"; do
    [ -n "${result[$stage]:-}" ] && printf '%-16s %s\n' "$stage" "${result[$stage]}"
done
exit $failed
