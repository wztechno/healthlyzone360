# ADR-0002 — Shared-database multi-tenancy with organisation isolation

## Status

Accepted — 2026-07-30.

## Context

The source requirements demand a multi-tenant SaaS serving clinics, kitchens, fitness partners, suppliers, insurers and corporates, with strict data segregation. Options considered: database-per-tenant, schema-per-tenant, and a shared database with tenant-scoping columns. Database-per-tenant complicates the global user identity (one person across many organisations — ADR-0003), cross-organisation membership queries, migrations at scale and platform-level reporting. The launch markets (nine MENA countries) do not yet have confirmed data-residency requirements that would force physical separation.

## Decision

Use one shared PostgreSQL 18 platform database. Every tenant-owned table carries an `organisation_id` (and `branch_id` where applicable) scoping column. Isolation is enforced in layers: organisation-context middleware and explicit query scoping first, Laravel policies, cross-organisation feature tests, then PostgreSQL Row-Level Security incrementally (ADR-0007). Client-supplied organisation/branch identifiers are never trusted without server-side validation against the user's active membership.

## Consequences

- Global identity, cross-organisation memberships and platform administration remain simple single-database queries.
- Tenant isolation is a software-and-RLS guarantee, not a physical one; it must be continuously proven by tests (cross-organisation access tests are a phase gate).
- The source document's phrase "independent tenant environments" is interpreted as logical isolation plus tenant-specific configuration, not separate deployments — recorded for management confirmation (OQ-006).
- Future data-residency law in a launch country could force per-region database instances; the scoping-column model keeps that migration tractable.

## Review trigger

Re-examine on confirmed data-residency/localisation requirements in any launch market, on onboarding a tenant contractually requiring physical isolation, or if RLS policy complexity becomes unmanageable.
