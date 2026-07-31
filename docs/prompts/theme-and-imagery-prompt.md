# Healthy360 — Visual theme + realistic imagery pass

You are working in C:\dev\Healthy360 (Windows; PowerShell env syntax `$env:VAR='x'`; never bash
`VAR=x` prefixes). Read `docs/project-guide.md` first — it explains the whole project, the mock-
first prototype, every test gate, and the troubleshooting table. Current baseline: commit
`bbd8d6b`, all gates green (turbo 33/33, Playwright 254/254 + 38/38 visual, jest 595).

## Goal

Make the prototype FEEL like a real premium healthy-food product: a full visual theme in the
genre of Gulf healthy-meal-delivery brands (fresh, appetising, warm), and real photography in
every image slot — meals, recipes, kitchens, plans, dietitians, diet hubs, landing/marketing
sections — so a stakeholder browsing the mock-mode app experiences the intended reality.

## Part A — Theme (through the token pipeline only)

1. Design an ORIGINAL palette inspired by the healthy-food-delivery category (leafy green
   primary, warm appetising accent, calm neutrals — your judgment). HARD RULE: do not copy
   brand values from rightbite.com or any competitor — no lifted hex codes, no lookalike logo,
   no brand names anywhere in code or assets (a vocabulary-scan test enforces this).
2. Implement it in `packages/design-tokens` (both LIGHT and DARK themes), then
   `pnpm run build:tokens`. Never scatter raw hex values in components.
3. Accessibility is a hard gate, not a preference: body text ≥4.5:1, large text and UI
   components ≥3:1 against their backgrounds in BOTH themes. The a11y Playwright project
   (zero serious/critical axe violations, includes color-contrast) must stay green.
4. Nutrition meters/rings must keep their pattern + numeric-label redundancy — colour alone
   never carries meaning.
5. Optional polish through tokens only: type scale, radii, elevation. Do not restructure
   components.

## Part B — Imagery (bundled locally, licensed, attributed)

1. Source ONLY license-safe photography: Unsplash, Pexels, Pixabay. Tip: both Unsplash and
   Pexels serve pre-sized files via URL params (e.g. `?w=1280&q=80&fm=webp` on
   images.unsplash.com), so you can download correctly-sized WebP directly with curl — no
   image-processing dependency needed (adding npm packages is forbidden).
2. NEVER hotlink. The `no-external-requests.ltr.spec.ts` gate fails the suite on any request
   to a non-localhost origin — by design. Download every file into
   `apps/universal/assets/images/<family>/…` and serve from the bundle.
3. Coverage (fixture IDs live in `packages/api-client/src/mock/prototype/fixtures/`):
   - 40 meals + reuse sensibly across the 20 recipes (dish close-ups, varied cuisines
     matching each meal's name/diet tags — a "grilled salmon" fixture must not show pasta)
   - 6 kitchens (brand-neutral kitchen/restaurant interiors)
   - 8 plans (lifestyle / food-spread imagery per plan positioning)
   - 5 dietitians (professional portraits; respect fixture gender/name plausibility)
   - diet hub headers, landing hero, discover categories, how-it-works steps, for-business
     and corporate sections
4. Sizes: card ~640w and detail/hero ~1280w variants, WebP, target ≤120 KB each. Create a
   generated manifest module (fixture ID → `require()`d asset, so it works on web AND native)
   with the existing generated-placeholder as fallback for any unmapped entity. Wire it into
   the image slots (MealCard, PlanCard, kitchen/dietitian cards, detail screens) without
   breaking their testIDs.
5. Attribution: write `apps/universal/assets/images/CREDITS.md` — one row per file: asset
   path, source URL, photographer, license. Honesty stays: fixtures remain labelled synthetic;
   the photos are illustrative stock, not real products.

## Part C — Gates (run ALL, fix what breaks, report honestly)

1. `pnpm run check` (33 turbo tasks) · `pnpm run format:check` · `pnpm run i18n:check`.
2. Fresh export + full e2e:
   `cd apps/universal; $env:EXPO_PUBLIC_DATA_MODE='mock'; $env:APP_MODE='all-dev'; npx expo export -p web --clear`
   then `npx playwright test` — 254 must pass, especially a11y (contrast) and
   no-external-requests (proves bundling).
3. The export budget WILL exceed its ceiling (images add megabytes). Re-baseline it
   deliberately in `apps/universal/scripts/check-export-budget.mjs`: new measured actual
   + 15 %, with a comment explaining the imagery pass. Do not silently delete the check.
4. Re-capture ALL 38 visual baselines (theme+images change every pixel) — Docker Desktop must
   be running; from PowerShell at the REPO ROOT: `pnpm -w run e2e:visual:update`, then verify
   with `pnpm -w run e2e:visual` (38/38).
5. Registers: add a decisions-register entry (original palette policy + local-only licensed
   imagery) and note the budget re-baseline. Commit in logical steps with clear messages.

## Boundaries

No changes under `apps/api/` (must stay byte-identical). No new npm dependencies. No copied
competitor text/palette/photos/names. Do not weaken or delete any existing test; if a visual
change legitimately breaks an assertion (e.g. a placeholder test), update it honestly and say
so in your report. Finish with a summary: palette rationale, image count + total bytes per
family, budget before/after, gate results, and every file touched.
