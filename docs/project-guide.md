# Healthy360 — Project Guide

What was built across the two delivery prompts, what state the project is in, and exactly how to
run everything on a local machine. Written 2026-07-31, updated 2026-08-05 for real kitchen commerce.

---

## 1. What Healthy360 is

A multi-tenant health, nutrition and wellness platform: dietitian clinics, healthy-food kitchens,
patients/consumers, suppliers, delivery, corporate wellness and insurance partners in one
ecosystem, in English and Arabic with full right-to-left support, for nine launch markets
(LB, AE, SA, QA, KW, BH, OM, JO, EG).

The project was delivered in two sequenced prompts:

| Prompt | Outcome | State |
| --- | --- | --- |
| **1 — Platform foundation** | Laravel 13 API + PostgreSQL row-level security + Expo universal app, with a working end-to-end vertical slice (register → verify e-mail → pick organisation → pick branch → permissions → workspace) proven against the real API | **Complete** — 175 backend tests, acceptance suite 7/7 against the live stack |
| **2 — Reference research + UI prototype** | 18 evidence-classified research documents on two reference products, plus a full mock-first UI prototype (~83 routes: marketplace, onboarding, nutrition, virtual dietitian, planner, commerce, B2B, professional) and six **proposed** (not implemented) API contract drafts | **Complete** — 254/254 e2e + 38/38 visual baselines; no backend domain code written |

The critical honesty rule that governs everything, in its post-D-087 form: **there is no mock
mode.** The mock implementation was deleted on 2026-08-11/12 (ADR-0013, D-087); every build
talks to the Laravel API, screens are tested against declared stub worlds, and every Playwright
project runs the api export against the seeded Docker stack. Kitchen catalogue, marketplace,
cart/checkout (COD), subscriptions, kitchen ops, and B2B programmes/quotations are wired.
Surfaces with no backend (planner, nutrition, recipes/grocery, virtual dietitian, dietitian
directory and review queue, partner supply, POS, driver, patient/clinic/insurance workspaces)
are **hidden** by `apps/universal/src/features/availability.ts` — no entry points, direct URLs
redirect — with `api/prototype-repositories.ts` still rejecting nameably underneath as the
dead-man's switch.

---

## 2. What Prompt 1 applied — the platform foundation

### 2.1 Stack and repository shape

