# Healthy360 — working notes

Monorepo. `apps/universal` is the product (Expo SDK 57, NativeWind 4, Tailwind 3.4, expo-router);
`apps/api` is the backend; everything shared lives in `packages/*`.

```
pnpm check          lint + typecheck + test (run before calling anything done)
pnpm build:tokens   regenerate the token preset after editing packages/design-tokens
pnpm gen:i18n-keys  regenerate keys.generated.ts after adding catalogue strings
pnpm i18n:check     assert en / ar / en-XA catalogues agree
```

---

## The active design is HealthZone

`HealthZone.dc.html` (repo root) is the current design direction and the source of truth for
anything visual. When a request says "implement the navbar", "build the cart", "redo the KDS
screen" with no other qualifier, it means **from HealthZone**. Do not ask which design.

`design_handoff_wellness_green/` is the **previous** direction — mint/emerald/violet, Inter +
Space Grotesk. It is superseded. Read it for its component and composition rules, which still
hold (§2 and §4 of its README are good), but **not** for colour or type. Where the two disagree
on a value, HealthZone wins.

**The whole product moves to HealthZone.** This is a full retheme, not a per-screen exception.

### Opening it

It is a Claude Design canvas file. It needs `support.js` and `image-slot.js` as siblings — both
are already in the repo root. Open it directly in a browser. Photos will be blank unless
`.image-slots.state.json` is present; that file lives in the design project, not the repo.

Source project: `https://claude.ai/design/p/1bbd0ef2-d072-4d81-9f44-281eb7e73a46`
Read it with the `DesignSync` tool (`/design-login` first if it 401s).

### It is a reference, never production code

The same rule the wellness-green handoff states, and it still applies: **do not copy HTML,
inline styles or hex literals out of the design file into the app.** Recreate each screen in
React Native + NativeWind using `@healthy360/design-system` components and the generated token
preset. Reach for a token before a literal, every time.

---

## Naming a screen

Each screen is a self-contained `<sc-if>` branch keyed by an id. Naming the id is the
unambiguous way to point at one.

| id | Design screen | Implement in |
| --- | --- | --- |
| `home` | Customer landing | `marketplace/screens/consumer-home-screen.tsx` |
| `catalog` | Menu / browse grid | `catalogue/screens/meals-screen.tsx` |
| `meal` | Meal detail | `catalogue/screens/meal-detail-screen.tsx` |
| `cart` | Basket | `commerce/screens/cart-screen.tsx` |
| `checkout` | Checkout | `commerce/screens/checkout-screen.tsx` |
| `track` | Order tracking | `guest/screens/guest-order-screen.tsx` — confirm target |
| `account` | Account | `account/screens/account-screen.tsx` |
| `mobile` | Narrow-viewport customer | responsive pass, not a separate file |
| `discover` | Discover | `marketplace/screens/discover-screen.tsx` |
| `storefront` | Kitchen storefront | `marketplace/screens/kitchen-profile-screen.tsx`, `kitchen-menu-screen.tsx` |
| `plans` | Weekly plans | `catalogue/screens/plans-screen.tsx` |
| `guest` | Guest checkout | `guest/screens/guest-checkout-screen.tsx` |
| `dash` | Operations today | `kitchen-admin/screens/kitchen-home-screen.tsx` |
| `orders` | Orders | `kitchen-admin/screens/orders-screen.tsx` |
| `kitchen` | Kitchen board | `kitchen-admin/screens/production-screen.tsx` |
| `kds` | Kitchen display | `kds/kds-tickets-screen.tsx` |
| `desk` | Order desk | `kitchen-admin/screens/order-desk-screen.tsx` (+ `-sale`, `-cash-report`, `-calendar`) |
| `catmgr` | Catalogue manager | `kitchen-admin/screens/meals-screen.tsx`, `products-screen.tsx`, `plans-screen.tsx` |
| `inventory` | Inventory & stock | `kitchen-admin/screens/stock-screen.tsx`, `ingredients-screen.tsx` |
| `adminmeals` | Meals & recipes | `kitchen-admin/screens/meals-screen.tsx`, `recipes-screen.tsx` |
| `production` | Production plan | `kitchen-admin/screens/production-screen.tsx` |
| `quotes` | Quotations | `kitchen-admin/screens/quotations-screen.tsx`, `business/screens/quotations-screen.tsx` |
| `corp` | Corporate programmes | `business/screens/corporate-dashboard-screen.tsx`, `corporate-catalogue-screen.tsx` |
| `costs` | Cost report | `kitchen-admin/screens/cost-report-screen.tsx` |

