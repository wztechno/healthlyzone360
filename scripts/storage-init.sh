#!/usr/bin/env bash
# Initialise the local Garage S3 service: single-node layout, dev access key,
# and the healthy360-local bucket. Idempotent - safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

# Git Bash on Windows rewrites arguments that look like POSIX paths
# (e.g. /garage -> C:/Program Files/Git/garage); disable that.
export MSYS_NO_PATHCONV=1

GARAGE="docker compose exec -T garage /garage"
ACCESS_KEY="GK0123456789abcdef01234567"
SECRET_KEY="7d6c5b4a3928170605f4e3d2c1b0a9887766554433221100ffeeddccbbaa9988"
KEY_NAME="healthy360-dev"
BUCKET="healthy360-local"

status="$($GARAGE status)"

if echo "$status" | grep -q "NO ROLE ASSIGNED"; then
    node_id="$(echo "$status" | awk '$1 ~ /^[0-9a-f]{10,}$/ { print $1; exit }')"
    if [ -z "$node_id" ]; then
        echo "storage-init: could not determine Garage node id" >&2
        exit 1
    fi
    echo "storage-init: assigning layout to node $node_id"
    $GARAGE layout assign -z dc1 -c 5G "$node_id"
    $GARAGE layout apply --version 1
else
    echo "storage-init: layout already assigned"
fi

if $GARAGE key list | grep -q "$KEY_NAME"; then
    echo "storage-init: key $KEY_NAME already exists"
else
    echo "storage-init: importing dev key $KEY_NAME"
    $GARAGE key import --yes -n "$KEY_NAME" "$ACCESS_KEY" "$SECRET_KEY"
fi

if $GARAGE bucket list | grep -q "$BUCKET"; then
    echo "storage-init: bucket $BUCKET already exists"
else
    echo "storage-init: creating bucket $BUCKET"
    $GARAGE bucket create "$BUCKET"
fi

$GARAGE bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME" >/dev/null
echo "storage-init: bucket $BUCKET ready (key $KEY_NAME)"
