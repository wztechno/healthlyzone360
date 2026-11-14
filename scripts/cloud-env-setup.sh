#!/bin/bash
# Setup script for the "Healthy360 CI" Claude cloud environment. Paste this file's contents into
# the environment's Setup script box at claude.ai/code; it is kept here only so it is versioned.
#
# It provisions what the VM lacks for scripts/cloud-ci.sh and runs once per environment cache
# (about a week): Node 24 (package.json engines; the image ships 22) and the Docker images the
# suite builds on. It must finish in about five minutes to be cached, and it must exit 0 or the
# session fails to start, so every step tolerates failure; cloud-ci.sh reports what is missing.

(
    set -e
    base=https://nodejs.org/dist/latest-v24.x
    cd /tmp
    curl -fsSLO "$base/SHASUMS256.txt"
    file=$(awk '/linux-x64\.tar\.xz$/ {print $2}' SHASUMS256.txt)
    curl -fsSLO "$base/$file"
    grep " $file\$" SHASUMS256.txt | sha256sum -c -
    rm -rf /opt/node24 && mkdir -p /opt/node24
    tar -xJf "$file" -C /opt/node24 --strip-components=1
    /opt/node24/bin/corepack enable
    rm -f "$file" SHASUMS256.txt
) || echo "cloud-env-setup: Node 24 install failed" >&2

if ! docker info >/dev/null 2>&1; then
    (dockerd >/tmp/dockerd.log 2>&1 &)
    for _ in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi

for image in postgres:18-alpine redis:8-alpine php:8.4-fpm-alpine composer:2 mlocati/php-extension-installer:2; do
    docker pull -q "$image" &
done
wait

exit 0
