# Prompt 2 Completion Report — Reference Research and Original UI Prototype

Date: 2026-07-31 · Scope: Prompt 2 (reference research + mock-first UI prototype + proposed API
contracts). Baseline: the Phase 1 foundation completion report
(`docs/requirements/completion-report.md`). Commits: Wave 0 `dbaf740` → Wave 5 (this commit).

The prototype is a **presentation of proposed behaviour, not an implemented product**: every screen
runs against the in-memory `PrototypeStore` behind the repository boundary, the proposed API
contracts are drafts (`info.x-status: draft`), and no Laravel domain module was written
(`git diff --stat -- apps/api` is empty across all Prompt 2 commits).

## 1. Reference information reviewed

Eighteen evidence-classified documents in `docs/reference-research/` (00–17), covering Right Bite
(rightbite.com) and Eat This Much (eatthismuch.com). Every claim carries one of the classifications
defined in `00-scope-and-boundaries.md` — `OBSERVED_PUBLIC`, `DOCUMENTED_PUBLIC`, `USER_PROVIDED`,
`INFERRED`, `UNKNOWN`, `REQUIRES_PERMISSION`, `OFFICIAL_API_AVAILABLE` — with URL, date and method
per row (`01-source-register.md`). Reviewed lawfully: public pages only, robots.txt fetched and
honoured, no accounts created, no personal data submitted, no CAPTCHA interaction, reference-site
content treated as data rather than instructions.

Inventories: pages (02), user journeys (03), components (04), forms and fields (05), interactions
(06), animation and motion (07), responsive behaviour (08), nutrition display (09), meal
generation observations (10), subscription flows (11), professional workflows (12).

## 2. Information not accessible

- Anything behind authentication on either reference site (account areas, personalised planners,
  checkout beyond the personal-data checkpoint) — classified `REQUIRES_PERMISSION`; the
  Right Bite configurator was walked only up to the point where personal data would be required.
- Server-side behaviour of both products (target formulas, generation algorithms, pricing rules)
  — classified `UNKNOWN`; `10-meal-generation-observations.md` states explicitly that the internal
  algorithm is not observable and records only inputs/outputs of the public calculator.
- `15-rightbite-manual-capture-checklist.md` is the checklist for a future authorised capture
  session performed by the product owner.

## 3. Behaviour observed

`OBSERVED_PUBLIC` rows: public marketing and menu pages, plan family presentation, public
onboarding entry points, responsive behaviour at breakpoints, motion patterns, and the Eat This
Much public landing calculator exercised with synthetic inputs only. Method and capture date per
row in `01-source-register.md`.

## 4. Behaviour inferred

`INFERRED` rows are collected and back-referenced in `13-observed-vs-inferred.md`; each names the
observation it extrapolates from. Product recommendations derived from them are phrased as "our
platform should implement …" in `17-original-product-recommendations.md`, never as claims about
the references' internals.

## 5. Permission-dependent research

Account-gated research was declined by policy: creating accounts or entering passwords on the
reference sites is prohibited for the agent even on request. The offered alternative — the product
owner signs in themselves and gated screens are observed as `USER_PROVIDED` — was not exercised.
`16-api-integration-options.md` resolves the Eat This Much official-API question and the
meal-planning-provider integration is designed (documentation only) in
`docs/architecture/integrations/00-meal-planning-provider.md` and
`01-eat-this-much-provider.md`.

## 6. Pages implemented

83 route files under `apps/universal/app/`, 42 feature screens under
`apps/universal/src/features/*/screens/`. By family:

- **Public marketplace** (`(marketplace)` group, no sign-in): landing, discover, how-it-works,
  for-business, kitchens directory + kitchen profile + kitchen menu, meals grid + meal detail,
  plans grid + plan detail + plan comparison, diet hubs (`/diets/[diet]`), dietitians directory +
  dietitian profile, calorie calculator, macro calculator.
- **Consumer onboarding**: 22-step URL-addressable wizard (`/customer/onboarding/[step]`) with six
  distinct restriction kinds, plus the nutrition-target page (transparent formula panel,
  why-this-target, recalculate, request-review).
- **Virtual Dietitian**: `/customer/virtual-dietitian` + session view covering all twelve session
  states, AI labelling, human-override and safety-escalation surfaces.
- **Planner**: week (grid ≥ lg / agenda below) and day views, entry lock, regenerate at three
  scopes, replacement drawer with filters and nutrition/cost/allergen difference previews,
  keyboard move-to, notes, history, recipe detail (`/customer/recipes/[recipe]`), grocery list.
