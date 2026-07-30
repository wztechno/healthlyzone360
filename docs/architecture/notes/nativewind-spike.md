# NativeWind styling spike — verdict

**Status: PASS (conditional).** NativeWind 4.2.6 + Tailwind 3.4.19 is adopted for the Healthy360
design system, subject to the two standing conditions in §5.

| | |
| --- | --- |
| Gate | Plan §19 / `05-universal-frontend.md` §7.2 — NativeWind is *provisional* until it passes an English/Arabic × web/native × light/dark spike |
| Executed | 2026-07-30, execution Phase 5a |
| Subject | `apps/universal/app/index.tsx` (`/` route), `apps/universal/tailwind.config.js`, `@healthy360/design-tokens` generated preset and `tokens.css` |
| Versions | nativewind 4.2.6, tailwindcss 3.4.19, expo 57.0.9, react-native 0.86.2, react-native-web 0.21.2, react 19.2.3 |
| Host | Windows 11, Node 24.11.1, pnpm 11.15.1 |

## 1. What was tested

A single route renders, using tokens from `@healthy360/design-tokens` only:

* semantic colour pairs (subtle / default / strong with their `on*` foregrounds) and the brand ramp;
* both font families — Inter for Latin, IBM Plex Sans Arabic — with per-script line heights;
* the 4-point spacing scale, the radius ramp and all six elevation levels;
* the five-stop nutrition scale with its pattern tokens;
* a direction-sensitive row built from **logical utilities only** (`ps-`, `pe-`, `ms-`, `me-`,
  `border-s-`, `text-start`, `text-end`);
* a light/dark toggle (`colorScheme`) and an English↔Arabic toggle that flips `documentElement`
  `dir`/`lang` live on web.

## 2. Evidence

### (a) Web export builds

```
APP_MODE=all-dev npx expo export -p web
λ Bundled  6359ms node_modules\@expo\router-server\node\render.js (924 modules)
Web Bundled 6805ms node_modules\expo-router\entry.js (897 modules)

› web bundles (2):
_expo/static/css/web-944f09fd9c7b9ec474768b79082e677f.css (21KB)
_expo/static/js/web/entry-52200e7ae46e43158371e2726247009b.js (1.3MB)

› Static routes (3):
/ (index) (40KB)   /_sitemap (18KB)   /+not-found (22KB)

Exported: dist            EXIT=0
```

Total `dist/` 3.7 MB, of which ~2.6 MB is eight `.ttf` files (four weights × two families).

### (b) jest-expo render test

`apps/universal/__tests__/spike-screen.test.tsx` — 9 tests, all passing. It asserts the rendered
tree carries `marginStart: 16`, `marginEnd: 4`, `paddingStart: 12`, `borderStartWidth: 4` and
`textAlign: 'auto'`, and that **no** physical style key (`marginLeft`, `left`, `borderLeftWidth`, …)
appears. A source scan additionally proves no physical Tailwind utility or `rtl:`/`ltr:` variant is
used anywhere on the screen.

### (c) CSS logical properties in the exported stylesheet

`grep` over `dist/_expo/static/css/web-*.css`:

```
margin-inline-start        1
margin-inline-end          1
padding-inline-start       2
padding-inline-end         1
border-inline-start-width  1
text-align:start           1
margin-left                0
margin-right               0
```

(`padding-left`/`padding-right` appear twice each, from symmetric `px-*` utilities, which are
direction-neutral and therefore permitted.)

The 185 `--h360-color-*` custom properties and the `.dark{…}` override block are both present.

### (d) Live browser verification of the exported bundle

The static export was served and driven directly (English/light → Arabic/dark → back).

| Element | Utility | LTR computed | RTL computed |
| --- | --- | --- | --- |
| `section-logical` | `border-s-4 ps-4` | `padding-left: 16px`, `border-left-width: 4px` | `padding-right: 16px`, `border-right-width: 4px` |
| `logical-marker` | `me-3` | `margin-right: 12px` | `margin-left: 12px` |
| `logical-trailing` | `ms-3 text-end` | `margin-left: 12px`, `text-align: end` | `margin-right: 12px`, `text-align: end` |

