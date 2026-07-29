# ADR-0005 — OpenAPI-generated TypeScript client (spec-first)

## Status

Accepted — 2026-07-30.

## Context

The universal frontend and the Laravel API must agree on one contract across web and native, in mock and real modes. Hand-written client types drift; runtime surprises in a health platform are unacceptable. OpenAPI 3.1 is the chosen contract format (plan §14–15). The best available generator, `@hey-api/openapi-ts`, is pre-1.0 (0.99.0), which conflicts with a naive "just depend on it" approach.

## Decision

- OpenAPI 3.1 document is the authoritative contract for every implemented endpoint; Redocly CLI lints and bundles it.
- One generated TypeScript client, produced by `@hey-api/openapi-ts` pinned to an exact version (0.99.0) behind a project-owned generation script (per the pre-1.0 wrapping rule in plan §3).
- Generated output is committed; CI fails on drift between spec and committed client.
- Generated code may only be imported through the API repository layer (ADR-0011) — never directly by screens or hooks.
- Test fixtures must validate against the generated schemas.
- No custom 200-line PHP schema-validation fallback in Phase 1: a short validator spike selects one maintained PHP validation path, otherwise linting + generated-client compilation + targeted contract assertions + smoke tests stand in, and full runtime schema validation is recorded as deferred.

## Consequences

- Contract changes are deliberate: edit spec → regenerate → review diff → implement.
- Backend OpenAPI must exist before final client generation (plan §26 sequencing).
- A breaking generator release cannot ripple in via a range update; upgrading the generator is an explicit, reviewed act on the wrapper script.
- Committed generated code adds review noise; drift CI keeps it honest.

## Review trigger

Re-examine when `@hey-api/openapi-ts` reaches 1.0 (loosen the exact pin), or if the validator spike fails and runtime schema validation stays deferred beyond the foundation phase.
