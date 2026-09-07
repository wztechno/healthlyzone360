#!/usr/bin/env bash
# Assemble the deployment package. Runs on a development machine (Git Bash,
# WSL, macOS or Linux) from anywhere in the repository:
#
#     infrastructure/deploy/package.sh 203-0-113-5.nip.io [git-ref]
#
# The optional second argument is the commit, tag or branch to ship; it
# defaults to HEAD. The API tree is taken from that ref, so deploying a branch
# does not require checking it out:
#
#     infrastructure/deploy/package.sh 203-0-113-5.nip.io main
#     infrastructure/deploy/package.sh 203-0-113-5.nip.io v0.2.0
#
# The web bundle is the exception — Metro builds from the working tree, so the
# export always reflects the files currently on disk. Check the ref out when
# the frontend differs, and the mismatch is reported below either way.
#
# Produces build/healthy360-deploy.tar.gz containing:
#   api/   the application tree at that ref (git archive — nothing uncommitted)
#   web/   the Expo web export, built against the address given above
#   the compose stack, Dockerfile, nginx and Caddy configuration, deploy.sh
set -euo pipefail

SITE_ADDRESS="${1:-}"
REF="${2:-HEAD}"
if [ -z "$SITE_ADDRESS" ]; then
    echo "usage: package.sh <site-address> [git-ref]" >&2
    echo "   e.g. package.sh 203-0-113-5.nip.io" >&2
    echo "        package.sh 203-0-113-5.nip.io main" >&2
    exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
STAGE="$ROOT/build/deploy-package"
OUT="$ROOT/build/healthy360-deploy.tar.gz"

cd "$ROOT"

RESOLVED="$(git rev-parse --verify "$REF^{commit}")" || {
    echo "package.sh: '$REF' is not a commit in this repository." >&2
    exit 1
}
echo "==> packaging ${REF} ($(git rev-parse --short "$RESOLVED")) for https://$SITE_ADDRESS"

# The API ships from the ref; the bundle is built from the working tree. Say so
# when they differ, rather than letting a stale frontend ride along unnoticed.
if [ "$RESOLVED" != "$(git rev-parse --verify HEAD)" ]; then
    echo "    note: the web export builds from the WORKING TREE, not $REF."
    echo "          check $REF out first if the frontend differs."
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/api" "$STAGE/web"

# ---------------------------------------------------------------------------
# 1. Application source — committed tree only
# ---------------------------------------------------------------------------
# `<ref>:apps/api` archives that subtree with the paths rebased to its root, so
# a work-in-progress working copy cannot leak into an image.
git archive --format=tar "$RESOLVED:apps/api" | tar -x -C "$STAGE/api"

# The API is the ref's tree and nothing else. An earlier version of this
# script overlaid three working-copy files here; now that those are committed,
# overlaying would only ever paste one branch's files over another's.

# ---------------------------------------------------------------------------
# 2. Web export
# ---------------------------------------------------------------------------
# Built by calling Expo directly rather than through `turbo run build:web`.
# EXPO_PUBLIC_* sits in turbo.json's globalPassThroughEnv, which forwards the
# variable without folding it into the cache key — so a second build for a
# different address would happily return the first build's bundle, with the
# wrong API origin compiled in.
echo "==> building the web export"
pnpm run build:tokens

(
    cd apps/universal
    # Shell values take precedence over apps/universal/.env in @expo/env, so
    # this overrides the localhost default committed there.
    EXPO_PUBLIC_API_URL="https://$SITE_ADDRESS" \
    APP_MODE=all-dev \
    APP_ENV=preview \
        pnpm run build:web:api
)

# Trust nothing about env precedence: prove the address is actually compiled in.
if ! grep -rqF "https://$SITE_ADDRESS" apps/universal/dist-api/_expo/static/js/web/ 2>/dev/null; then
    echo "package.sh: the export does not contain https://$SITE_ADDRESS." >&2
    echo "            EXPO_PUBLIC_API_URL did not reach the bundle; aborting." >&2
    exit 1
fi
echo "    verified: https://$SITE_ADDRESS is compiled into the bundle"

cp -r apps/universal/dist-api/. "$STAGE/web/"

# ---------------------------------------------------------------------------
# 2b. Dynamic-route rules for nginx
# ---------------------------------------------------------------------------
# Expo Router's static export writes one HTML file per route and names dynamic
# segments literally: /kitchens/verdant-kitchen is served by the file
# `kitchens/[kitchen].html`. A plain SPA fallback to index.html looks like it
# works and is not — React receives the landing page's pre-rendered markup,
# fails to hydrate the kitchen-detail tree against it (minified error #418) and
# the route hangs on its loading state. So every bracketed export file gets an
# anchored location that resolves to it.
#
# `$uri.html` is tried first inside each rule, so a real static route always
# beats the dynamic pattern that happens to share its shape.
echo "==> generating dynamic-route rules"
{
    echo "# Generated by package.sh from the Expo export — do not edit by hand."
    echo
    (cd "$STAGE/web" && find . -name '*.html') \
        | sed 's|^\./||' \
        | grep '\[' \
        | grep -v '^(' \
        | sort \
        | while IFS= read -r file; do
            route="${file%.html}"
            route="${route%/index}"
            regex="$(printf '%s' "$route" | sed -E 's|\[[^]]+\]|[^/]+|g')"
            printf 'location ~ ^/%s$ { try_files $uri.html "/%s" =404; }\n' "$regex" "$file"
        done
} > "$STAGE/dynamic-routes.conf"
echo "    $(grep -c '^location' "$STAGE/dynamic-routes.conf") dynamic routes mapped"

# ---------------------------------------------------------------------------
# 3. Deployment assets
# ---------------------------------------------------------------------------
cp "$HERE/Dockerfile" "$HERE/php.ini" "$HERE/compose.yaml" "$HERE/compose.dev.yaml" \
   "$HERE/nginx.conf" "$HERE/Caddyfile" "$HERE/deploy.sh" "$STAGE/"
cp -r "$HERE/postgres-init" "$STAGE/"
chmod +x "$STAGE/deploy.sh" "$STAGE/postgres-init/"*.sh

# ---------------------------------------------------------------------------
# 4. Archive
# ---------------------------------------------------------------------------
tar -czf "$OUT" -C "$STAGE" .
echo "==> $OUT ($(du -h "$OUT" | cut -f1))"
