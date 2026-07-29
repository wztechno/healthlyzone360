# ADR-0006 — Custom organisation-membership RBAC (not spatie/laravel-permission)

## Status

Accepted — 2026-07-30.

## Context

Authorisation here is membership-relative: what a user may do depends on the organisation and branch they are acting in (ADR-0003). `spatie/laravel-permission` attaches roles/permissions to the user model and would need team-scoping workarounds that fight its design. Worse, the platform will eventually face entitlements, consent, patient-provider relationships and step-up authentication — collapsing all of that into one opaque permission resolver is explicitly prohibited by the plan (§10).

## Decision

Implement a small custom RBAC on four tables: `roles`, `permissions`, `membership_roles`, `role_permissions`, keyed to `organisation_memberships`.

**Six-step RBAC decision** (in order): 1) authenticated? 2) membership active? 3) selected branch inside membership scope? 4) assigned role grants the required permission? 5) resource belongs to the selected organisation? 6) policy permits the action?

**Separated concerns**, each evaluated separately with a distinct denial reason (never merged into RBAC): feature/subscription entitlement; patient-provider relationship; consent; professional assignment; resource ownership; step-up authentication; regulatory restrictions.

**Phase 1 behaviour**: allow-based permissions only — no general deny rules; prohibited actions get explicit policies. Optional `starts_at`/`expires_at` on membership-role assignments. Permission strings follow `domain.action_scope` (e.g. `organisation.view_current`, `membership.invite_organisation`, `session.revoke_own`). Calculated permissions are cached per user × organisation × branch and invalidated via a permission-version counter. Kitchen and commercial permissions remain registry proposals until those modules exist.

## Consequences

- We own the code: no third-party upgrade risk, exact fit for membership scoping; but also no community fixes — the model must stay small and heavily tested.
- Distinct denial reasons map cleanly to the API error namespaces (`authz.*`, `tenancy.*`, `auth.step_up_required`) and to testable frontend guard reasons.
- Adding deny rules later is a deliberate model change, not a configuration flag.

## Review trigger

Re-examine if permission volume or delegation requirements (custom per-tenant roles, fine-grained ABAC) outgrow the four-table model, or before implementing the first clinical module (relationship + consent checks become load-bearing).
