# Decisions Register

Product and architecture decisions with dates. Architectural decisions with lasting consequences also have ADRs (`docs/architecture/adr/`). All decisions below were confirmed on adoption of the revised plan unless otherwise dated.

| ID | Date | Decision | Detail / reference |
|---|---|---|---|
| D-001 | 2026-07-30 | Revised plan supersedes the earlier agent-drafted plan | User-issued revision adopted verbatim as execution baseline; recorded as CR-001 in the change-request register |
| D-002 | 2026-07-30 | Product name: **Healthy360** | Plan §2 |
| D-003 | 2026-07-30 | Identifiers: PHP namespace `Healthy360\`, npm scope `@healthy360/*`, bundle IDs `com.healthy360.*` | Plan §2 |
| D-004 | 2026-07-30 | Launch markets: Lebanon, UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman, Jordan, Egypt | All ISO countries seeded; only launch set marked active (Plan §2) |
| D-005 | 2026-07-30 | Initial languages: English and Arabic (full RTL) | French and others capable of later addition (Source §6; Plan §2) |
| D-006 | 2026-07-30 | Laravel modular monolith; microservices prohibited this phase | ADR-0001 |
| D-007 | 2026-07-30 | Shared PostgreSQL database with organisation isolation | ADR-0002 |
| D-008 | 2026-07-30 | Global user identity with organisation memberships | ADR-0003 |
| D-009 | 2026-07-30 | One universal Expo codebase (web, iOS, Android); build families; role areas | ADR-0004 |
| D-010 | 2026-07-30 | OpenAPI 3.1 spec-first; single generated TypeScript client via wrapped hey-api | ADR-0005 |
| D-011 | 2026-07-30 | Custom membership RBAC; spatie/laravel-permission rejected; allow-only in Phase 1 | ADR-0006 |
| D-012 | 2026-07-30 | Incremental RLS: app scoping first, six representative tables, three DB roles, no BYPASSRLS app role | ADR-0007 |
| D-013 | 2026-07-30 | PHP 8.4 + Pest 5 ("PHP 8.3 or later" mandate satisfied by 8.4) | ADR-0008 |
| D-014 | 2026-07-30 | Node 24 LTS + Expo SDK 57 + TypeScript 6; TS 7 explicitly not adopted | ADR-0009 |
| D-015 | 2026-07-30 | Laravel filesystem abstraction over any S3-compatible store; Garage v2 for local dev (MinIO community archived) | ADR-0010 |
| D-016 | 2026-07-30 | Frontend repository boundary; mock mode impossible in production (4 gates) | ADR-0011 |
| D-017 | 2026-07-30 | Offline persistence restricted to non-sensitive reference data | ADR-0012 |
| D-018 | 2026-07-30 | Adopt the generated Laravel 13.23 app into `apps/api/`; do not regenerate | Plan §5; Phase 0 complete |
| D-019 | 2026-07-30 | Retain Fortify, convert to JSON responses under `/api/v1/auth/*`; remove Inertia frontend and starter-kit web assets | Plan §5, §13 |
| D-020 | 2026-07-30 | Step-up authentication returns HTTP 403 with `auth.step_up_required` (not 423) | Plan §13; `docs/api/conventions.md` |
| D-021 | 2026-07-30 | Passkeys may remain disabled in the UI even where Fortify installs supporting dependencies | Plan §13; enablement is OQ-004 |
| D-022 | 2026-07-30 | InterNACHI Modular adopted only after the compatibility spike passes; fallback is `app/Modules/` namespaces | Plan §6 |
| D-023 | 2026-07-30 | UUIDv7 primary keys, application-generated via central identifier service; ISO codes for stable reference data | Plan §8 |
| D-024 | 2026-07-30 | Dependency versions governed by one compatibility matrix, lockfiles and controlled ranges — no per-patch ADRs | Plan §3; `docs/architecture/dependency-compatibility.md` |
| D-025 | 2026-07-30 | No audit-log partitioning until volume/retention confirmed | Plan §12; risk R-007 |
| D-026 | 2026-07-30 | Latin digits as configurable default for clinical/financial numerals in Arabic locales | Provisional product default pending management sign-off (A-002, OQ-001) |
| D-027 | 2026-07-30 | Prompt 2 prototype IA folds into the existing `public` and `customer` route areas; no new RouteArea values, no permission-kernel changes | Plan §1; new `(marketplace)` route group under `public`; B2B/professional surfaces reuse the existing `corporate`/`partner`/`dietitian` areas |
| D-028 | 2026-07-30 | One no-dead-controls mechanism: `usePrototypeAction` (honest "nothing was changed" notice + dev-only contract line) reserved for genuinely absent capabilities; everything the mock world supports mutates the `PrototypeStore` for real | Plan §5; `apps/universal/src/prototype/prototype-action.ts`; enforced by the prototype-action e2e sweep |
| D-029 | 2026-07-30 | Nutrition targets computed only from cited public formulae (Mifflin–St Jeor, Katch–McArdle when body fat is present, FAO/WHO/UNU activity multipliers, IoM AMDR bands); every engine result carries `prototype: true`; no competitor formula claimed or reverse-engineered | `packages/nutrition` MockNutritionTargetEngine; reference-research boundary (docs/reference-research) |
| D-030 | 2026-07-30 | Fixture currency policy: AED default across all consumer fixtures; exactly one SAR B2B price proves multi-currency handling; cross-currency summation is forbidden and test-pinned | `mock/prototype/fixtures`; asserted in business feature tests |
| D-031 | 2026-07-31 | Visual-regression baselines are authoritative only from the pinned `mcr.microsoft.com/playwright:v1.62.0-noble` container; host-local visual runs skip with an explicit message | Wave 5B; `e2e:visual` root scripts; frontend.yml visual job |
| D-032 | 2026-07-30 | Query persistence limited to `reference` and `catalogue` roots; planner, nutrition, VD, commerce and business data stay memory-only in the prototype | `PERSISTABLE_QUERY_ROOTS`, pinned by test (plan §21) |
| D-033 | 2026-07-31 | Quotation submission is a real store mutation, not a prototype notice: `PrototypeStore.requestQuotation` validates minimums and files a real `submitted` quotation, so an honest notice would be a lie | Wave 5A applying D-028's own rule; draft persistence, accept/decline and document export remain notices (OQ-023) |
| D-034 | 2026-07-31 | Original brand palette — fresh leafy-green primary, warm-terracotta accent, warm-greige neutrals — designed for this product and not derived from any reference brand; both light and dark themes flow through the `@healthy360/design-tokens` pipeline only (no raw hex in components), and every foreground/background pair is contrast-gated at WCAG AA (body text ≥4.5:1; UI, focus rings and nutrition fills ≥3:1) in both themes | Visual-theme pass; `packages/design-tokens/src/colour.ts`, enforced by `colour.test.ts`; nutrition meters keep pattern + numeric-label redundancy so colour is never the sole carrier of meaning |
| D-035 | 2026-07-31 | Prototype imagery is bundled, same-origin, licence-safe stock photography (Unsplash Free License), never hotlinked: a matched photo per dish/kitchen/plan/dietitian/diet-hub and per landing/discover/how-it-works/for-business slot, resolved from a generated manifest (`build:images`, keyed by the fixture `imagePlaceholderId`) with the generated pattern placeholder as fallback; 40 meals reuse 20 dish photos. Fixtures stay labelled synthetic — the photos are illustrative, not photographs of real Healthy360 products — with per-file attribution in `apps/universal/assets/images/CREDITS.md`. The export byte budget was re-baselined (+15% headroom) for the added imagery | Visual-theme pass; enforced by the `no-external-requests` e2e gate and `apps/universal/scripts/check-export-budget.mjs` |
