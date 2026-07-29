# ADR-0009 — Node 24 LTS, Expo SDK 57, TypeScript 6

## Status

Accepted — 2026-07-30.

## Context

The universal frontend (ADR-0004) needs a coherent toolchain: Expo SDK 57 pairs React Native 0.86.2 with React 19.2.3 and `expo-router` 57.0.9. Node 24 is the current LTS. TypeScript 7.0 is GA, but two facts block adoption today (verified 2026-07-30): the `typescript-eslint` peer range is `<6.1.0`, and TS 7 lacks a stable programmatic API that our tooling (generation scripts, lint integrations) relies on.

## Decision

- Node 24 LTS as the only supported Node major (engines field + CI).
- Expo SDK 57 with its paired dependency set; `expo-router` for navigation — direct `@react-navigation/*` imports are prohibited because expo-router forks its internals.
- TypeScript 6.0.3 workspace-wide. **TypeScript 7 is explicitly not adopted**; this is a recorded review trigger, not an oversight.
- pnpm 11 workspaces (`nodeLinker: hoisted` for React Native compatibility; note pnpm 11 renamed `onlyBuiltDependencies` → `allowBuilds`) with Turborepo 2.10 task orchestration.

## Consequences

- One SDK upgrade path: Expo SDK majors drive React Native/React upgrades as a unit; we never hand-pick RN versions.
- TS 6 keeps the full ecosystem (typescript-eslint, vitest, generators) coherent; we forgo TS 7 performance gains for now.
- Hoisted node linking sacrifices some pnpm strictness for Metro/Expo compatibility — phantom-dependency discipline falls to lint rules and review.
- Testing is split by necessity: Vitest for framework-independent packages, Jest Expo + React Native Testing Library for RN rendering (RNTL under Vitest is not viable) — see risks register.

## Review trigger

Adopt TypeScript 7 when typescript-eslint supports it **and** a stable programmatic API ships; revisit the whole set at each Expo SDK major and at Node 26 LTS.
