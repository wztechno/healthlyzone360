# ADR-0001 — Modular monolith, no microservices

## Status

Accepted — 2026-07-30.

## Context

Healthy360 will eventually span clinical, nutrition, kitchen, marketplace, ordering and delivery domains (~26 planned modules). The team is small, the product is pre-launch, and the foundation phase must prove one vertical slice (registration → organisation/branch selection → authenticated workspace) rather than distributed-systems plumbing. Microservices would impose network contracts, distributed transactions, per-service deployment and observability costs before any domain is validated.

## Decision

Build a single Laravel 13 application (`apps/api/`) organised as a modular monolith. Implemented foundation domains are expressed as application modules (Support, ReferenceData, Localisation, Identity, Organisations, Tenancy, AccessControl, Features, Consent, Audit, PlatformAdministration). Future domains are recorded in `docs/architecture/module-registry.yaml` only — no empty directories or speculative classes. Module boundaries are enforced by convention and architecture tests, not by process boundaries. InterNACHI Modular 3 is adopted only if the compatibility spike in plan §6 passes; otherwise project-owned namespaces under `app/Modules/` are used. Microservices are prohibited in this phase.

## Consequences

- One deployable unit, one database connection pool, one test suite; the vertical slice can be delivered quickly.
- Module discipline must be enforced in-code (registry-driven architecture tests, no cross-module imports outside published contracts), since the runtime will not enforce it.
- A future extraction of a hot module (e.g. Kitchen production) remains possible because boundaries and contracts are kept explicit from day one.
- All modules share the fate of a single deployment; a defect in one module can affect the whole API.

## Review trigger

Re-examine if any single module demonstrably needs independent scaling or deployment cadence (e.g. real-time KDS/delivery tracking load), or if team size grows to multiple independent delivery squads.
