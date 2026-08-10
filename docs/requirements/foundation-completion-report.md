# Healthy360 Platform Foundation — Completion Report

Date: 2026-07-30. Scope: the approved revised foundation plan (all eight execution phases).
Status: **complete — every mandatory gate passed**, with limitations and open decisions listed
honestly below.

## 1. Implemented scope

The foundation proves the mandated vertical slice **against the real Laravel API**:

> registration → email verification (link retrieved from the mail log) → login → organisation
> selection → server-applied branch → permission hydration → authenticated workspace,

exercised by an automated acceptance suite (7 scenarios) driving the exported Expo web build
against the live Docker stack, plus real step-up device revocation and a cross-organisation
rejection returning the `context.organisation_forbidden` envelope.

## 2. Architecture decisions

Recorded as ADR-0001 – ADR-0012 (`docs/architecture/adr/`), decisions register and
`dependency-compatibility.md`. Highlights: modular monolith (InterNACHI Modular, spike-verified);
shared PostgreSQL 18 with incremental RLS; global user identity; one Expo SDK 57 universal
codebase; spec-first OpenAPI 3.1 with a generated TypeScript client behind a project-owned
script; custom organisation-membership RBAC (allow-only, six steps, distinct denial reasons);
bearer-only frontend transport in this phase (the exported app is cross-origin; documented in the
5c commit). Deviations from mandate, all recorded: PHP 8.4 (Pest 5 requires it), Garage instead
of MinIO ("or equivalent" clause), jest-expo + RNTL rather than RNTL-under-Vitest, TypeScript 6
(TS 7 blocked by typescript-eslint peers).

## 3. Database

23 foundation tables (see `docs/architecture/foundation-erd.md`), UUIDv7 application-generated
keys, ISO-code reference tables, seeded: 249 countries (9 MENA launch markets active), 154
currencies, en/ar/fr languages, measurement units, 12 organisation types, 20 foundation
permissions, 4 platform template roles, feature and consent definitions, demo tenants.
Role split: `healthy360_migrator` (DDL, seeds) / `healthy360_app` (runtime, NOBYPASSRLS) /
`healthy360_test`. RLS enabled on the six representative tables, fail-closed, proven by a
23-test group including same-worker queue context isolation and append-only audit grants.

## 4. API

24 endpoints under `/api/v1` (headless Fortify auth incl. TOTP two-factor, Sanctum cookie + PAT,
device management with step-up 403 `auth.step_up_required`, `/me` hydration, context selection,
`organisations/current` permission probe), success/error envelopes with an 18-code `ErrorCode`
enum kept in lockstep with `docs/api/conventions.md` and the OpenAPI schema by test, correlation
IDs, audited rate limiting. OpenAPI 3.1 hand-authored, Redocly-linted, bundle committed,
route↔spec parity by test.

## 5. Frontend

Nine `@healthy360/*` packages + `apps/universal` (Expo SDK 57, RN 0.86, TS 6.0, NativeWind 4
spike-verified, logical-utilities-only RTL enforced by lint). Fourteen functional screens; the
seven-gate `evaluateGates` kernel (mode → auth → email → organisation → branch → entitlement →
permission) drives route guards, `<Gate>`, `<Can>` and navigation filtering. Mock repositories
with six coherent scenarios; mock mode visibly bannered and blocked from production by four
independent gates (config throw, build script, CI assertion, runtime throw — negative-tested).
Generated client: `@hey-api/openapi-ts` 0.99.0 (typescript + zod v4 plugins; the SDK/fetch
plugins do not compile in 0.99.0 — documented in `scripts/gen-api.mjs`).

## 6. Commands and validation results (final runs)

| Gate | Result |
| --- | --- |
| Backend Pest suite (PostgreSQL, includes tenancy + RLS groups) | **175 passed / 778 assertions** |
| Larastan level 7 | 0 errors, no baseline |
| Pint | clean |
| Migration cycle (fresh → full rollback → re-migrate → seed) | clean |
| OpenAPI Redocly lint + committed bundle drift | valid / drift-free |
| Turbo typecheck + lint + tests (9 packages + app) | 30/30 |
| Vitest (pure TS incl. 33 fixture↔schema conformance tests) | green (api-client alone: 156) |
| jest-expo (design system 197 + app 80) | 277 passed |
| Prettier format check (now a CI gate) | clean |
| expo-doctor | 20/20 |
| Web export (all-dev mock; customer production api) | clean; production+mock **fails by design** |
| Playwright mock suites (web-ltr, web-rtl, axe) | **15/15**; axe zero serious/critical |
| Playwright acceptance vs live stack | **7/7** |
| Android bundle export | clean (`.hbc` produced) |
| Clean-clone validation (fresh clone → `scripts/setup.sh` → live API smoke → 175 tests → frozen frontend install) | passed (one transient Windows port-release retry, see §8) |

CI: `backend.yml`, `frontend.yml`, `security.yml`, `contracts.yml` (plus Dependabot). The
acceptance project intentionally does not run in CI yet (OQ-015).

## 7. Security posture

RLS fail-closed on the representative set; runtime role cannot BYPASSRLS or touch DDL;
audit_logs append-only at grant level; log redaction on every channel; encrypted 2FA columns
with a KMS adapter contract; consent capture at registration with versioned definitions;
purpose-of-use required on sensitive-access audit records; secret scanning, dependency review,
prohibited-file checks and CodeQL in CI; no secrets in the repository (all local credentials are
documented dev-only placeholders). **No claim of legal compliance with any jurisdiction is made**
(OQ-003).

## 8. Known limitations

- **Native on-device run is not yet demonstrated** — the Android bundle builds and the stack is
  Expo Go-compatible by design, but running on a device/emulator needs developer hardware.
- Mock↔backend permission vocabulary drift remains for two codes (OQ-013); `/me` field gaps and
  the missing branch-directory endpoint constrain the client (OQ-014); a member-less user gets
  `active_context: null` where the mock models a global context (OQ-012).
- Windows quirks are handled but real: PostgreSQL published on 55432 (native service owns 5432),
  container-private vendor volume (Composer junctions do not resolve in Linux binds), Horizon
  container-only (no pcntl on Windows), and a transient docker-proxy port-release race required
  one idempotent setup retry during clean-clone validation.
- Audit-log partitioning, retention automation, crypto-shredding, dedicated-tenancy options,
  passkeys and all business modules are deliberately deferred (plan §28).

## 9. Open management decisions

OQ-001 (Arabic numbering default — provisional Latin digits, configurable), OQ-002 (retention
periods), OQ-003 (per-country regulatory validation), OQ-004 (passkeys), OQ-005 (branch-required
rules per organisation type), OQ-006 (tenant-environment wording vs shared DB), OQ-007 (French),
OQ-008 (production hosting/providers), OQ-009–OQ-015 (see register).

## 10. Recommended next step

Prompt 2: the reference UI prototype phase over this foundation — richer workspace prototypes per
role area against the mock scenarios — in parallel with the small backend follow-ups in OQ-013/014
(permission vocabulary alignment, `/me` enrichment, branch directory endpoint) and the
compose-in-CI acceptance job (OQ-015). Business modules then proceed module by module per
`docs/architecture/09-future-module-roadmap.md`.
