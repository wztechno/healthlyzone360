# Risks and Issues Register

Live register. Likelihood/impact: Low / Medium / High. All entries opened 2026-07-30.

## Risks

| ID | Risk | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| R-001 | `@hey-api/openapi-ts` is pre-1.0 (0.99.0); breaking generator changes could invalidate the committed client or wrapper script | M | M | Exact pin; project-owned wrapper script; committed output; drift CI; upgrade only as a reviewed act (ADR-0005) | Open |
| R-002 | NativeWind 4.2 `rtl:`/`ltr:` variants are broken on native — a core hazard for an Arabic-first product | H | M | Use logical utilities (`ps-`/`pe-`, `start-`/`end-`) exclusively; forbid `rtl:`/`ltr:` variants via lint; RTL visual tests; NativeWind remains provisional until the en/ar × web/native × light/dark spike passes (Plan §19) | Open |
| R-003 | Two-runner test split (Vitest for TS packages, Jest Expo + RNTL for RN rendering) doubles config surface and can drift | M | L | Shared test utilities in `packages/testing`; both runners wired into one Turborepo pipeline and CI | Open |
| R-004 | TypeScript 7 ecosystem lag: staying on TS 6 while the ecosystem migrates could strand tooling | L | M | Recorded review trigger in ADR-0009 (typescript-eslint support + stable programmatic API); compatibility matrix tracks it | Open |
| R-005 | Windows host PHP lacks `pdo_sqlite` and `intl`; bare-host workflows may silently diverge from Docker/CI | M | L | PostgreSQL is the only test database; Docker image includes `intl`; document bare-host limits (A-005) | Open |
| R-006 | Garage v2 is a less common dev object store; behavioural gaps versus production S3 providers possible | L | L | Laravel filesystem abstraction only, no Garage-specific APIs (ADR-0010); validate against real provider before storing sensitive documents | Open |
| R-007 | Audit-log growth without partitioning degrades queries and complicates retention enforcement | M | M | Deliberate deferral (D-025) with review at first production tenant; append-only design keeps later partitioning tractable; retention decision pending (OQ-002) | Open |
| R-008 | Expo native layout-direction change requires an application reload; a poor flow would break the Arabic/English switch experience | M | M | Implement the explicit user-facing reload flow required by Plan §20; cover in RTL visual tests | Open |
| R-009 | Removing the starter kit's Teams feature and Inertia assets could break Fortify auth flows or leave dead schema | M | M | Plan §5 sequencing: identify auth behaviour/dependencies before removal; keep one canonical users migration; Pest coverage of auth before surgery | Open |
| R-010 | InterNACHI Modular spike could fail against Laravel 13 (discovery, config caching, Larastan, optimisation) | L | M | Gated spike before adoption (Plan §6); fallback to project-owned `app/Modules/` namespaces costs little | Open |
| R-011 | RLS session-variable context could interact badly with connection pooling/queue workers (stale tenant context) | M | H | Mandated verification tests: context reset on reused connections, queue-job context restoration, fail-closed on no context (ADR-0007) | Open |
| R-012 | Regulatory obligations in nine launch markets are unassessed; some may impose residency, licensing or health-data rules affecting architecture | M | H | Per-country assessment before real-tenant onboarding (OQ-003); no compliance claims made until assessed | Open |

## Issues

| ID | Issue | Raised | Action | Status |
|---|---|---|---|---|
| I-001 | None recorded yet | — | — | — |
