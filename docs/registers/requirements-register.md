# Requirements Register

Foundation-relevant requirements traced to the source instruction document ("General Info & Instruction.docx", cited as **Source §n**) and the revised platform foundation plan (**Plan §n**). Status reflects the gated execution sequence (Plan §25); as at 2026-07-30, Phase 0 is complete and Phases 1–7 are in progress or pending. Deferred items point to the module roadmap (`docs/architecture/module-registry.yaml`, Plan §28). Full source-vs-foundation analysis: `docs/requirements/gap-report.md`.

| ID | Requirement | Source | Status |
|---|---|---|---|
| REQ-001 | Registration and secure login (web session + mobile token) | Source §5A; Plan §13 | Foundation — Phase 4 |
| REQ-002 | Email verification before workspace access | Plan §1, §13 | Foundation — Phase 4 |
| REQ-003 | Forgotten-password and password-reset flows | Source §5A; Plan §13 | Foundation — Phase 4 |
| REQ-004 | Multi-factor authentication (TOTP) | Source §8; Plan §13 | Foundation — Phase 4 |
| REQ-005 | Password confirmation (step-up) for sensitive actions | Plan §13 | Foundation — Phase 4 |
| REQ-006 | Device registration, listing and revocation; session revocation | Plan §13 | Foundation — Phase 4 |
| REQ-007 | One global user identity; membership of multiple organisations | Plan §9; ADR-0003 | Foundation — Phase 3 |
| REQ-008 | Organisation and branch structure (types, capabilities, branches) | Source §5B "clinic and branch setup"; Plan §7 | Foundation — Phase 3 |
| REQ-009 | Organisation and branch context selection, server-validated | Plan §9, §13 | Foundation — Phases 3–4 |
| REQ-010 | Role-based access control with approval-ready separation of concerns | Source §5B, §6, §8; Plan §10; ADR-0006 | Foundation — Phase 3 |
| REQ-011 | Multi-tenant data segregation (shared DB, organisation isolation, RLS) | Source §6 "data segregation"; Plan §2, §11; ADR-0002/0007 | Foundation — Phases 3 and 6 |
| REQ-012 | Feature activation/deactivation per tenant (definitions + entitlements) | Source §6; Plan §7 | Foundation — Phase 3 |
| REQ-013 | Subscription-package scaffolding (`organisation_subscriptions`) | Source §6; Plan §7 | Foundation — Phase 3 (billing/invoicing deferred) |
| REQ-014 | Consent definitions and grants foundation | Source §8; Plan §7, §12 | Foundation — Phase 6 |
| REQ-015 | Audit trail: append-only, redacted, correlation IDs, purpose-of-use | Source §8; Plan §12 | Foundation — Phase 6 |
| REQ-016 | Data classification and selected-field encryption service | Source §8; Plan §12 | Foundation — Phase 6 (KMS adapter: contract only) |
| REQ-017 | English and Arabic with full RTL; locale persistence | Source §6; Plan §2, §20 | Foundation — Phase 5 |
| REQ-018 | Country/currency/language/measurement reference data; all ISO countries seeded, launch set active | Source §6; Plan §2, §7 | Foundation — Phase 3 |
| REQ-019 | Access from web, iOS and Android devices | Source §1; Plan §2, §16; ADR-0004 | Foundation — Phase 5 |
| REQ-020 | Versioned JSON API with OpenAPI contract and generated client | Source §6 "API access"; Plan §14–15; ADR-0005 | Foundation — Phase 4 |
| REQ-021 | Configurable clinical/financial numbering system for Arabic locales | Plan §20 | Foundation — Phase 5 (default pending management, OQ-001) |
| REQ-022 | Offline signalling and non-sensitive reference caching only | Plan §21; ADR-0012 | Foundation — Phase 5 |
| REQ-023 | Appointment booking, reminders and calendar management | Source §1, §5A/B | Deferred — Appointments module |
| REQ-024 | Patient records, assessments, measurements, consultation notes | Source §5A/B | Deferred — ClinicalRecords module |
| REQ-025 | Recipes, nutrition calculation, meal planning | Source §5C | Deferred — Recipes/Nutrition/MealPlanning modules |
| REQ-026 | Kitchen production, inventory, procurement, quality control | Source §5D | Deferred — Kitchens/Inventory/Procurement/Production/QualityControl modules |
| REQ-027 | Delivery coordination and tracking | Source §5E | Deferred — Delivery module |
| REQ-028 | Marketplace, partner onboarding, commissions, settlements | Source §5G, §10 | Deferred — Marketplace/B2B/Payments/Accounting modules |
| REQ-029 | Role-specific dashboards and reporting | Source §9 | Deferred — Reporting module (see report catalogue) |
| REQ-030 | AI decision-support capabilities under stated AI principles | Source §7 | Deferred — ArtificialIntelligence module |

## Conventions

- IDs are permanent; superseded requirements are struck through with a note, never deleted.
- "Foundation — Phase N" means scheduled within the platform foundation (Plan §25); it is not a claim of completed implementation until the phase gate passes.
