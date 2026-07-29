# Architecture Decision Records

ADRs record consequential architectural choices only (plan §23). Dependency versions live in the [compatibility matrix](../dependency-compatibility.md), not in ADRs. Format: Status / Context / Decision / Consequences / Review trigger.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith, no microservices | Accepted 2026-07-30 |
| [0002](0002-shared-database-multi-tenancy.md) | Shared-database multi-tenancy with organisation isolation | Accepted 2026-07-30 |
| [0003](0003-global-user-identity.md) | Global user identity: one person, many organisations via memberships | Accepted 2026-07-30 |
| [0004](0004-universal-expo-frontend.md) | Universal Expo frontend: one codebase, build families, role areas | Accepted 2026-07-30 |
| [0005](0005-openapi-generated-typescript-client.md) | OpenAPI-generated TypeScript client (spec-first) | Accepted 2026-07-30 |
| [0006](0006-custom-organisation-membership-rbac.md) | Custom organisation-membership RBAC (not spatie/laravel-permission) | Accepted 2026-07-30 |
| [0007](0007-incremental-postgresql-rls.md) | Incremental PostgreSQL Row-Level Security | Accepted 2026-07-30 |
| [0008](0008-php-84-pest-5.md) | PHP 8.4 with Pest 5 | Accepted 2026-07-30 |
| [0009](0009-node-24-expo-57-typescript-6.md) | Node 24 LTS, Expo SDK 57, TypeScript 6 | Accepted 2026-07-30 |
| [0010](0010-s3-compatible-storage-abstraction.md) | S3-compatible object storage behind the Laravel filesystem abstraction | Accepted 2026-07-30 |
| [0011](0011-mock-api-repository-boundary.md) | Mock/API repository boundary in the frontend | Accepted 2026-07-30 |
| [0012](0012-restricted-offline-persistence.md) | Restricted offline persistence | Accepted 2026-07-30 |

## Conventions

- Numbering is sequential and permanent; superseded ADRs are marked, never deleted.
- A new ADR is warranted for consequential, hard-to-reverse choices — not for package versions, naming or formatting.
- Each ADR names its review trigger; triggers are checked when their conditions occur, not on a calendar.
