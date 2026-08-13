# universal (`apps/universal`)

The one Expo SDK 57 application that targets web, iOS and Android (ADR-0004). Phase 5a contains the
bootstrap only: workspace wiring, `app.config.ts`'s build-family map, the i18n and safe-area
providers, a not-found route, and the NativeWind spike screen that decides whether NativeWind becomes
mandatory (plan §19 — verdict in `docs/architecture/notes/nativewind-spike.md`). Authentication
screens, guards, the design system and the repository layer arrive in Phase 5b.

## Build families

`APP_MODE` selects the application's identity at configure time. `all-dev` is the default.

| `APP_MODE` | Name | Bundle identifier | Production configuration |
| --- | --- | --- | --- |
| `customer` | Healthy360 | `com.healthy360.customer` | Yes |
| `staff` | Healthy360 Staff | `com.healthy360.staff` | Yes |
| `kiosk` | Healthy360 Kiosk | `com.healthy360.kiosk` | **No — prototype** (`preview` only) |
| `driver` | Healthy360 Driver | `com.healthy360.driver` | **No — prototype** (`preview` only) |
| `all-dev` | Healthy360 Dev | `com.healthy360.dev` | Yes (internal distribution) |

POS, KDS and driver stay prototypes until their hardware and offline requirements are known
(plan §16), so `eas.json` gives them `*-preview` profiles only and `app.config.ts` refuses to
configure them with `APP_ENV=production`.

## There is no mock data

The mock implementation was deleted (ADR-0013, D-087): every build talks to the Laravel API, and
`EXPO_PUBLIC_DATA_MODE` no longer exists. The guard that survives is in the repository factory —
a production build refuses to boot without a real `EXPO_PUBLIC_API_URL`
(`MissingApiBaseUrlError` in `packages/api-client/src/registry.ts`), so a production artefact can
never quietly fall back to `localhost`. Features without a backend are hidden from users by
`src/features/availability.ts`; their repository methods reject with `prototype.not_implemented`
if code ever reaches them.

## Commands

Copy `.env.example` to `.env` once (already done for local clones that create `.env`). The app
reads `EXPO_PUBLIC_API_URL` from it (the committed default points at the local stack).

```bash
pnpm --filter universal dev            # expo start (reads apps/universal/.env)
pnpm --filter universal build:web      # expo export -p web
pnpm --filter universal test           # jest-expo render tests
pnpm --filter universal typecheck
pnpm --filter universal lint
pnpm --filter universal exec expo-doctor
```

## Styling

NativeWind 4 + Tailwind 3.4, consuming the generated preset from `@healthy360/design-tokens`.
**Logical utilities only** — `ms`/`me`, `ps`/`pe`, `start`/`end`, `border-s`/`border-e`,
`text-start`/`text-end`. Physical utilities and NativeWind's `rtl:`/`ltr:` variants are banned by the
root ESLint config because the variants do not work on native.
