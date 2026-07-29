# Architecture Gap Report — source requirements vs platform foundation

**Basis**: "AI Project Instruction — Dietitian Clinic, Healthy Food and Integrated Wellness Ecosystem" (`General Info & Instruction.docx`, extracted 2026-07-30), compared against the revised platform foundation plan (2026-07-30, authoritative) and the foundation deliverables. Classifications follow the source document's own scheme (§4): **Existing requirement** / **Recommended addition** / **Optional future** / **Needs management confirmation**. Requirement IDs reference `docs/registers/requirements-register.md`.

The foundation phase intentionally implements no business module. Its job is the platform substrate: identity, tenancy, access control, features, consent, audit and one proven vertical slice. Everything else in the source document is either deferred with a named module, or flagged below.

## 1. Source requirements the foundation directly serves

| Source requirement | Source ref | Foundation coverage | Classification |
|---|---|---|---|
| Registration and secure login | §5A | Fortify + Sanctum JSON auth; web session + mobile tokens (REQ-001) | Existing requirement |
| Multi-factor authentication | §8 | TOTP 2FA in foundation auth scope (REQ-004) | Existing requirement |
| Role-based access control and approval controls | §5B, §6, §8 | Custom membership RBAC, six-step decision, separated concerns (REQ-010, ADR-0006) | Existing requirement |
| Multi-tenant SaaS with data segregation | §6 | Shared DB with organisation isolation + incremental RLS (REQ-011, ADR-0002/0007) | Existing requirement |
| Clinic and branch setup (structural part) | §5B | `organisation_*` tables, capabilities, branches, memberships (REQ-008) | Existing requirement |
| Feature activation and deactivation per tenant | §6 | `feature_definitions` / `feature_entitlements` (REQ-012) | Existing requirement |
| Subscription packages (structural part) | §6 | `organisation_subscriptions` scaffolding; billing deferred (REQ-013) | Existing requirement |
| User consent management | §8 | `consent_definitions` / `consent_grants` foundation (REQ-014) | Existing requirement |
| Audit trails | §8 | Append-only audit with redaction, correlation, purpose-of-use (REQ-015) | Existing requirement |
| Data encryption in transit and at rest (application part) | §8 | TLS assumed at deployment; field-level encryption service + KMS adapter contract (REQ-016). Full at-rest posture depends on hosting (OQ-008) | Existing requirement |
| Secure password management | §8 | Fortify hashing, reset flows, password confirmation step-up | Existing requirement |
| Arabic and English as priority languages | §6 | en + ar with full RTL, locale persistence, RTL visual tests (REQ-017) | Existing requirement |
| Country-specific settings, multiple currencies/languages (reference layer) | §6 | ISO reference tables; all countries seeded, launch set active (REQ-018) | Existing requirement |
| Access from different devices | §1 | Universal Expo app: web, iOS, Android (REQ-019, ADR-0004) | Existing requirement |
| API access and secure API management (platform part) | §6, §8 | Versioned OpenAPI-first JSON API, envelopes, correlation IDs (REQ-020) | Existing requirement |
| Environment separation, secure SDLC elements | §8 | CI with secret scanning, dependency review, CodeQL (plan §24) | Existing requirement |

## 2. Source requirements deliberately deferred to module phases

All deferred with a named module in `docs/architecture/module-registry.yaml`; sequencing per plan §25/§28. Deferral is scope discipline, not rejection.

| Source area | Source ref | Deferred to module(s) |
|---|---|---|
| Appointments, reminders, calendars | §1, §5A/B | Appointments |
| Patient records, assessments, measurements, consultation notes, attachments | §5A/B | ClinicalRecords |
| Ingredient database, nutrition engine, recipes, meal plans, substitutions, labels | §5C | Ingredients, Nutrition, Allergens, Recipes, MealPlanning |
| Kitchen production, inventory, procurement, food safety, waste | §5D | Kitchens, Inventory, Procurement, Production, QualityControl |
| Delivery zones, drivers, tracking, proof of delivery | §5E | Delivery |
| Fitness/wellness services and wearables | §5F | Future fitness capability; wearables in integration register (INT-004) |
| Partner onboarding, listings, commissions, settlements, marketplace | §5G, §10 | Marketplace, Catalogues, Pricing, Payments, Accounting |
| Corporate wellness, insurer integration, eligibility, billing | §5H | B2B (+ INT-003) |
| Food ordering, subscriptions (consumer), cart, checkout, POS | §5A, §10 | Cart, Orders, Subscriptions, Payments, POS, KitchenDisplay |
| Tenant-specific branding, configurable workflows, tenant onboarding/support tooling | §6 | PlatformAdministration extensions, post-foundation |
| Tax and invoice configuration | §6 | Accounting (`tax_jurisdictions` deferred per plan §7) |
| Notifications and reminders (beyond auth email) | §5A | Future notifications capability (INT-005) |
| Role-specific dashboards, reporting, analytics, exports | §9 | Reporting — see `docs/registers/report-catalogue.md` |
| AI capabilities under the stated AI principles | §7 | ArtificialIntelligence |
| Data retention, deletion/anonymisation, breach workflows, penetration testing, disaster recovery | §8 | Documented designs pending validation (plan §12; OQ-002/OQ-003); operational security practices mature with deployment (Phase 7+) |