The design also titles `recipes`, `qc`, `suppliers`, `procure`, `stock`, `pricelists`, `zones`
and `branch` but renders them through a generic fallback rather than drawing them. Their real
screens all exist under `kitchen-admin/screens/`; they inherit the retheme and need no bespoke
design.

## Naming the chrome

| Say | Means | Implement in |
| --- | --- | --- |
| customer header / navbar | Logo, Menu/Kitchens/Weekly plans/Offers, search, account, cart pill | `shell/marketplace-shell.tsx`, `consumer-shell.tsx` |
| admin sidebar | 224px `#17231A` rail, grouped nav with counts, service-status footer | `shell/area-shell.tsx`, `kitchen-admin/kitchen-ops-shell.tsx` |
| admin topbar | Page title + timestamp, search, Export, user block | same shells |

> **Trap — the black bar at the top of the design is not product chrome.** The
> `HEALTHZONE / PROTOTYPE` rail with the customer/admin screen buttons is the canvas's own screen
> switcher. It exists so the prototype is navigable in one file. Never implement it. The real
> customer header starts below it; the theme toggle in its right corner is already built at
> `shell/theme-toggle.tsx`.

---

## Retheme mapping

HealthZone is warm off-white and lime, not mint and emerald. Type is **Schibsted Grotesk**
throughout — body *and* display — with **IBM Plex Mono** for numerics, micro-labels and
uppercase eyebrow text.

Token architecture is unchanged: ramps and `ThemeColours` roles in
`packages/design-tokens/src/colour.ts`, families in `typography.ts`, emitted to
`generated/{tailwind-preset.cjs,tokens.css,tokens.native.ts}` by `pnpm build:tokens`.
`colour.test.ts` contrast-tests every background/foreground pair at WCAG AA in both themes and is
the gate on any value below.

The design's CSS variables (`HealthZone.dc.html` lines 18–39) map onto the existing roles:

| Role | Light | Dark | From |
| --- | --- | --- | --- |
| `surfaceBase` | `#f6f4ee` | `#14170f` | `--bg` |
| `surfaceRaised` | `#ffffff` | `#1c201a` | `--card` |
| `surfaceSunken` | `#f1f0ea` | `#171b14` | `--surface3` |
| `textPrimary` | `#171a17` | `#f2f1ea` | `--ink` |
| `textSecondary` | `#5c6159` | `#a9afa1` | `--muted` |
| `textDisabled` | `#8a8f82` | `#8f9584` | `--muted2` |
| `borderSubtle` | `#efede4` | `#242a1f` | `--line-soft` |
| `borderDefault` | `#e3e0d6` | `#2a3024` | `--line` |
| `borderStrong` | `#ddd9cd` | `#39402f` | `--line-strong` |
| `focusRing` | `#171a17` | `#f2f1ea` | `--ink` |
| `brandSurface` | `#cbeb6b` | `#cbeb6b` | lime CTA fill |
| `brandSurfaceSubtle` | `#edf7cf` | `#21301a` | `--ok-bg` |
| `onBrandSurfaceSubtle` | `#3f5c1e` | `#c9e894` | `--ok-fg` |
| `accentSurface` | `#2f6b3a` | `#9bd75c` | `--accent-deep` |
| `surfaceCanopy` | `#1e2a1c` | `#1e2a1c` | hero panel |
| `surfaceCanopyDeep` | `#12140f` | `#12140f` | bar / footer |
| `onCanopy` | `#fbfaf5` | `#fbfaf5` | `--surface2` |
| `onCanopyMuted` | `#c3cbb8` | `#c3cbb8` | hero body copy |

