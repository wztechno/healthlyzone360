# Decisions Register

Product and architecture decisions with dates. Architectural decisions with lasting consequences also have ADRs (`docs/architecture/adr/`). All decisions below were confirmed on adoption of the revised plan unless otherwise dated.

| ID | Date | Decision | Detail / reference |
|---|---|---|---|
| D-001 | 2026-07-30 | Revised plan supersedes the earlier agent-drafted plan | User-issued revision adopted verbatim as execution baseline; recorded as CR-001 in the change-request register |
| D-002 | 2026-07-30 | Product name: **Healthy360** | Plan §2 |
| D-003 | 2026-07-30 | Identifiers: PHP namespace `Healthy360\`, npm scope `@healthy360/*`, bundle IDs `com.healthy360.*` | Plan §2 |
| D-004 | 2026-07-30 | Launch markets: Lebanon, UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman, Jordan, Egypt | All ISO countries seeded; only launch set marked active (Plan §2) |
| D-005 | 2026-07-30 | Initial languages: English and Arabic (full RTL) | French and others capable of later addition (Source §6; Plan §2) |
| D-006 | 2026-07-30 | Laravel modular monolith; microservices prohibited this phase | ADR-0001 |
| D-007 | 2026-07-30 | Shared PostgreSQL database with organisation isolation | ADR-0002 |
| D-008 | 2026-07-30 | Global user identity with organisation memberships | ADR-0003 |
| D-009 | 2026-07-30 | One universal Expo codebase (web, iOS, Android); build families; role areas | ADR-0004 |
| D-010 | 2026-07-30 | OpenAPI 3.1 spec-first; single generated TypeScript client via wrapped hey-api | ADR-0005 |
| D-011 | 2026-07-30 | Custom membership RBAC; spatie/laravel-permission rejected; allow-only in Phase 1 | ADR-0006 |
| D-012 | 2026-07-30 | Incremental RLS: app scoping first, six representative tables, three DB roles, no BYPASSRLS app role | ADR-0007 |
| D-013 | 2026-07-30 | PHP 8.4 + Pest 5 ("PHP 8.3 or later" mandate satisfied by 8.4) | ADR-0008 |
| D-014 | 2026-07-30 | Node 24 LTS + Expo SDK 57 + TypeScript 6; TS 7 explicitly not adopted | ADR-0009 |
| D-015 | 2026-07-30 | Laravel filesystem abstraction over any S3-compatible store; Garage v2 for local dev (MinIO community archived) | ADR-0010 |
| D-016 | 2026-07-30 | Frontend repository boundary; mock mode impossible in production (4 gates) | ADR-0011 |
| D-017 | 2026-07-30 | Offline persistence restricted to non-sensitive reference data | ADR-0012 |
| D-018 | 2026-07-30 | Adopt the generated Laravel 13.23 app into `apps/api/`; do not regenerate | Plan §5; Phase 0 complete |
| D-019 | 2026-07-30 | Retain Fortify, convert to JSON responses under `/api/v1/auth/*`; remove Inertia frontend and starter-kit web assets | Plan §5, §13 |
| D-020 | 2026-07-30 | Step-up authentication returns HTTP 403 with `auth.step_up_required` (not 423) | Plan §13; `docs/api/conventions.md` |
| D-021 | 2026-07-30 | Passkeys may remain disabled in the UI even where Fortify installs supporting dependencies | Plan §13; enablement is OQ-004 |
| D-022 | 2026-07-30 | InterNACHI Modular adopted only after the compatibility spike passes; fallback is `app/Modules/` namespaces | Plan §6 |
| D-023 | 2026-07-30 | UUIDv7 primary keys, application-generated via central identifier service; ISO codes for stable reference data | Plan §8 |
| D-024 | 2026-07-30 | Dependency versions governed by one compatibility matrix, lockfiles and controlled ranges — no per-patch ADRs | Plan §3; `docs/architecture/dependency-compatibility.md` |
| D-025 | 2026-07-30 | No audit-log partitioning until volume/retention confirmed | Plan §12; risk R-007 |
| D-026 | 2026-07-30 | Latin digits as configurable default for clinical/financial numerals in Arabic locales | Provisional product default pending management sign-off (A-002, OQ-001) |
