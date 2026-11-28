#!/usr/bin/env bash
# Targeted checks for what this branch changed, run before every push. Never the full suite:
# that runs once per PR in a Claude cloud session (scripts/cloud-ci.sh) when the PR is marked
# ready for review.
#
#   bash scripts/test-changed.sh            changes since the branch left origin/dev, plus uncommitted
#   bash scripts/test-changed.sh <base>     changes since <base>
#   DRY_RUN=1 bash scripts/test-changed.sh  print the commands without running them
#
# Picks: a module's Pest tests when anything under it changed; the core Pest tests that name a
# changed core class; Pint on changed PHP; Jest/Vitest tests related to changed TS; ESLint and
# Prettier on changed files; the client-drift and i18n checks when their sources changed.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
base=$(git merge-base HEAD "${1:-origin/dev}") || exit 2

mapfile -t changed < <({
    git diff --name-only --diff-filter=d "$base"
    git ls-files --others --exclude-standard
} | sort -u)

failed=0
ran=0
run() {
    ran=1
    echo "== $*"
    [ -n "${DRY_RUN:-}" ] && return 0
    "$@" || { failed=1; return 1; }
}

# ── API ──────────────────────────────────────────────────────────────────────────────────────
declare -A pest=()
php_files=()
for f in "${changed[@]}"; do
    case "$f" in
        apps/api/app-modules/*)
            m=${f#apps/api/app-modules/}
            m=${m%%/*}
            [ -d "apps/api/app-modules/$m/tests" ] && pest["app-modules/$m/tests"]=1
            ;;
        apps/api/tests/*Test.php)
            pest["${f#apps/api/}"]=1
            ;;
        apps/api/app/*.php | apps/api/routes/*.php | apps/api/config/*.php)
            cls=$(basename "$f" .php)
            while read -r t; do pest["${t#apps/api/}"]=1; done < <(
                grep -rlw --include='*Test.php' "$cls" apps/api/tests apps/api/app-modules/*/tests | head -n 40
            )
            ;;
    esac
    case "$f" in apps/api/*.php) php_files+=("${f#apps/api/}") ;; esac
done

if [ ${#php_files[@]} -gt 0 ]; then
    (cd apps/api && run vendor/bin/pint --test "${php_files[@]}") || failed=1
    ran=1
fi
if [ ${#pest[@]} -gt 0 ]; then
    (cd apps/api && run php artisan test --compact "${!pest[@]}") || failed=1
    ran=1
fi

# ── TypeScript ───────────────────────────────────────────────────────────────────────────────
declare -A pkg_files=()
fmt=()
for f in "${changed[@]}"; do
    case "$f" in
        apps/universal/* | packages/*/*)
            case "$f" in apps/universal/*) dir=apps/universal ;; *) dir=$(cut -d/ -f1-2 <<<"$f") ;; esac
            case "$f" in *.ts | *.tsx | *.js | *.mjs) pkg_files[$dir]+="$ROOT/$f"$'\n' ;; esac
            ;;
    esac
    case "$f" in apps/api/*) ;; *.ts | *.tsx | *.js | *.mjs | *.json | *.md | *.yml | *.yaml | *.css) fmt+=("$f") ;; esac
done

for dir in "${!pkg_files[@]}"; do
    mapfile -t files < <(printf '%s' "${pkg_files[$dir]}")
    name=$(node -p "require('./$dir/package.json').name")
    run pnpm --filter "$name" exec eslint --max-warnings=0 --no-warn-ignored "${files[@]}"
    if grep -q '"test": "jest' "$dir/package.json"; then
        run pnpm --filter "$name" exec jest --ci --passWithNoTests --findRelatedTests "${files[@]}"
    elif grep -q '"test": "vitest' "$dir/package.json"; then
        run pnpm --filter "$name" exec vitest related --run --passWithNoTests "${files[@]}"
    fi
done

[ ${#fmt[@]} -gt 0 ] && run pnpm exec prettier --check --ignore-unknown "${fmt[@]}"

# ── Generated artefacts ──────────────────────────────────────────────────────────────────────
printf '%s\n' "${changed[@]}" | grep -q '^apps/api/openapi/\|^packages/api-client/\|^scripts/gen-api.mjs' &&
    run pnpm run gen:api:check
printf '%s\n' "${changed[@]}" | grep -q '^packages/i18n/catalogues/' &&
    run pnpm i18n:check

[ $ran = 0 ] && echo "test-changed: nothing testable changed since $(git rev-parse --short "$base")"
exit $failed