Semantic roles come straight across: `success` ← `--ok-*`, `warning` ← `--warn-*`,
`danger` ← `--bad-*`, `info` ← `--info-*`, each as bg / border / fg.

### Five things that are genuine decisions, not transcription

Resolve these deliberately — do not guess a value into the token file.

1. **`textOnBrand` flips to dark.** HealthZone's primary button is lime `#cbeb6b` carrying
   near-black `#171a17` text, not white. White on lime fails badly. Every call site assuming a
   white-on-brand label needs checking.
2. **`brandSurface` is the same lime in both themes** — the design does not lighten it for dark,
   because dark text on lime already works on either page. Confirm before mirroring the old
   light/dark split.
3. **There is no violet.** HealthZone has no AI accent, so `accentSurface`, `accentSubtle` and
   wellness-green's "violet is AI" rule (its §4 Rule 5) have no successor. The virtual dietitian
   still needs to mark machine turns — decide what carries that before touching
   `virtual-dietitian/`. Its origin labels differ on tone, glyph *and* wording and are asserted
   by test; do not collapse them to colour.
4. **A fourth surface.** The design uses `--surface2` `#fbfaf5`, a warm off-white between card and
   page, for the admin topbar and hero overlay cards. Either add a role or snap it to
   `surfaceRaised`. Pick one and apply it consistently.
5. **`--faint` `#a6aa9e` is not a text colour.** It fails AA on `--bg`. The design uses it for
   placeholders and inert glyphs. Never map it to `textDisabled`.

### Type

`fontFamilies.latin` moves Inter → Schibsted Grotesk (400/500/600/700/800), and
`displayFamilies.latin` moves Space Grotesk → Schibsted Grotesk 700/800. Arabic stays IBM Plex
Sans Arabic — Schibsted Grotesk carries no Arabic glyphs, and the per-script line-height
multiplier (1.5 latin / 1.75 arabic) stays as it is.

**IBM Plex Mono is a new family role.** There is no mono token today. It carries prices, KPI
values, counts, table numerics and the uppercase `.12em` eyebrow labels. Add it rather than
faking it with letter-spacing.

Register both in `apps/universal/app/_layout.tsx` and `apps/universal/package.json`.
`displayLetterSpacing` is already `-0.02em` and is still right.

**Sizes snap to the scale.** The design hand-writes 9.5, 11.5, 12.5, 13.5, 14.5, 19, 21 and 23px.
Those are mood-board artefacts. Snap to the nearest token — `text-xs` 12, `text-sm` 14,
`text-base` 16, `text-xl` 20, `text-2xl` 24. Do not add half-steps to the scale.

---

## Invariants — do not regress these

- **Logical utilities only.** `ms`/`me`, `ps`/`pe`, `start`/`end`, `text-start`/`text-end`.
  Physical utilities and NativeWind's `rtl:`/`ltr:` variants are banned by the root ESLint config.
- **Dark mode is in scope now** and shipped — `hooks/use-theme.ts` and `shell/theme-toggle.tsx`.
  Every new token needs both values. HealthZone specifies a full dark palette; use it.
- **Contrast is a test, not a review note.** `colour.test.ts` fails the build on an AA violation.
- **i18n**: no literal user-facing strings. Add to `packages/i18n/catalogues/{en,ar,en-XA}/` and
  run `pnpm gen:i18n-keys`.
