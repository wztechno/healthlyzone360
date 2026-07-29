# ADR-0012 — Restricted offline persistence

## Status

Accepted — 2026-07-30.

## Context

Mobile users in the launch markets will experience connectivity gaps, and "offline-first" is a common expectation. But this platform will carry clinical records, consents and financial data; casually persisting API responses to device storage creates leakage, staleness and conflict risks that have not been threat-modelled. Offline POS and offline clinical workflows have hard conflict-resolution and safety questions no one has answered yet.

## Decision

Phase 1 offline behaviour is deliberately minimal:

- **Implemented**: network-state detection; an offline banner; automatic retry after reconnection; optional persistence for **non-sensitive reference and public catalogue data only**; cache versioning so stale reference data can be invalidated.
- **Prohibited from persistence**: clinical records, health assessments, consents, authentication responses, private organisation data, financial information.
- **Not implemented until separate threat models and conflict rules are approved**: mutation outbox/queued writes, offline POS, offline clinical workflows.
- **No broad PWA service-worker cache** before privacy and invalidation rules are defined.

## Consequences

- Users get honest offline signalling rather than a false promise of offline operation; sensitive data never rests on the device beyond in-memory state.
- Reference-data caching (countries, units, public catalogue entries) still removes the most common cold-start friction.
- POS/KDS/driver build families remain prototypes partly because of this decision — their offline requirements are the blocking unknown (ADR-0004).
- Each future relaxation (e.g. an outbox for order submission) requires its own threat model, conflict rules and an ADR superseding the relevant restriction.

## Review trigger

Re-examine per-capability when a module genuinely needs offline writes (POS first, most likely), and only alongside an approved threat model and conflict-resolution design.
