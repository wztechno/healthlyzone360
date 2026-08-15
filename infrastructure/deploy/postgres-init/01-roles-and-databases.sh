#!/bin/bash
# Healthy360 deployed-database bootstrap. Runs once, on first container start,
# against an empty data volume (postgres docker-entrypoint-initdb.d).
#
# Same role model as the development script
# (infrastructure/docker/postgres/init/01-roles-and-databases.sh, ADR-0007):
#
#   healthy360_migrator - owns the schema and runs migrations (DDL).
#   healthy360_app      - runtime role; NOBYPASSRLS, no DDL, so row-level
#                         security actually applies to application queries.
#
# Two differences from the development script. The passwords are supplied by
# the environment instead of written here, because deploy.sh generates them per
# instance. And there is no healthy360_test role or healthy360_test database:
# nothing on a deployed instance runs the test suite.
set -euo pipefail

: "${H360_MIGRATOR_PASSWORD:?H360_MIGRATOR_PASSWORD is required}"
: "${H360_APP_PASSWORD:?H360_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" \
    -v migrator_password="$H360_MIGRATOR_PASSWORD" \
    -v app_password="$H360_APP_PASSWORD" <<-'SQL'
    CREATE ROLE healthy360_migrator LOGIN PASSWORD :'migrator_password'
        NOSUPERUSER CREATEDB NOCREATEROLE NOBYPASSRLS;
    CREATE ROLE healthy360_app LOGIN PASSWORD :'app_password'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

    -- Role membership, not privilege escalation: neither role owns the tables,
    -- so RLS still applies to anything the migrator executes as the app role.
    GRANT healthy360_app TO healthy360_migrator;

    CREATE DATABASE healthy360 OWNER healthy360_migrator;
SQL

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d healthy360 <<-'SQL'
    ALTER SCHEMA public OWNER TO healthy360_migrator;
    GRANT USAGE ON SCHEMA public TO healthy360_app;

    ALTER DEFAULT PRIVILEGES FOR ROLE healthy360_migrator IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthy360_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE healthy360_migrator IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO healthy360_app;
SQL