- **44px minimum touch target on the customer surfaces** (`min-touch`). It is no longer a global
  invariant: the kitchen admin is a desk surface driven with a mouse, so the Catalogue sizes from
  `control.ts` (32px default) and `MIN_TOUCH_TARGET` is retired as a token. The `min-h-touch` /
  `min-w-touch` utilities are still emitted — a generator test keeps them alive — and every phone
  surface still uses them. Do not apply them in `kitchen-admin/`, and do not delete them elsewhere
  without a sweep that reasons about the phone.
- **RTL**: assert geometry, not classes. The existing Playwright RTL specs must still pass.
- Documented behaviour survives the redesign: the meals filter panel opens closed **below `lg`**,
  where it is still a disclosure — above `lg` it is a rail beside the grid and there is nothing to
  disclose; `plan-card.tsx` is deliberately not one pressable target; the KDS board has no Cancel;
  both register consents are required; the virtual dietitian's acknowledgement checkbox is a real
  gate.
- **"No slider" is now "no slider on native".** `number-stepper.tsx` rejected a drag rail for three
  reasons — a gesture dependency, a bespoke keyboard implementation, and a 360px hit target. A web
  `<input type="range">` costs none of the three, so `SliderField` is platform-split
  (`forms/slider-field.web.tsx` / `.native.tsx`): a real range input on the web, the stepper on
  native. Do not add a gesture-driven rail to either.
- **`web:` is how a web-only CSS behaviour is expressed** when there is no structural difference to
  branch on. NativeWind registers the variant on the web preset only, so the classes are never
  generated for native. The sticky meals rail is the reference use. A *structural* difference still
  branches in JavaScript on `useBreakpoint` or `Platform.OS`.
- **The web scroll port is not the document.** `body` is `overflow: hidden`; the shell's
  `ScrollView` (`div[data-testid="…-shell-content"]`) is what scrolls. Sticky offsets resolve
  against it, so `top-0` pins just under the top bar — never translate a design's `top:130px`
  literally.

## Sequencing — structure first, colour later

**Current decision: build HealthZone's structure, defer its palette.** Layout, density, sizing,
hierarchy and composition land now; the token retheme in the table above is a later pass.

This works because screens refer to colour *semantically* (`surfaceCanopy`, `brandSurface`,
`textSecondary`), never as hex. Build the admin rail with `surfaceCanopy` and it renders forest
green today; when the palette lands it becomes HealthZone's olive-black with no screen edits.
**So: never reach for a HealthZone hex during this pass.** A literal is what breaks the swap.

Consequences while this holds:

- Type **family** stays Inter / Space Grotesk. Apply HealthZone's sizes, weights and hierarchy —
  snapped to the token scale — but do not add the font dependency yet.
- IBM Plex Mono is deferred. Carry numerics with weight and alignment for now.
- The interim looks mismatched — HealthZone layout, wellness-green palette. Expected.
- The five open colour decisions above stay open. Do not resolve them early.

### The structural layer already exists

The wellness-green handoff's component phase shipped. Use these rather than rebuilding:

| Need | Use |
| --- | --- |
| Grid card with a baseline-pinned footer | `Card` `footer` / `interactive` — `design-system/src/content/card.tsx` |
| 4:3 card media | `aspect="card"` — `content/avatar.tsx` |
| Listing opening — trail, title, count, one trailing control | `apps/universal/src/ui/listing-header.tsx` |
| Page opening with weight — the canopy band (`/kitchens`, `/dietitians`) | `apps/universal/src/ui/page-hero.tsx` |
| Storefront opening — canopy panel beside a photo | `apps/universal/src/ui/storefront-hero.tsx` |
| Account menu / any popover with a button trigger | `Popover` `triggerVariant="button"` `align="end"` |
| One-row filter/sort/count bar | `marketplace/toolbar-row.tsx`, `kitchen-admin/list-toolbar.tsx` |
| Machine-generated content band | `ui/ai-surface.tsx` |

Then: shells → screens. Update `screens/showcase-screen.tsx` in the same commit as any component
change — a component change that has not reached `/showcase` is not done.