## 3. Additions introduced by the foundation that are not in the source document

| Addition | Rationale | Classification |
|---|---|---|
| Incremental PostgreSQL RLS with representative table set, three DB roles, no BYPASSRLS application role | Defence in depth for §6 "data segregation" beyond what the source specifies (ADR-0007) | Recommended addition |
| Mock/API repository boundary with four production gates | Prevents demo data reaching production; enables spec-first frontend work (ADR-0011) | Recommended addition |
| OpenAPI 3.1 spec-first contract + generated TypeScript client behind a wrapped, pinned generator | Contract integrity across web/native (ADR-0005) | Recommended addition |
| UUIDv7 identifiers via central identifier service; ISO-code reference PKs | Ordered, app-generated IDs; stable reference keys (plan §8) | Recommended addition |
| Idempotency keys on explicitly idempotent commands; If-Match optimistic concurrency | Safe retries and conflict handling (`docs/api/conventions.md`) | Recommended addition |
| Correlation IDs, purpose-of-use on sensitive access, log redaction, data-classification enum | Makes §8 audit expectations concrete and testable (plan §12) | Recommended addition |
| Restricted offline persistence policy | Explicitly bounds what §5A mobile expectations may cache before threat models exist (ADR-0012) | Recommended addition |
| Global user identity with organisation memberships | The source implies multi-tenancy but does not decide identity topology; one person, many organisations (ADR-0003) | Recommended addition |
| Build families and role areas in one universal app | Source requires many audiences and devices; this is the delivery mechanism (ADR-0004) | Recommended addition |
| Pseudo-locale, translation-key type checking, RTL visual tests | Engineering rigour for the §6 language requirement | Recommended addition |
| Configurable clinical/financial numbering system for Arabic locales | Source is silent on numerals; forcing either choice is risky (OQ-001) | Recommended addition |

## 4. Optional future items (from the source, uncommitted)

| Item | Source ref | Position |
|---|---|---|
| French and further languages | §6 | Architecture keeps locale addition cheap; timing is a product decision (OQ-007) |
| Advertising, premium listings, premium analytics, API subscriptions | §10 | Revenue-model options; no foundation impact beyond Features scaffolding |
| Mental-wellness professionals | §5F | Source itself conditions this on professional/regulatory requirements |
| AI capability list (forecasting, churn, route optimisation, etc.) | §7 | Candidates only; each requires the source's AI principles plus a value case |

All: **Optional future**.

## 5. Needs management confirmation

| Question | Why it matters | Register ref |
|---|---|---|
| "Independent tenant environments" — is logical isolation in a shared database acceptable for all customer segments? | Insurers/corporates may contractually expect physical separation; ADR-0002 assumes logical isolation | OQ-006 |
| Default numbering system for Arabic locales (clinical/financial) | Provisional Latin-digit default is an assumption, not a decision | OQ-001, A-002, D-026 |
| Audit and personal-data retention periods | Blocks retention/deletion design; currently append-only with no purging | OQ-002 |
| Per-country regulatory validation (nine launch markets) | May impose residency, licensing or health-data constraints; no compliance claims are made in any foundation document | OQ-003, R-012 |
| Passkeys enablement and audience | Fortify dependency may exist; UI deliberately disabled | OQ-004 |
| Branch-required rules per organisation type | Affects Phase 3 organisation rules and the vertical-slice UX | OQ-005 |
| MVP classification of module-level requirements (source §11, Phase 3) | The source mandates classifying every requirement MVP / Phase 2 / Phase 3 / Optional / Out-of-scope; this exercise has **not** been performed for module scope — the foundation only fixes the substrate | Future work, per-module |

## 6. Honest statement of non-coverage

At the end of the foundation phase, the platform will authenticate users, manage organisations/branches/memberships, enforce tenant-scoped permissions, record consent and audit events, and prove one vertical slice on web and native — and nothing more. No appointment can be booked, no patient record stored, no recipe calculated, no meal ordered, no payment taken and no report generated. Those statements change only module by module, with the deferral table in this document updated as each module lands.