- **Backend**: Laravel 13.23 on PHP 8.4, structured as a modular monolith (InterNACHI Modular,
  namespace `Healthy360\`) at `apps/api`. PostgreSQL 18, Redis 8, Horizon for queues (runs in the
  Linux container only), Garage as local S3-compatible storage. Outgoing mail uses the `log`
  mailer in dev (written to `apps/api/storage/logs/laravel.log`) and Brevo for real delivery.
- **Frontend**: one Expo SDK 57 universal app (`apps/universal`) — React Native 0.86 / React 19.2
  / TypeScript 6 — targeting web, iOS and Android from a single codebase, with NativeWind 4
  (Tailwind-style utilities) and Expo Router file-based routing.
- **Monorepo**: pnpm 11 workspaces + Turborepo. Shared TypeScript packages under `packages/`:
  `@healthy360/domain-types`, `permissions`, `api-client`, `design-tokens`, `design-system`,
  `i18n`, and (Prompt 2) `nutrition`.

### 2.2 Identity, tenancy and permissions

- Users hold **memberships** in organisations, optionally scoped to a branch. Organisation types
  cover clinics, kitchens, corporates, insurers, suppliers and platform staff.
- **Allow-only RBAC**: permissions are granted, never denied-by-exception. The evaluation order is
  a pure 7-gate kernel shared by backend and frontend
  (`packages/permissions`): mode → authentication → e-mail verification → organisation context →
  branch context → entitlement → permission.
- **Step-up authentication** for sensitive actions (e.g. revoking a device): the API answers
  HTTP 403 `auth.step_up_required`; the client opens a password dialog and retries.
- All IDs are **application-generated UUIDv7**.

### 2.3 Row-level security (the defining backend decision)

PostgreSQL RLS is applied incrementally on six representative tables, with three database roles:

- `healthy360_migrator` — owns the schema; the only role that may run DDL. Migrations and seeding
  always run through the separate `pgsql_migrations` connection.
- `healthy360_app` — the runtime role: owns nothing, `NOBYPASSRLS`, so every query is subject to
  the policies. Request context (`app.user_id`, `app.organisation_id`, `app.branch_id`) is set
  per request/queue job as session variables.
- `healthy360_test` — same posture for the test database.

23 dedicated RLS tests prove isolation (an authenticated user cannot read another organisation's
rows even with raw SQL through the app role).

### 2.4 Authentication and API

- **Fortify, headless**: JSON-only auth endpoints under `/api/v1/auth` (register, login, logout,
  e-mail verification, password reset), Sanctum for both cookie sessions (web) and personal
  access tokens (native), device/session management with step-up revocation.
- **Spec-first OpenAPI 3.1** for the implemented API, with a generated TypeScript client
  (`@hey-api/openapi-ts` — typescript + zod plugins) consumed by the app's api-mode repositories.
- Response envelopes, error codes (`domain.reason` shape), locale/version headers, and audit
  logging (append-only, with redaction rules for sensitive fields) are all standardised and
  documented in `docs/architecture/`.

### 2.5 Frontend foundation

- **Repository boundary**: screens talk to hooks, hooks talk to repository interfaces, and the
  one implementation is `api` (the generated client). The full 21-repository / 238-method
  surface is recorded as data in `packages/api-client/src/contracts/repository-surface.ts`,
  compile-checked against the contracts and runtime-checked against the api bundle. (The former
  `mock` implementation was deleted — ADR-0013.)
- **Design system** (`packages/design-system` over `design-tokens`): primitives, forms, overlays,
  navigation, status components, app shells — all direction-aware (RTL via logical utilities
  only; `rtl:`/`ltr:` variants are lint-banned), theme-aware (light/dark) and axe-clean, with a
  living showcase route.
- **i18n**: English + Arabic catalogues per namespace, a generated key union
  (`keys.generated.ts`) for compile-time key safety, a generated `en-XA` pseudo-locale for
  expansion testing, and consistency checks in CI.
- **Foundation screens**: the full auth journey, organisation/branch pickers, workspace selector,
  profile, devices (with step-up), consent, forbidden/not-found, all with loading/empty/error
  states.
- **Verification**: jest + React Native Testing Library for screens — each suite declares its
  session and repository answers through `src/testing/stub-screen.tsx` (unstubbed calls fail
  loudly, never silently) — Vitest for packages, and Playwright for web e2e where **every**
  project (LTR, RTL, axe, visual, and the single-worker `web-write` mutation project) runs the
  api export against the seeded Docker stack, reading verification e-mail from the API log (the
  dev `log` mailer).

### 2.6 Documentation and CI

Ten architecture documents, twelve ADRs, a compatibility matrix, and ten registers (decisions,
open questions, risks, assumptions, requirements, data, dependencies, integrations, change
requests, report catalogue) under `docs/`. Three GitHub Actions workflows (backend, frontend,
contracts) — present and correct, though they have never run because the repository has no
remote yet.

---

## 3. What Prompt 2 applied — research and the UI prototype

### 3.1 Reference research (docs/reference-research/, 18 documents)

Lawful, public-only research on **Right Bite** (rightbite.com) and **Eat This Much**
(eatthismuch.com). Every claim in every inventory (pages, journeys, components, forms,
interactions, motion, responsive behaviour, nutrition display, meal generation, subscriptions,
professional workflows) carries an evidence classification — `OBSERVED_PUBLIC`,
`DOCUMENTED_PUBLIC`, `USER_PROVIDED`, `INFERRED`, `UNKNOWN`, `REQUIRES_PERMISSION`,
`OFFICIAL_API_AVAILABLE` — with URL, date and method. Hard boundaries honoured: robots.txt
respected, no accounts created, no personal data submitted, internal algorithms never claimed
(explicitly marked unobservable), and all product recommendations re-expressed as "our platform
should implement…" (doc 17). Doc 15 is a manual-capture checklist for a future authorised
session; doc 16 resolves the official-API question; the Eat This Much meal-planning-provider
integration is designed as documentation only under `docs/architecture/integrations/`.

### 3.2 Contracts, nutrition engine, fixtures

- **`@healthy360/nutrition`** (new, pure TypeScript): the 13 mandated nutrition-facts contracts
  (per serving / per 100 g / recipe / meal / day / week; planned|actual|target; tolerances;
  sources; versions), aggregation and scaling, five-stop level mapping, and a
  `MockNutritionTargetEngine` built exclusively from **cited public formulae** (Mifflin–St Jeor,
  Katch–McArdle when body fat is known, FAO/WHO/UNU activity multipliers, IoM AMDR bands). Every
  result carries `prototype: true`.
- **Eight repository contracts** (marketplace, nutrition, planner, foods, virtual-dietitian,
  commerce, business, professional) with two implementations each: the mock `PrototypeStore`
  world, and API stubs in which **every method rejects with `prototype.not_implemented`** — the
  compiler enforces the surface, a test iterates it, and nothing can silently pretend to be real.
- **Proposed OpenAPI drafts** (`docs/api/proposed/`, six documents, 35 paths / 37 operations,
  all `info.x-status: draft`) — parity-pinned by test, linted by `pnpm run api:lint:proposed`,
  and verified invisible to the real backend spec toolchain.
- **Fixtures**: entirely synthetic and labelled as such on-screen ("Source: synthetic prototype
  data"). Count-pinned by test: 6 kitchens / 11 branches / 40 meals / 20 recipes / 8 plans × 3
  variants / ~60 ingredients / 5 dietitians / corporate programmes, tiers and quotations / a full
  Virtual Dietitian conversation / a generated planner week. Deterministic UUID bands per entity
  type. AED throughout, one SAR B2B price proving multi-currency; cross-currency summation is
  forbidden by test. A vocabulary-scan test guards against copied reference wording.

### 3.3 The prototype surfaces (~83 routes, 42 feature screens)

- **Public marketplace** (no sign-in): landing, discover, how-it-works, for-business, kitchen
  directory/profile/menu, meal grid + detail, plan grid + detail + comparison, diet hubs,
  dietitian directory + profile, calorie and macro calculators.
- **Consumer onboarding**: a 22-step URL-addressable wizard with six distinct restriction kinds
  (preference, self-declared medical, dietitian-enforced, allergy, intolerance, dislike,
  religious), then a transparent **nutrition-target page** (which formula, which inputs, why this
  target, recalculate, request professional review).
- **Virtual Dietitian**: all twelve session states, AI labelling on every suggestion, human
  override, safety escalation — never presented as medical care.
- **Planner**: week (grid on desktop, agenda on phones) and day views; lock; regenerate at three
  scopes; a replacement drawer with filters and nutrition/cost/allergen difference previews;
  keyboard move-to; notes; history; recipe records; a derived grocery list.
- **Commerce**: cart, checkout preview, an eight-step subscription configurator (no price shown
  before the delivery checks), and real pause/resume/skip/change-window transitions.
- **B2B + professional**: corporate dashboard, programme catalogue, item detail, quotation list
  and builder (submission is a **real** store mutation); partner commitments and supply
  schedule; dietitian review queue, review detail and client plan.

### 3.4 The guard invariants (what kept the prototype honest — historical; the mock world and its gates were retired by ADR-0013/D-087)

- **No dead controls**: every control either genuinely mutates the mock world, or is an explicit
  `usePrototypeAction` that shows "Not built yet — nothing was changed" plus (dev builds only)
  the exact proposed endpoint it is waiting on. A Playwright sweep presses them all.
- **Mock cannot ship**: fixture imports from app code are eslint-banned; api-mode builds carry no
  mock world; four independent gates enforce it.
- **MedicalDisclaimer** is mandatory and asserted (jest + e2e) on every health surface; catalogue
  copy is scanned for diagnose/treat/cure/prescribe claims.
- **B2B price privacy**: corporate contract prices exist only behind the corporate workspace —
  proven by a positive control, then a sweep of every public and customer route.
- **No external requests**: the exported app is proven to reach no host but its own — including
  explicit deny-asserts on the two reference domains.

### 3.5 The verification layer

- Playwright projects: `web-ltr`, `web-rtl` (a real Arabic build), `a11y` (axe, zero
  serious/critical), plus **visual regression** (`visual`, `visual-rtl`, `visual-dark`) with 38
  committed baselines that are authoritative **only** from the pinned
  `mcr.microsoft.com/playwright:v1.62.0-noble` container (host runs skip by design).
- A responsive spec asserting structure at all seven mandated viewports (320→1440 px): no
  horizontal overflow, navigation switches form, ≥44 px touch targets, grid-vs-agenda planner.
- Reduced-motion, prototype-action and no-external-request sweeps; export byte budgets in CI.
- Final numbers: turbo **33/33**, universal jest **595**, design-system **373**, e2e
  **254/254** + **38/38** visual, acceptance **7/7** against the live stack, `apps/api`
  untouched.

The full 14-section account is in `docs/requirements/prompt2-completion-report.md`; the product
decisions and contract gaps the backend phase must resolve are D-027–D-033 and OQ-016–OQ-028 in
`docs/registers/`.

---

## 4. Repository map

```text
apps/api/                     Laravel 13 modular monolith (the real, implemented API)
  app-modules/                Domain modules (identity, tenancy, audit, consent, ...)
  database/                   Migrations (migrator connection), seeders, factories
apps/universal/               Expo SDK 57 universal app (web + iOS + Android)
  app/                        Expo Router routes: (auth), (marketplace), (workspace),
                              customer/, corporate/, partner/, dietitian/, clinic/, kitchen/, ...
  src/features/               Feature trees: marketplace, catalogue, onboarding, nutrition,
                              virtual-dietitian, planner, commerce, business, professional
  src/data/                   TanStack Query hooks + query-key registry
  src/prototype/              The honest prototype-action mechanism
  e2e/specs/                  Playwright: *.ltr / *.rtl / *.a11y / *.visual* / *.write —
                              all against the api export + the seeded Docker stack
packages/
  domain-types/               Branded IDs, closed unions, Money (integer minor units)
  permissions/                The pure 7-gate permission kernel
  nutrition/                  Facts contracts + MockNutritionTargetEngine (cited formulae)
  api-client/                 Repository contracts + surface table; api/ (generated client
                              + the prototype.not_implemented stubs for unbuilt families)
  design-tokens/  design-system/  i18n/
docs/
  architecture/               10 architecture docs, 12 ADRs, integrations, notes
  api/proposed/               The six DRAFT OpenAPI contracts (not implemented)
  reference-research/         The 18 evidence-classified research documents
  registers/                  Decisions, open questions, risks, assumptions, ...
  requirements/               Completion reports for both prompts
infrastructure/docker/        Postgres init (roles/RLS), nginx, garage configs
scripts/                      setup / reset / storage-init (PowerShell + Bash), gen-api
.github/workflows/            backend.yml, frontend.yml (incl. visual job), contracts.yml
```

---

## 5. Running it locally, step by step

### 5.0 Prerequisites

1. **Docker Desktop** (WSL2 backend on Windows). Start it once interactively — the engine
   service needs an elevated first start on Windows.
2. **PHP 8.4** on the host with `pdo_pgsql` and `redis` extensions, plus **Composer**.
   (Horizon's `pcntl`/`posix` requirements are faked on the host by composer platform config —
   Horizon itself only runs inside the Linux container.)
3. **Node.js 24 LTS** with `corepack enable` (provides pnpm 11).
4. Windows only: enable Developer Mode and run `git config --global core.longpaths true`.

> Every credential in this repository (`compose.yaml`, `.env.example`, the Postgres init
> scripts) is a local-development placeholder. Real environments get secrets from their
> deployment platform, never from the repo.

### 5.1 First-time backend + services setup (one command)

```bash
# Windows PowerShell
./scripts/setup.ps1
```

```bash
# Git Bash / WSL / macOS / Linux
bash scripts/setup.sh
```

This does, in order: check Docker → create `apps/api/.env` from the example → host
`composer install` → `docker compose up -d --build --wait` (Postgres on **55432**, Redis, api +
nginx, queue/Horizon, Garage) → a second `composer install` **inside** the container
(the container has its own vendor volume, because Windows junctions in the host vendor don't
resolve in Linux binds) → object-storage init → app key → migrate + seed as the migrator role.

You now have:

| Service | Address |
| --- | --- |
| API through nginx | <http://localhost:8080> (health check: `/up`) |
| Outgoing mail (dev) | logged to `apps/api/storage/logs/laravel.log` |
| PostgreSQL 18 | `localhost:55432`, db `healthy360` (app role: `healthy360_app`) |
| Redis 8 | `localhost:6379` |
| Garage S3 | <http://localhost:3900> |
| Horizon dashboard | `/horizon` on the API |

Optionally run the API on the host instead of nginx: `cd apps/api && php artisan serve`
→ <http://localhost:8000>.

### 5.2 First-time frontend setup

```bash
pnpm install
```

If `pnpm` is not on your PATH yet, enable it via corepack **from an elevated shell** (it writes
shims into `C:\Program Files\nodejs`, so a normal shell gets `EPERM`):

```bash
corepack enable
```

If `pnpm --version` already answers, skip corepack entirely. Ignore pnpm's "update available"
banner — the repo pins `pnpm@11.15.1` through the `packageManager` field.

### 5.3 Mock mode — removed

There is no mock mode any more (ADR-0013, D-087). `EXPO_PUBLIC_DATA_MODE` is gone; every run
is §5.4 against the live backend. The seeded demo world now carries what the fixture world used
to showcase: six photographed kitchens, eight published plans and the forty-meal catalogue.

### 5.4 Run the app (against the live backend)

```powershell
# Windows PowerShell — stack must be up (5.1)
cd apps/universal
$env:EXPO_PUBLIC_API_URL='http://localhost:8080'; $env:APP_MODE='all-dev'; npx expo start --web --clear
```

```bash
# Git Bash / WSL / macOS / Linux — stack must be up (5.1)
cd apps/universal
EXPO_PUBLIC_API_URL=http://localhost:8080 APP_MODE=all-dev npx expo start --web --clear
```

Real end to end: registration (verification e-mail is written to the API log,
`apps/api/storage/logs/laravel.log`), sign-in (incl. the seeded 2FA account
`two-factor@cedar.test`, TOTP secret `DemoTenantSeeder::DEMO_TOTP_SECRET`),
organisation/branch/workspace, profile, devices with step-up revocation, consent, the
six-kitchen marketplace with its forty meals and eight plans, cart/checkout (COD),
subscriptions, the whole kitchen workspace (catalogue, recipes, pricing, delivery, plans,
orders, KDS, inventory/ops), and B2B programmes/quotations. The families with no backend are
hidden from the UI entirely (§1); their repository methods still answer
`prototype.not_implemented` if reached by code.

### 5.5 Run the test suites

```bash
# Everything static: typecheck + lint + all jest/vitest (33 turbo tasks)
pnpm run check

# Backend only
cd apps/api && php artisan test --compact          # 175 tests incl. 23 RLS proofs

# Frontend unit/component only
cd apps/universal && npx jest                       # 595 tests

# Formatting / i18n consistency / generated artefacts
pnpm run format:check
pnpm run i18n:check
pnpm run gen:api:check
```

End-to-end (against the seeded live stack — export the api artefact once, then run; the config
serves `dist-api/` on port 4173):

```powershell
# Windows PowerShell — stack must be up and seeded (5.1)
cd apps/universal
$env:EXPO_PUBLIC_API_URL='http://localhost:8080'; $env:APP_MODE='all-dev'; npx expo export -p web --output-dir dist-api --clear
npx playwright test --project=web-ltr --project=web-rtl --project=a11y   # read-only projects, parallel
npx playwright test --project=web-write --workers=1                      # mutating specs, single worker
npx playwright test e2e/specs/catalogue.ltr.spec.ts                      # one file while iterating
```

```bash
# Git Bash / WSL / macOS / Linux
cd apps/universal
EXPO_PUBLIC_API_URL=http://localhost:8080 APP_MODE=all-dev npx expo export -p web --output-dir dist-api --clear
npx playwright test --project=web-ltr --project=web-rtl --project=a11y
npx playwright test --project=web-write --workers=1
```

Set `E2E_RESET_DB=1` on the playwright invocation to `migrate:fresh --seed` first (the global
setup refuses unless `apps/api/.env` says `APP_ENV=local|testing`).

The former standalone acceptance suite is folded into the write specs above (`*.write.spec.ts`
under `e2e/specs/` — registration, devices, workspace incl. the seeded 2FA account, commerce);
`pnpm run e2e:write` is its successor and there is no separate `e2e:acceptance` config.

Visual regression (Docker required; run from **PowerShell at the repo root** — see 5.7):

```bash
pnpm -w run e2e:visual            # compare against the 38 committed baselines
pnpm -w run e2e:visual:update     # re-capture baselines (only after intentional UI changes)
```

Export budget check: `cd apps/universal && pnpm run budget:export`.

### 5.6 Reset / day-to-day

```bash
docker compose up -d --wait        # daily start (setup is one-time)
./scripts/reset.ps1                # DESTROYS all local data and rebuilds everything
```

### 5.7 Troubleshooting (all learned the hard way)

| Symptom | Cause and fix |
| --- | --- |
| Postgres port conflict | A native PostgreSQL service owns 5432; the stack deliberately publishes on **55432**. Never "fix" this back. |
| App behaves like the wrong data mode | Metro cached the inlined env. Re-run any `expo start`/`export` **with `--clear`**. |
| Queue/api container crash-loops after host `composer install` | Host vendor contains Windows junctions Linux can't resolve. Run `docker compose exec -T api composer install`, then `docker compose restart queue nginx`. |
| Docker engine won't start from a script | `com.docker.service` needs an elevated (UAC) first start — launch Docker Desktop interactively once. |
| `e2e:visual` fails with a mangled `C:\c\...` path | Don't run the visual scripts from Git Bash with `MSYS_NO_PATHCONV`; use PowerShell at the repo root: `pnpm -w run e2e:visual`. |
| Visual tests "skipped" locally | By design (D-031): baselines are only valid from the pinned Linux container; the scripts above run it for you. |
| Acceptance devices tests fail on the first run after a fresh reseed | Observed once; passed on re-run and in isolation — consistent with login throttling across rapid same-account sign-ins. Re-run before investigating. |
| Migrations fail with permission errors | You ran them as the runtime role. Always migrate via the migrator connection: `php artisan migrate --database=pgsql_migrations`. |
| `VAR=value command` → "not recognized as the name of a cmdlet" | That is bash syntax and you are in PowerShell. Use the PowerShell variants above: `$env:VAR='value'; command`. |
| `corepack enable` → `EPERM ... C:\Program Files\nodejs\pnpx` | Needs an elevated shell — but if `pnpm --version` already works you don't need corepack at all. |

---

## 6. Still deferred (honest absences)

These stay out of the primary product path until their modules graduate. Nav hides or labels them
`planned`; API-mode screens must not invent behaviour.

| Surface | Why deferred |
| --- | --- |
| Planner / MealPlanning (N1) | No meal-plan backend; consumption tracking OQ-017 |
| Nutrition targets as authoritative clinical data | Engine is prototype-labelled; N1 owns a real source |
| Virtual Dietitian | No VD session API |
| Dietitian public directory | Marketplace dietitians stay `planned` |
| Clinical / patient intake | CL1 not started |
| Partner supply commitments / schedule | B9 — no supplier resource; API mode shows deferred empty |
| Quotation PDF / document export | B8 — status only in v1 |
| Full purchase-order UI | O2 receipts-only |
| Production task UI | O5 |
| Live card PSP | Sandbox/COD only |
| SMS / WhatsApp OTP production provider | Log drivers only (A-011) |
| Malware scan for new KYC uploads | OQ-035 still open |

---

## 7. Where to read more

- `docs/architecture/00-executive-summary.md` — start here for architecture.
- `docs/architecture/adr/` — the twelve ADRs (RLS, tenancy, auth, spec-first API, ...).
- `docs/requirements/foundation-completion-report.md` — Prompt 1 (Phase 1 foundation) completion report.
- `docs/requirements/prompt2-completion-report.md` — Prompt 2, all fourteen mandated sections.
- `docs/reference-research/` — the research corpus (00 scope → 17 recommendations).
- `docs/api/proposed/` — the draft contracts the backend phase would implement.
- `docs/registers/` — decisions (D-001–086), open questions, risks, assumptions.
- `apps/universal/e2e/acceptance/` — real-API Playwright acceptance (after `build:web:api`).
