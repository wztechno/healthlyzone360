# Dependency Compatibility Matrix

The single authoritative compatibility document (plan §3). Versions below were resolved and verified on **2026-07-30** against Packagist/npm. Lockfiles are the source of truth for exact pins; this document records the chosen ranges, the verified-good versions and the caveats that constrain upgrades. Do **not** create ADRs for package patch versions.

## Backend (`apps/api/`)

| Package / service | Chosen range | Verified (2026-07-30) | Compatibility notes |
|---|---|---|---|
| PHP | 8.4.x | 8.4.11 (host) | Required by Pest 5 (`^8.4`); ADR-0008. Host lacks `pdo_sqlite` and `intl` — Docker image must provide `intl`; tests target PostgreSQL only |
| laravel/framework | ^13.0 | 13.23.0 (installed) | Baseline; adopted starter kit, not regenerated |
| laravel/sanctum | ^4.3 | 4.3.x | Supports Laravel ^11\|^12\|^13 |
| laravel/fortify | ^1.37 | 1.37.x (installed) | Retained from starter kit; converted to JSON responses under `/api/v1/auth/*` |
| laravel/horizon | ^5.48 | 5.48.x | Laravel ^13 support confirmed |
| pestphp/pest | ^5.0 | 5.0.x | Requires PHP ^8.4 |
| pestphp/pest-plugin-laravel | ^5.0 | 5.0.x | Pairs with Pest 5 |
| larastan/larastan | ^3.10 | 3.10.x | PHPStan ^2.2; Laravel ^13 |
| laravel/pint | ^1.30 | 1.30.x | |
| internachi/modular | ^3.0 | 3.0.x | PHP >=8.3, illuminate ^11\|^12\|^13. Adopt **only after** the plan §6 spike passes (discovery, migrations, routes, config caching, Pest, Larastan, optimisation commands) |
| spatie/laravel-data | ^4.23 | 4.23.x | |
| spatie/laravel-query-builder | ^7.3 | 7.3.x | Laravel ^12\|^13 |
| PostgreSQL | 18.x | 18.x | RLS is load-bearing (ADR-0007); UUIDv7 native support available but app-generated IDs preferred (plan §8) |
| Redis | 8.x | 8.x | Cache, queues, permission-version counters |
| Mailpit | 1.30.x | 1.30.x | Dev mail capture only |
| Garage (dxflrs/garage) | v2 | v2 | Dev S3-compatible store; chosen because MinIO community edition is archived and no longer publishes images (ADR-0010). Application uses Laravel filesystem abstraction only |
| @redocly/cli | ^2.41 | 2.41.x | OpenAPI 3.1 lint + bundle |

## Frontend (`apps/universal/` and `packages/*`)

| Package | Chosen range | Verified (2026-07-30) | Compatibility notes |
|---|---|---|---|
| Node.js | 24.x LTS | 24 LTS | Enforced via `engines` and CI |
| pnpm | 11.18.x | 11.18.x | `nodeLinker: hoisted` required for React Native; pnpm 11 renamed `onlyBuiltDependencies` → `allowBuilds` |
| turbo | ^2.10 | 2.10.x | |
| expo | 57.0.9 (SDK-managed) | 57.0.9 | SDK 57 pairs React Native 0.86.2 + React 19.2.3 — never hand-pick RN/React versions; upgrades happen per SDK |
| expo-router | 57.0.9 (SDK-managed) | 57.0.9 | Forks React Navigation internals — **do not import `@react-navigation/*`** |
| react-native-web | ~0.21.0 | ~0.21.0 | SDK 57 pairing |
| typescript | ~6.0 | 6.0.3 | **TS 7.0 is GA but not adopted**: typescript-eslint peer range is `<6.1.0` and TS 7 lacks a stable programmatic API. Review trigger recorded in ADR-0009 |
| @tanstack/react-query | ^5.101 | 5.101.x | |
| react-hook-form | ^7.83 | 7.83.x | |
| @hookform/resolvers | ^5.5 | 5.5.x | Use `standardSchemaResolver` with zod 4 |
| zod | ^4.4 | 4.4.x | |
| @hey-api/openapi-ts | **=0.99.0 (exact pin)** | 0.99.0 | Pre-1.0: exact pin, project-owned wrapper script, committed output, drift CI (ADR-0005). Upgrades are explicit reviewed acts |
| nativewind | 4.2.6 | 4.2.6 | v5 is preview, "not for production". `rtl:`/`ltr:` variants broken on native — **use logical utilities only** (`ps-`/`pe-`, `start-`/`end-`). Provisional pending the en/ar × web/native × light/dark spike |
| tailwindcss | ~3.4 | 3.4.x | NativeWind 4 requires Tailwind 3; do not move to Tailwind 4 independently |
| i18next | ^26.3 | 26.3.x | |
| react-i18next | ^17.0 | 17.0.x | |
| vitest | ^4.1 | 4.1.x | Framework-independent TS packages only |
| jest-expo | 57.0.x (SDK-managed) | 57.0.x | RN rendering tests. RNTL under Vitest is **not viable** — the two-runner split is deliberate |
| @testing-library/react-native | ^14.0 | 14.0.x | Pairs with jest-expo |
| @playwright/test | ^1.62 | 1.62.x | Web E2E + smoke |
| @axe-core/playwright | ^4.12 | 4.12.x | Accessibility assertions |
| msw | ^2.15 | 2.15.x | Test transport only; `msw/native` incomplete — app-level mocking is the mock repository (ADR-0011) |
| radix-ui | ^1.6 | 1.6.x | Web-only files (`.web.tsx`) |
| @gorhom/bottom-sheet | ^5.2 | 5.2.x | |
| react-native-reanimated | 4.5.x (SDK-managed) | 4.5.x | Pairs with worklets below per SDK 57 |
| react-native-worklets | 0.10.x (SDK-managed) | 0.10.x | |

"SDK-managed" ranges follow `npx expo install` resolution for SDK 57; do not override them manually.

## Version-management rules (plan §3)

1. **Lockfiles pin exact versions** (`composer.lock`, `pnpm-lock.yaml`); manifests use the controlled ranges above.
2. **One compatibility document** — this file. Update it when a range changes; never fork version truth into ADRs or READMEs.
3. **No ADR per patch version.** ADRs exist for consequential choices only; this matrix absorbs routine version movement.
4. **Pre-1.0 tools are wrapped behind project-owned scripts** (currently: `@hey-api/openapi-ts` generation script) and pinned exactly.
5. **Update automation (Renovate/Dependabot) must run the full test suites before merge** — backend (Pint, Larastan, Pest, migrations, tenancy/RLS tests) and frontend (lint, tsc, Vitest, Jest Expo, web exports, Playwright smoke) per plan §24.
6. Expo-paired packages upgrade **only** with the SDK; TypeScript upgrades only within the constraints noted; NativeWind stays on v4 until v5 is production-ready and re-evaluated.
