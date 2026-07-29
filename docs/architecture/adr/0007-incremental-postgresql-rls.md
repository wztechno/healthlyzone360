# ADR-0007 — Incremental PostgreSQL Row-Level Security

## Status

Accepted — 2026-07-30.

## Context

Shared-database tenancy (ADR-0002) needs defence in depth: application scoping bugs must not become cross-tenant data leaks. Full RLS on every table from day one would slow the foundation workflow, complicate migrations and seeding, and risk debugging opacity before the basic vertical slice even works.

## Decision

Introduce RLS incrementally:

- **Phase 1A (first)**: organisation-context middleware, explicit query scoping, Laravel policies, cross-organisation feature tests. Application scoping must work before any RLS is enabled.
- **Phase 1B**: enable RLS on six representative tables: `organisation_branches`, `organisation_memberships`, `roles`, `feature_entitlements`, `consent_grants`, `audit_logs`. Session context via `app.user_id`, `app.organisation_id`, `app.branch_id`.
- **Three database roles**: an owner/migrator role; an application role **without** `BYPASSRLS`; a test role with application-equivalent privileges. No broadly privileged runtime `system` role in Phase 1 — cross-tenant administrative/background processes must later use explicit, audited service pathways.
- **Verification tests** (phase gate): no context fails closed; cannot read or update another organisation's data; queue jobs restore correct context; reused pooled connections do not retain prior tenant context; migrations run without application-runtime privileges.
- Explicitly rejected: a generic SQL-listener rule asserting every statement contains an organisation predicate (false positives; duplicates what RLS does properly).

## Consequences

- Two independent isolation layers on the representative set; a scoping bug in application code fails closed at the database.
- Remaining tenant tables rely on application scoping until RLS is extended — the representative set proves the operational pattern (context propagation, pooling, queues) before broad rollout.
- Every new tenant-scoped table must decide: join the RLS set or document why not, at migration time.
- Local development and CI must run with the non-BYPASSRLS application role to keep tests honest.

## Review trigger

Extend RLS coverage at each new module's first migration; re-examine the whole approach if session-variable context proves incompatible with the chosen connection pooler, or when a background/system pathway is first genuinely needed.
