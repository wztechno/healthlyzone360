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
| INT-005 | Transactional email/SMS providers (production) | Verification, resets, notifications — **and, from J1, the OTP framework**: contact verification, guest ordering, guest deletion, closure step-up and B2B signatory challenges all issue one-time passcodes over these providers | Identity, Verification, future Notifications capability | Deferred — Mailpit serves development and the email channel is real; **SMS ships with a log/fake driver only, and production phone-required activation is blocked until a provider is selected and approved** (A-008 revised, A-011, OQ-008) |
| INT-006 | WhatsApp Business API | Second OTP channel for contact verification and step-up, where SMS is unreliable or expensive | Verification | Deferred — requires a Business Service Provider, **template approval for every message** and an opt-in record per recipient; the channel driver interface exists from J1 with a log/fake driver behind it |
| INT-007 | E-signature provider | Executing B2B master service agreements | B2B | Deferred — **click-wrap ships first**: an OTP-confirmed acceptance with recorded evidence (challenge id, document sha256, consent grant, hashed IP and user agent), never described as a qualified electronic signature. Qualified e-signature is a separate decision (R-015) |
| INT-008 | Malware scanning for uploaded documents | Scanning KYC and B2B documents before they are stored or served | B2B, future Documents capability | Deferred — **gate before real B2B onboarding** (OQ-035, R-014). Until then uploads are private-disk, magic-byte sniffed, size-capped, hashed and audited, but unscanned |

## Rules

- No integration is added without an entry here, a consuming module, and a security review of credentials handling.
- Integration secrets never appear in code or fixtures; secret scanning runs in CI (Plan §24).
- Object storage (Garage/S3) and Redis are infrastructure dependencies, not integrations — see the dependency register.
