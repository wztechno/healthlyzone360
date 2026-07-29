#!/bin/bash
# Healthy360 local development database bootstrap.
# Runs once on first container start (postgres docker-entrypoint-initdb.d).
#
# Role model (ADR-0007, incremental RLS):
#   healthy360_migrator - owns schemas and runs migrations (DDL).
#   healthy360_app      - runtime application role; NOBYPASSRLS, no DDL.
#   healthy360_test     - test-suite role with application-equivalent privileges.
#
# Passwords below are LOCAL DEVELOPMENT ONLY values, never used outside
# docker compose on a developer machine.
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" <<-'SQL'
    CREATE ROLE healthy360_migrator LOGIN PASSWORD 'h360_migrator_local'
        NOSUPERUSER CREATEDB NOCREATEROLE NOBYPASSRLS;
    CREATE ROLE healthy360_app LOGIN PASSWORD 'h360_app_local'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    CREATE ROLE healthy360_test LOGIN PASSWORD 'h360_test_local'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

    CREATE DATABASE healthy360 OWNER healthy360_migrator;
    CREATE DATABASE healthy360_test OWNER healthy360_migrator;
SQL

for db in healthy360 healthy360_test; do
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" <<-'SQL'
        ALTER SCHEMA public OWNER TO healthy360_migrator;
        GRANT USAGE ON SCHEMA public TO healthy360_app, healthy360_test;

        ALTER DEFAULT PRIVILEGES FOR ROLE healthy360_migrator IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO healthy360_app, healthy360_test;
        ALTER DEFAULT PRIVILEGES FOR ROLE healthy360_migrator IN SCHEMA public
            GRANT USAGE, SELECT ON SEQUENCES TO healthy360_app, healthy360_test;
SQL
done
