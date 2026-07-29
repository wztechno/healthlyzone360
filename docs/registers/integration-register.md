# Integration Register

External integrations. **Current position (2026-07-30): none live.** The foundation deliberately defers all third-party integrations; `integration_connections` and `webhook_events` tables are deferred until the first module that genuinely requires them (Plan §7).

## Live integrations

| ID | Integration | Status |
|---|---|---|
| — | None | — |

## Planned integrations (all deferred)

| ID | Integration | Purpose | Consuming module(s) | Status |
|---|---|---|---|---|
| INT-001 | Payment gateways (per-market: cards, wallets, cash-on-delivery reconciliation) | Consumer payments, subscriptions, partner settlements | Payments, Subscriptions, Accounting | Deferred — provider selection per launch market not started |
| INT-002 | Delivery providers | Order handover, tracking, proof of delivery | Delivery, Orders | Deferred (Source §5E) |
| INT-003 | Insurers / healthcare partners | Eligibility validation, insurer billing, outcome reporting | ClinicalRecords, B2B, Accounting | Deferred (Source §5H); regulatory assessment prerequisite (OQ-003) |
| INT-004 | Wearable devices and fitness platforms | Activity and wellness data into combined dashboards | ArtificialIntelligence, Reporting, future Fitness capability | Deferred (Source §5F); consent model prerequisite |
| INT-005 | Transactional email/SMS providers (production) | Verification, resets, notifications | Identity, future Notifications capability | Deferred — Mailpit serves development; production provider unchosen |

## Rules

- No integration is added without an entry here, a consuming module, and a security review of credentials handling.
- Integration secrets never appear in code or fixtures; secret scanning runs in CI (Plan §24).
- Object storage (Garage/S3) and Redis are infrastructure dependencies, not integrations — see the dependency register.