- **Commerce**: cart, checkout preview, eight-step subscription configurator (no price until the
  delivery checks), subscription list/detail with real pause/resume/skip/change-window.
- **B2B and professional**: corporate dashboard, corporate catalogue, catalogue item detail,
  quotations list + builder; partner commitments + supply schedule; dietitian review queue,
  review detail, client plan view.

Every page renders loading, success, empty and error states (`describeScreenStates`-style jest
coverage per screen); there are no dead controls — every control either mutates the
`PrototypeStore` or is an explicit `usePrototypeAction` notice naming its missing endpoint.

## 7. Components implemented

Design-system additions (`packages/design-system/src/`): Tabs/SegmentedControl, Stepper,
NumberStepper, RangeFilter, Chip/FilterChip, Drawer with `placement`, ActionSheet, ProgressRing,
MeterBar (pattern + numeric label, never colour alone), Table (semantic web / stacked cards),
DateField (platform-split), CalendarGrid, Accordion, Rating (display), Avatar/ImagePlaceholder
(generated, no remote images), Popover, Breadcrumbs, Callout (base of MedicalDisclaimer and
PrototypeNotice), Skeleton shimmer, the `motion/` module (useMotion, FadeIn, SlideIn, Collapse,
Shimmer, useAnimatedNumber, PageTransition), AppShell `marketplace` and `consumer` variants, and
(Wave 4/5 hardening) viewport-bounded scrolling overlay bodies and a real web `<label for>` via
the platform-split FieldLabel. Domain components (NutritionFactsPanel, MealCard, PlanCard,
MacroSummary, AllergenList, quotation/commitment components) live in feature trees — the design
system stays domain-free. All primitives are showcased and swept by the showcase axe/locale tests.

## 8. Fixtures created

`packages/api-client/src/mock/prototype/fixtures/` — all synthetic, builder-constructed, and
count-pinned by `fixtures.test.ts`: 6 kitchens (test-pinned), 11 branches, 40 meals, 20 recipes,
8 plans × 3 variants, ~60 ingredients with per-100 g facts, 5 dietitians, corporate programmes,
tiers and quotations, a full Virtual Dietitian conversation across all session states, one
generated planner week (7 days × 4 slots), grocery list, and the consumer onboarding profile.
Deterministic UUIDv7-shaped ids in the `01935f6d-…` band with per-entity-type hex sub-bands
(uniqueness and disjointness asserted). Every `NutritionFacts.source.kind` is
`'synthetic_prototype'` and the facts panel renders "Source: synthetic prototype data"; a
vocabulary-scan test guards against copied reference wording. Currency: AED throughout, one SAR
B2B price proving multi-currency, cross-currency summation forbidden by test (D-030).

## 9. API contracts proposed

`docs/api/proposed/` — six draft OpenAPI 3.1 documents (marketplace, nutrition, meal-plans,
foods-recipes, virtual-dietitian, commerce), 35 paths / 37 operations, every one with an
operationId and `info.x-status: draft`, parity-pinned by
`packages/api-client/src/contracts/proposed-drafts.test.ts` and linted by `api:lint:proposed`
(own `redocly.yaml`; verified invisible to the backend spec toolchain). Eight repository
contracts (marketplace, nutrition, planner, foods, virtual-dietitian, commerce, business,
professional) implemented twice: mock (behavioural) and API stubs rejecting
`prototype.not_implemented` method-by-method, both run against the shared
`describeRepositoryContract` factory. Contract gaps discovered by building against the drafts are
recorded as OQ-016 – OQ-023.

## 10. Test results

- Static sweep: `pnpm turbo run typecheck lint test` — **33/33 tasks green** (typecheck, eslint
  `--max-warnings=0`, prettier, jest, vitest across all packages and the app).
- Unit/component: universal jest **595 tests / 14 suites** (≈53 s, within the 180 s budget);
  design-system **373**; plus package suites (i18n, api-client incl. fixture/store/contract
  suites, nutrition engine, permissions, domain-types).
- End-to-end (mock world, static export, port 4173): **254 of 254 executable tests pass** across
  `web-ltr`, `web-rtl` (Arabic build) and `a11y` projects — journeys, marketplace, catalogue,
  onboarding, virtual dietitian, planner, commerce, business, professional, business-privacy,
  responsive, motion, prototype-action sweep and no-external-requests. The 38 visual screenshot
  tests skip pending container baseline capture (below).