Switching locale set `<html lang="ar" dir="rtl">` live, re-rendered every string in Arabic, and
resolved `sample-arabic` to `IBMPlexSansArabic_400Regular` while `sample-latin` stayed on
`Inter_400Regular`. Switching theme added `.dark` to the root element, flipped
`--h360-color-surface-base` from `255 255 255` to `23 21 20`, and moved every token-driven colour
with it — including the semantic swatches — while RTL stayed in force. Both toggles are fully
reversible. No console output of any kind was produced.

The pre-hydration script in `app/+html.tsx` set `lang`/`dir` on `<html>` before first paint, from
the `h360_locale` cookie when present and from `navigator.language` otherwise.

## 3. Defects found and fixed during the spike

1. **`@import '@healthy360/design-tokens/tokens.css'` did not resolve.** `postcss-import` uses
   Node's classic resolution and ignores a package's `exports` subpath map, so the import failed and
   the Metro build stalled with no diagnostic. Fixed by importing the generated file by relative
   path in `apps/universal/global.css`.
2. **Metro crawled the whole repository.** `watchFolders = [workspaceRoot]` dragged the crawler
   through `apps/api` (a Laravel tree with its own `vendor/`), turning a bundle into a multi-minute
   filesystem scan on Windows. `metro.config.js` now watches `packages/` and the root
   `node_modules/` only, with a `blockList` for `apps/api`, `infrastructure/` and `.git`.
3. **The web export shipped every font weight.** Importing from the `@expo-google-fonts/*` package
   root pulls the barrel, and Metro copied 26 `.ttf` files into `dist/`. Importing by weight subpath
   cut `dist/` from 9.0 MB to 3.7 MB.

## 4. Limitation found (design-system consequence)

**Inline React Native logical style props do not live-mirror on web.** `react-native-web` resolves
`marginStart` / `marginEnd` / `borderStartWidth` to physical `margin-left` / `margin-right` /
`border-left-width` at render time, against the direction in force when the element rendered. A live
`dir` flip therefore mirrors class-name utilities but leaves inline start/end props where they were.
On native this does not arise, because a direction change requires an application restart anyway
(plan §20).

Consequence for Phase 5b: **direction-sensitive spacing, padding, borders and alignment are
expressed with logical utilities** (`ms`/`me`, `ps`/`pe`, `start`/`end`, `border-s`/`border-e`,
`text-start`/`text-end`). Inline `marginStart`-style props are reserved for values a utility cannot
express, and any component using them must not be expected to mirror without a remount. The spike
screen keeps both paths side by side precisely so this stays visible.

## 5. Conditions attached to the PASS

1. **Logical utilities only.** Physical direction utilities (`ml`, `mr`, `pl`, `pr`, `left`,
   `right`, `border-l`, `border-r`, `rounded-l`, `rounded-r`, `text-left`, `text-right`) and
   NativeWind's `rtl:` / `ltr:` variants — which are broken on native — are banned by a
   `no-restricted-syntax` rule in the root ESLint config. The rule was verified against a probe file
   containing six violating class strings (including variant-prefixed, negative and template-literal
   forms): all six were reported, with no false positive on `text-primary`, `placeholder:text-sm`,
   `rounded-lg` or `pointer-events-none`.
2. **NativeWind stays on v4.** v5 is preview and explicitly not for production
   (`dependency-compatibility.md`). Tailwind stays on 3.4 because NativeWind 4 requires it.

## 6. Not covered by this spike

* A native device or simulator render. The jest-expo leg proves the React Native tree and its
  logical style props; running the Arabic layout on a physical iOS/Android development build is part
  of the Phase 5 gate, not 5a.
* The native direction-change reload flow. `@healthy360/i18n`'s native adapter returns
  `needsReload`; the user-facing prompt is Phase 5b work (plan §20).
* Playwright RTL/accessibility snapshots. Phase 5b, once there are components worth snapshotting.
