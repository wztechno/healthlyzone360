# design-sync notes — @healthy360/design-system

## Status

**Feasibility spike passed. No sync has been run yet** — there is no `config.json`, no project, and
nothing uploaded. The next run is still a first-time import.

## The repo is off the converter's standard path, and why

`@healthy360/design-system` is **source-only and React Native**:

- `main` / `types` / `exports` all point at `./src/index.ts`. There is no build script and no
  `dist/`, because Metro consumes the TypeScript directly.
- Its peers are `react-native`, `nativewind@4.2.6`, `react-native-safe-area-context` and
  `expo-document-picker` — not a DOM library.

The converter's default path bundles a package's compiled `dist/` for the browser. Neither half of
that assumption holds here, so the bundle has to be produced explicitly. It works; the recipe is
below.

## Bundling recipe (verified 2026-08-29)

esbuild, entry `packages/design-system/src/index.ts`. Four settings carry the whole thing:

```js
jsx: 'automatic',
jsxImportSource: 'nativewind',          // ← without this, className is dropped and everything
                                        //   renders unstyled
alias: {
  'react-native': '<root>/node_modules/react-native-web',
},
resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js',
                    '.tsx', '.ts', '.jsx', '.js', '.json'],
mainFields: ['browser', 'module', 'main'],
conditions: ['browser', 'import', 'require'],
```

- **`resolveExtensions` is not optional.** Without the `.web.*` entries the build fails on
  `react-native-safe-area-context`, whose `specs/NativeSafeAreaView.js` deep-requires
  `react-native/Libraries/Utilities/codegenNativeComponent` — a native codegen path with no
  `react-native-web` equivalent. Preferring `.web.js` is exactly what Metro does.
- **`jsxImportSource: 'nativewind'` is what makes styling work at all.** NativeWind 4 styles through
  a JSX transform; bundle without it and every component renders with correct markup and no styles,
  which is the failure mode that would silently poison every uploaded preview.

Result: 458 modules, ~1.2 MB IIFE.

## CSS

Generated from the app's own Tailwind config, which already globs the packages:

```
cd apps/universal
npx tailwindcss -c tailwind.config.js -i global.css -o <out>/ds.css --minify
```

~42 KB. `global.css` imports `packages/design-tokens/generated/tokens.css` first, so the `:root`
and `.dark` token blocks come along. **`tokens.css` must reach the design through `styles.css`'s
`@import` closure** — rendered designs receive only that closure.

Dark mode is `darkMode: 'class'`, paired with the `.dark` block. The probe harness set
`<html class="light">`.

## Verified in a real browser

Bundle + CSS in Chromium via Playwright, mounting `Button` (primary `md`, quiet `sm`) and `Card`:

| Measured                 | Expected token                 |
| ------------------------ | ------------------------------ |
| `rgb(21, 112, 67)`       | `brandSurface` `#157043`       |
| radius `12px`            | `rounded-lg`                   |
| `md` padding `10px 16px` | `px-4 py-2.5`                  |
| `sm` padding `8px 14px`  | `px-3.5 py-2`                  |
| min-height `44px`        | `min-touch`                    |
| Card `16px` / `p-4`      | `rounded-xl`, `elevation-card` |

No page errors.

## Open questions for the real run

- **Only three components were proved.** The library exports roughly forty. `FileUploadField` pulls
  `expo-document-picker`, which has no browser implementation — expect it to need stubbing or
  excluding. `date-field` resolves per platform and will take the `.web.tsx` branch.
- **`useToast` / `Drawer` / `Dialog`** and anything else needing a provider must be wrapped for
  previews. Whatever wrapper they need belongs in `conventions.md` — the design agent cannot guess
  it.
- **No Storybook** (confirmed: no `.storybook/` and no `*.stories.*` anywhere). Shape is
  `package`. `apps/universal/src/screens/showcase-screen.tsx` renders every component in one place
  and is the best available source for preview authoring.

## Sequencing — this matters

The components are currently **wellness-green** (mint page, emerald brand, Inter + Space Grotesk).
Syncing before the HealthZone palette lands would upload mint-green components, and every design the
agent then produces would be built in the wrong colours. **Do the token retheme first**, then sync.
See `CLAUDE.md` for the palette mapping and the five open colour decisions.
