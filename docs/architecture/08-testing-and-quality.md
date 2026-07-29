# 08 — Testing and Quality

Status: Baseline — Phase 1 (platform foundation). Derived from the authoritative foundation plan (§3, §11, §15, §18, §24, §25). Gates: cross-organisation tests (execution Phase 3), API vertical slice tests (Phase 4), RLS tests (Phase 6), CI (Phase 7).

## 1. Backend

### 1.1 Tooling

| Tool | Role |
| --- | --- |
| Pest 5 | All test suites |
| Larastan 3 | Static analysis |
| Laravel Pint | Formatting (enforced in CI) |

### 1.2 Suites

| Suite | Scope |
| --- | --- |
| Unit | Pure domain logic per module |
| Feature | HTTP/API behaviour: Fortify JSON auth, `/api/v1/me`, context selection, error envelopes, correlation IDs |
| Tenancy / cross-organisation | A member of organisation A can never read or mutate organisation B's data through application scoping and policies (execution Phase 3 gate) |
| RLS verification | Database-level isolation (§1.4; execution Phase 6) |

### 1.3 Migration test discipline

* All tests run against **PostgreSQL 18** — never SQLite; parity bugs are unacceptable in an RLS architecture.
* CI runs migrations from scratch against PostgreSQL on every backend workflow run.
* Migrations run under the owner/migrator role; tests use the test role with application-equivalent privileges (plan §11).

### 1.4 RLS verification list

The RLS suite must prove, at minimum:

1. **Fail closed**: with no session context set (`app.user_id`, `app.organisation_id`, `app.branch_id`), protected tables return nothing.
2. **No cross-organisation read or update**: context for organisation A can neither read nor update organisation B's rows.
3. **Queue jobs restore context**: a job processes with the correct tenant context, not the worker's previous one.
4. **Reused connections do not leak context**: a pooled/reused connection carries no prior tenant's session variables.
5. **Migrations need no application-role privileges**: schema changes run entirely under the migrator role.

### 1.5 Explicitly rejected: generic SQL-listener assertion

* **Problem**: A tempting "safety net" is a query listener asserting every SQL statement contains an organisation predicate.
* **Recommendation**: Do **not** build it (plan §11).
* **Benefit**: Avoids a false sense of safety and permanent maintenance drag.
* **Implementation impact**: None — this records the rejection so it is not re-proposed.
* **Risk of adoption** (inverted): False positives on legitimately global queries (reference data, platform administration) and duplication of what RLS enforces authoritatively at the database.
* **MVP status**: Rejected for Phase 1 and beyond unless new evidence emerges.

## 2. Frontend

### 2.1 Tool split (recorded honestly)

React Native Testing Library under Vitest is **not viable**; the runner split below is deliberate, not accidental.

| Layer | Tool | Scope |
| --- | --- | --- |
| Framework-independent TS packages (`permissions`, `validation`, `domain-types`, `api-client` wrappers, `i18n` logic) | Vitest | Fast, no React Native runtime |
| React Native rendering | jest-expo + React Native Testing Library | Component and screen rendering, guards' UI behaviour |
| Web end-to-end | Playwright | Vertical-slice smoke on the web export |
| Web accessibility | Playwright + axe | Accessibility smoke on Phase 1 screens |
| Configuration validation | Expo Doctor + web export | Doctor checks plus exports for `all-dev` and one production mode prove the build configuration is real |

### 2.2 Contract and safety tests

| Test | Assertion |
| --- | --- |
| Fixture ↔ generated-schema conformance | Every mock fixture validates against the OpenAPI-generated schemas — mocks cannot drift from the contract |
| Generated-client drift | Regenerating the client from the bundled OpenAPI document produces no diff |
| Mock-production negative test | A production build with mock mode enabled **fails**; this is asserted, not assumed |
| RTL visual tests | Arabic layouts verified for the Phase 1 screens (see `05-universal-frontend.md` §8) |
| Missing-translation checks | CI fails on untranslated keys |

## 3. Contract testing (backend side)

OpenAPI 3.1 is linted and bundled with Redocly; implemented endpoints have contract tests. Full runtime request/response schema validation follows the plan §15 validator spike — if no maintained PHP validator proves reliable, the fallback is linting + generated-client compilation + targeted contract assertions + endpoint smoke tests, with runtime validation **recorded as deferred**. No custom 200-line validation fallback is written.

## 4. Continuous integration — three workflows

| Workflow | Jobs |
| --- | --- |
| **Backend** | composer validation; Pint; Larastan; Pest; PostgreSQL migration test; tenancy tests; RLS tests; OpenAPI lint and bundle |
| **Frontend** | frozen pnpm install; formatting; ESLint; TypeScript; Vitest; Jest Expo; Expo Doctor; web export (`all-dev`); web export (one production mode); Playwright smoke + accessibility |
| **Security and contracts** | secret scanning; dependency review; CodeQL; generated-client drift; fixture/schema conformance; mock-production negative test |

Renovate/Dependabot updates must pass these workflows before merge (plan §3).

### 4.1 Deferred CI

| Item | Status |
| --- | --- |
| Nightly visual matrices (locale × platform × theme) | Deferred until substantial UI exists |
| Every-build-mode export matrices | Deferred — `all-dev` + one production mode suffice for Phase 1 |

## 5. Definition-of-done linkage

CI green is necessary but not sufficient: Phase 1 completes only when the full checklist in plan §27 holds, including the vertical slice against the real API on web and a native development build. The completion report must state failures explicitly rather than claim readiness past a failing gate (plan §29).
