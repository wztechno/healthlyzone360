# 00 — Executive Summary

> Status: Phase 1 architecture baseline. Repository state: Phase 0 complete (Laravel 13 application adopted at `apps/api/`); everything else in this document is planned, with the phase noted inline.

## What Healthy360 is

Healthy360 is a multi-tenant health, nutrition and marketplace platform built as a single Laravel modular monolith (`apps/api/`) with one Expo universal frontend (`apps/universal/`) targeting web, iOS and Android. It launches in English and Arabic (full RTL) across nine markets: Lebanon, the United Arab Emirates, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman, Jordan and Egypt. All ISO countries are seeded as reference data; only approved launch countries are marked active.

| Decision | Value |
| --- | --- |
| Product name | Healthy360 |
| PHP namespace | `Healthy360\` |
| npm scope | `@healthy360/*` |
| Bundle identifiers | `com.healthy360.*` |
| Languages | English, Arabic (full RTL) |
| Architecture | Laravel modular monolith — microservices are prohibited in this phase |
| Database | Shared PostgreSQL platform database with organisation isolation |
| Frontend | One Expo/React Native codebase for web, iOS and Android |

## The ecosystem it serves

The platform is designed around one global user identity participating in many organisations:

- **Consumers and patients** — nutrition, meal and wellness services.
- **Dietitians** — independent practice and clinic employment, simultaneously.
- **Clinics** — patient relationships, professional staff, branches.
- **Kitchens** — meal production across branches.
- **Restaurants** — food service and menus.
- **Fitness and wellness providers** — programmes and services.
- **Suppliers** — B2B supply into kitchens and restaurants.
- **Delivery** — drivers and delivery operations.
- **Corporate wellness** — employer programmes.
- **Insurers** — coverage and claims relationships.
- **Platform administration** — Healthy360's own operators.

In Phase 1 these actors exist as organisation types, capabilities, memberships and role areas — not as implemented business modules.

## Foundation-first strategy

The foundation is built and proven before any business module (Kitchen, Nutrition, Recipes, POS, Inventory, Procurement, Clinical Records, Marketplace, Orders, etc.) is implemented. The architecture is validated by one complete vertical slice:

> Registration or login → email verification → organisation selection → branch selection → permission hydration → authenticated workspace.

The phase is complete only when this workflow operates against the real Laravel API on web **and** native development builds — not against mocks.

Eleven foundation modules are implemented (Support, ReferenceData, Localisation, Identity, Organisations, Tenancy, AccessControl, Features, Consent, Audit, PlatformAdministration — see `02-module-boundaries.md`). Roughly 26 future modules are recorded in a module registry as documentation only: no empty directories, no speculative classes, no premature tables.

## Explicitly deferred

The following are deliberately out of scope and will be designed module by module after the foundation and reference UI prototype are approved:

Kitchen ingredients; allergens; recipes; recipe costing; purchasing; supplier management; inventory; stock valuation; meals; meal plans; nutrition calculations; clinical records; appointments; marketplace catalogues; cart and checkout; B2C ordering; B2B ordering; POS transactions; KDS workflows; production; delivery; payments; commissions; settlements; AI; offline mutations; advanced reporting.

## Definition of done (Phase 1 foundation)

The foundation is complete only when **all** of the following are true:

| Area | Criteria |
| --- | --- |
| Repository & infrastructure | Installs from a clean clone; Docker services start; Laravel boots against PostgreSQL and Redis; migrations and seeders succeed |
| Authentication | A user can register and log in; email-verification behaviour exists; web cookie authentication works; native token authentication works |
| Tenancy & access | A user can select an organisation and branch; `/api/v1/me` returns memberships, context, permissions and entitlements; cross-organisation access tests pass; representative RLS tests pass |
| Contract & frontend | The generated TypeScript client matches OpenAPI; the Expo web application works; a native development build works; English and Arabic layouts work; mock mode cannot enter production |
| Quality & honesty | Required CI checks pass; documentation reflects implementation; deferred functionality is identified honestly |

The foundation must never be declared complete while a mandatory gate is failing.

## Document map

| Document | Contents |
| --- | --- |
| `01-system-context-and-containers.md` | C4 context and containers; modular-monolith decision |
| `02-module-boundaries.md` | The 11 foundation modules, module system, future-module registry rule |
| `03-identity-tenancy-and-access.md` | Global identity, organisation model, tenancy context, RBAC, RLS |
| `04-data-and-api-architecture.md` | Identifiers, foundation tables, API principles, OpenAPI tooling |
| `05`–`09` | Frontend, security/audit, deployment, testing, future roadmap (authored separately) |
| `docs/api/conventions.md` | Wire-level API conventions (authored separately) |