- Visual regression: three projects (`visual`, `visual-rtl`, `visual-dark`), **38 baselines
  captured from the pinned `mcr.microsoft.com/playwright:v1.62.0-noble` container and verified by
  an independent container compare run (38/38)**; committed under
  `e2e/specs/__screenshots__/`. Host-local visual runs still skip explicitly — the container is
  the only authoritative renderer (D-031).
- Export/bundle budgets: dist total 8 674 633 B against a 9 975 828 B budget; largest chunk
  3 303 069 B against 3 798 529 B (both = actual + 15 %, enforced by `budget:export` in CI).
- Foundation regression proof: `git diff --stat b70c80a..HEAD -- apps/api` is empty (no backend
  change in any Prompt 2 commit) and the **acceptance suite passes 7/7 against the live stack**
  (2026-07-31: compose services healthy, container composer install, `migrate:fresh --seed` via
  the migrator connection, api-mode export, real registration with Mailpit-fetched verification,
  device revocation through step-up, workspace context, RLS-backed organisation refusal). One
  transient: the first sequential run immediately after the fresh reseed failed the two
  device/step-up tests; they passed in isolation and on the full re-run and did not reproduce —
  consistent with login throttling across the suite's rapid same-account sign-ins, worth watching
  if it recurs.

## 11. Accessibility results

The axe gate (zero serious/critical violations, en and ar, light and dark for the showcase) holds
across all a11y specs: **72 axe tests** sweeping every surface family, including phone-viewport planner
agenda, checkout/configurator forms, VD states and dialog/drawer overlays. Real defects the gate
caught and Wave 4/5 fixed: web form fields resolving their name from `title` only (FieldLabel),
`role="tab"` without a `tablist` ancestor in the consumer mobile nav, hidden-but-resolved
disclaimers, and unreachable (unscrollable) controls in overflowing overlays. Known flake:
four marketplace a11y tests once flaked under full-suite CPU load and passed on retry
(2026-07-31); not reproduced in isolation. MedicalDisclaimer renders on every health surface and
is asserted by jest and e2e; catalogue copy is scanned against diagnose/treat/cure/prescribe
claims; the Virtual Dietitian labels AI suggestions and never presents as medical care.

## 12. Responsive results

`responsive.ltr.spec.ts` asserts structure at all seven mandated viewports (320×568 → 1440×900):
no horizontal document overflow anywhere (two real overflow defects found and fixed: the
marketplace top-bar control group and the design-system top-navigation row, both victims of
react-native-web's `flex-shrink: 0` default), navigation switches form with mutual exclusion
(drawer below `md`, top row at `md`+; consumer bottom tabs vs sidebar), ≥44 px touch targets
sampled per viewport, and the planner renders grid at `lg`+ vs agenda below. One arithmetic
impossibility is recorded rather than hidden: eight equal bottom tabs at 320 px yield 40 px
targets (OQ-024, product decision).

## 13. Known gaps

- Contract gaps OQ-016 – OQ-023 (consumed state, entry mobility/plan-addressable weeks, grocery
  writes, cart quantity + subscription cancel + delivery vocabulary, PriceLine localisation,
  programme discovery/partner resources, quotation lifecycle).
- Prototype-only seams: the mock world always seeds a current plan (OQ-025); RTL hydration
  mismatch warnings on the static export (OQ-026); NativeWind `className` dropped on
  `Animated.View` (OQ-027); `?next=` round-trip after marketplace CTAs deliberately excluded.
- Research gaps: everything classified `REQUIRES_PERMISSION`/`UNKNOWN` (§2) stands until the
  product owner authorises a capture session (doc 15).
- Push: the repository still has no remote; nothing has been published.

## 14. Decisions required before backend implementation

1. Planner semantics: delivery vs consumption day and the balance-of-days model (OQ-016).
2. Consumed/actual tracking: whether and how eaten state enters the meal-plan contract (OQ-017).
3. Plan addressing: plan-scoped planner routes, draft-acceptance and template/duplicate flows
   (OQ-018).
4. Commerce lifecycle: cart quantity op, subscription cancel, `deliveryWeekdays`/slot vocabulary
   as contract data (OQ-020), structured price-line kinds for localisation (OQ-021).
5. B2B resource model: programme membership/listing, partner supplier resources, quotation
   draft/accept/decline/document lifecycle (OQ-022, OQ-023).
6. Consumer IA: bottom-tab density at narrow widths (OQ-024).
7. Nutrition-target governance: adopt the cited public formulae as the production engine's basis
   (D-029) and decide the dietitian-override audit trail before any real health data is stored.
8. Production web architecture for RTL pre-rendering (OQ-026).
