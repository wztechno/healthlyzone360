# ADR-0004 — Universal Expo frontend: one codebase, build families, role areas

## Status

Accepted — 2026-07-30.

## Context

The platform must reach patients, dietitians, clinic staff, kitchen staff, drivers and platform administrators on web, iOS and Android, in English and Arabic (RTL). Maintaining separate web and native codebases (or one app per audience) would multiply design-system, i18n and data-access work far beyond the team's capacity, and would fragment the permission model across clients.

## Decision

One Expo SDK 57 project at `apps/universal/` (React Native 0.86 / React 19.2 pairing, Expo Router, react-native-web) targeting web, iOS and Android.

- **Build families** (build-time modes): `customer`, `staff`, `kiosk`, `driver`, `all-dev`. Only `customer`, `staff` and `all-dev` need production-ready configuration in Phase 1; POS, KDS and driver remain shell/prototype modes until hardware and offline requirements are known.
- **Role areas** recognised by the route registry: public, auth, customer, patient, dietitian, clinic, kitchen, pos, kds, driver, partner, corporate, insurance, platform-admin. Only the Phase 1 screen list (plan §16) is functional; other areas render one consistent prototype state.
- A framework-independent permission kernel gates routes client-side (mode → auth → email verification → organisation → branch → entitlement → permission); Laravel remains authoritative (plan §17).

## Consequences

- One design system, one i18n pipeline, one API client serve all audiences and platforms.
- Platform-specific behaviour is handled with `.web.tsx`/`.native.tsx` files where genuinely different — not restricted to primitives only.
- Web output must not silently depend on native-only modules; CI exports web for `all-dev` and one production mode.
- `expo-router` forks React Navigation internals — direct `@react-navigation/*` imports are prohibited.
- Build families mean role surface area is controlled at build time; shipping a wrong-family binary is a release-process risk mitigated by CI mode checks.

## Review trigger

Re-examine if POS/KDS hardware requirements (peripherals, offline resilience) prove incompatible with Expo, or if any single audience's UX demands diverge so far that a dedicated app is cheaper than mode complexity.
