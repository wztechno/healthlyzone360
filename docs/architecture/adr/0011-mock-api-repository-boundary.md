# ADR-0011 — Mock/API repository boundary in the frontend

## Status

Accepted — 2026-07-30.

## Context

Frontend work must proceed before every backend endpoint exists, and design iteration needs deterministic data. But mock data leaking into production — or screens quietly coupling to fixtures — would be dangerous in a health product. The plan (§18) mandates a single data-access shape with mocks as a first-class, strictly contained implementation.

## Decision

All frontend data access follows one chain:

```
Screen → Query/mutation hook → Repository interface → API repository | Mock repository
```

- Screens never call `fetch` directly and never import fixtures.
- API and mock repositories satisfy the identical interface; fixtures must validate against the generated OpenAPI schemas (ADR-0005).
- Mock mode is visibly indicated during development.
- **Mock mode is impossible in production, enforced by four gates**: (1) build-time — production builds fail if mock mode is enabled in configuration; (2) bundling — mock repositories and fixtures are excluded from production bundles; (3) runtime — a startup assertion refuses to run a production build in mock mode; (4) CI — a dedicated negative test proves a mock-enabled production build fails.
- The foundation acceptance workflow must pass against the real Laravel API, not only mocks.

## Consequences

- Screens are implementation-agnostic and testable with deterministic data; MSW is confined to test transport (its native support is incomplete — see risks register).
- The repository interface is a real contract to maintain — every endpoint addition touches interface, API implementation, mock implementation and fixtures.
- The four gates add build complexity but make "demo data shipped to patients" a CI-detectable failure class rather than an incident.

## Review trigger

Re-examine if the repository layer becomes a mechanical pass-through adding no value over the generated client, or when offline caching (ADR-0012) requires a persistence-aware repository decorator.
