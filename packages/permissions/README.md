# @healthy360/permissions

The framework-independent access guard kernel (plan §17, 05-universal-frontend.md §5). It imports
nothing from React, React Native or Expo — only `@healthy360/domain-types` — so it is unit-testable
under Vitest and reusable by any renderer. `evaluateGates(state, requirement)` runs the seven gates
in a fixed order (build mode → authentication → email verification → organisation context → branch
context → feature entitlement → required permission), first failure wins, and returns a
discriminated `GateResult` carrying a stable machine-readable `reason` (`mode_excluded`,
`unauthenticated`, `email_unverified`, `no_organisation_context`, `no_branch_context`,
`entitlement_missing`, `permission_missing`) that both tests and the forbidden page key off.
Alongside it sit `can()`, the `MODE_ROUTE_AREAS` build-mode map, the per-area `ROUTE_REQUIREMENTS`
registry and `resolveLandingRoute()`. **Client guards improve UX only — Laravel remains
authoritative** and every guarded action is re-authorised server-side.
