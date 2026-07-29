# ADR-0003 — Global user identity: one person, many organisations via memberships

## Status

Accepted — 2026-07-30.

## Context

Real actors in this ecosystem hold several simultaneous roles: a dietitian working in two clinics; a kitchen manager over several branches; a patient connected to both a clinic and a kitchen; a professional owning an independent practice while employed elsewhere. Per-tenant user accounts would force duplicate credentials, fragment the health journey and break cross-organisation features (referrals, marketplace ordering).

## Decision

One global Healthy360 identity per person (`users`), with organisation participation modelled as `organisation_memberships` rows (user × organisation, optionally branch-scoped). Roles and permissions attach to the membership, not the user (`membership_roles` → `role_permissions`). The authenticated context is always: user + active organisation membership + active branch where applicable, established via `PUT /api/v1/me/context` and validated server-side on every request.

## Consequences

- Single credential set, single verification state, single 2FA enrolment per person.
- Authorisation is always membership-relative; no permission may ever be evaluated against the bare user without organisation context (except platform-level self-service such as `session.revoke_own`).
- The `users` table is platform-global and therefore excluded from organisation-scoped RLS; its protection relies on application policy and column-level care.
- Account deletion/anonymisation must consider every membership and each organisation's retention obligations — deferred design, see open-questions register (OQ-002, OQ-003).
- Clients must send `X-Organisation-Id`/`X-Branch-Id` headers after context selection; the server re-validates them against active memberships on every request.

## Review trigger

Re-examine if a partner or regulator requires tenant-controlled (federated/SSO) identity rather than platform identity, or if patient/professional identity must be legally separated in any market.
