# Dependency Register

Key third-party dependencies, why they are used, and their risk level. This is a curated register, not an inventory — exact versions and the full matrix live in `docs/architecture/dependency-compatibility.md`; lockfiles are authoritative for pins. Risk: Low / Medium / High.

| Dependency | Why | Risk | Notes |
|---|---|---|---|
| Laravel 13 (framework) | Application platform for the modular monolith | Low | Installed 13.23.0; mainstream, well-supported |
| Laravel Fortify | Headless authentication (login, 2FA, verification, resets) | Low | Retained from starter kit; converted to JSON responses |
| Laravel Sanctum | Web session + mobile personal access tokens | Low | Dual-mode auth is a core plan requirement |
| Laravel Horizon | Queue monitoring for Redis-backed jobs | Low | Queue context correctness matters for RLS (R-011) |
| Pest 5 / Larastan 3 / Pint | Testing, static analysis, formatting | Low | Pest 5 hard-requires PHP 8.4 (ADR-0008) |
| internachi/modular 3 | Module scaffolding for the modular monolith | Medium | Adopted only if the compatibility spike passes (D-022); cheap fallback exists |
| spatie/laravel-data, spatie/laravel-query-builder | DTOs and query filtering conventions | Low | Mature Spatie packages |
| PostgreSQL 18 | Platform database; RLS is load-bearing for tenancy | Low | Single shared database (ADR-0002/0007) |
| Redis 8 | Cache, queues, permission-version counters | Low | |
| Garage v2 | Local dev S3-compatible object store | Medium | Chosen because MinIO community edition is archived; isolated behind Laravel filesystem (ADR-0010, R-006) |
| Mailpit | Local mail capture for verification/reset flows | Low | Dev-only |
| @redocly/cli | OpenAPI lint + bundle | Low | Contract quality gate |
| Expo SDK 57 (+ expo-router, react-native-web) | Universal app: one codebase for web/iOS/Android | Medium | SDK pairing fixes RN/React versions; expo-router forks React Navigation — no `@react-navigation/*` imports (ADR-0009) |
| TypeScript 6 | Workspace language | Low | TS 7 deliberately not adopted (R-004) |
| pnpm 11 + Turborepo | Workspace and task orchestration | Low | `nodeLinker: hoisted` for RN; `allowBuilds` rename noted |
| TanStack Query 5 | Server-state management in the repository/hook chain | Low | |
| react-hook-form + @hookform/resolvers + zod 4 | Forms and validation via standard-schema resolver | Low | |
| @hey-api/openapi-ts | Generated TypeScript API client | **High** | Pre-1.0; exact-pinned, wrapped, committed output, drift CI (ADR-0005, R-001) |
| NativeWind 4.2 + Tailwind 3.4 | Styling across web and native | Medium | Provisional pending the en/ar spike; `rtl:`/`ltr:` variants broken on native — logical utilities only (R-002); v5 is preview, not for production |
| i18next 26 + react-i18next 17 | Internationalisation runtime | Low | Pseudo-locale and key type-checking required by Plan §20 |
| Vitest 4 / jest-expo 57 + RNTL 14 | Two-runner test split | Medium | RNTL under Vitest not viable (R-003) |
| Playwright + @axe-core/playwright | Web E2E and accessibility tests | Low | |
| msw 2 | Mock transport in tests only | Medium | `msw/native` incomplete — not used as app-level mock layer; repositories provide mocks (ADR-0011) |
| react-native-reanimated 4.5 + react-native-worklets | Animation/gesture foundation for design system | Low | Paired versions per Expo SDK 57 |
| radix-ui 1.6 | Accessible primitives for web-only component files | Low | Web-only (`.web.tsx`) usage |
