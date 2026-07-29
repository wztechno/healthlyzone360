# Data Register

The 23 foundation tables (Plan §7) with data classification and PII flags. Classification levels (Plan §12 data-classification enum, provisional labels): **Public** (freely shareable reference data), **Internal** (operational, non-personal), **Confidential** (commercial or personal data), **Restricted** (sensitive personal / special-category-adjacent data). ERD: `docs/architecture/foundation-erd.md`.

| Table | Cluster | Classification | PII | Notes |
|---|---|---|---|---|
| users | Identity | Confidential | Yes | Email, name, credentials (hashed), 2FA secrets (encrypted). Platform-global — outside organisation RLS |
| user_profiles | Identity | Restricted | Yes | Demographics, locale, preferences; may hold health-adjacent preference data — treat as restricted from the outset |
| user_devices | Identity | Confidential | Yes | Device names, platform, token references; no raw tokens stored beyond Sanctum hashes |
| countries | Reference | Public | No | ISO 3166 codes as PKs; `is_active` marks launch set |
| currencies | Reference | Public | No | ISO 4217 codes as PKs |
| languages | Reference | Public | No | ISO 639 codes as PKs; direction flag (LTR/RTL) |
| measurement_units | Reference | Public | No | Clinical and culinary units |
| organisation_types | Organisations | Public | No | Clinic, kitchen, fitness, supplier, etc. |
| organisations | Organisations | Confidential | No* | Tenant master data; contact fields may incidentally contain personal data of contacts |
| organisation_capabilities | Organisations | Internal | No | What an organisation may operate (clinic, kitchen, …) |
| organisation_branches | Organisations | Confidential | No | Locations, contact details; RLS representative set |
| organisation_memberships | Organisations | Confidential | Yes | Links person ↔ organisation; employment/patient affiliation is personal data; RLS representative set |
| roles | Access control | Internal | No | Organisation-scoped role definitions; RLS representative set |
| permissions | Access control | Internal | No | Platform permission catalogue (`domain.action_scope`) |
| membership_roles | Access control | Confidential | Yes (indirect) | Role assignments per membership; optional `starts_at`/`expires_at` |
| role_permissions | Access control | Internal | No | Role → permission mapping |
| feature_definitions | Features | Internal | No | Platform feature catalogue |
| feature_entitlements | Features | Confidential | No | Per-organisation entitlements — commercially sensitive; RLS representative set |
| organisation_subscriptions | Features | Confidential | No | Package/subscription state; billing detail deferred |
| consent_definitions | Consent | Internal | No | Versioned consent texts and purposes |
| consent_grants | Consent | Restricted | Yes | Who consented to what, when, in which context — legally significant; RLS representative set |
| audit_logs | Operational | Restricted | Yes | Actor, action, purpose-of-use, redacted metadata; append-only; application role cannot update/delete; RLS representative set. Never contains raw passwords, tokens, medical content, request bodies or payment payloads |
| idempotency_keys | Operational | Internal | No | Key, scope, response fingerprint; no request bodies retained |

## Standing conventions

- UUIDv7 primary keys, application-generated via the central identifier service; ISO-code PKs for stable reference tables (Plan §8).
- Tenant-owned tables carry `organisation_id` (and `branch_id` where applicable), `created_by`, timestamps; `lock_version` where optimistic concurrency matters.
- Retention periods and deletion/anonymisation rules are **not yet decided** (OQ-002); crypto-shredding and jurisdiction-specific deletion remain documented designs (Plan §12).
- Deferred tables (tax, integrations, webhooks, billing, commissions, settlements, kitchen, nutrition, clinical) may appear in future ERDs but are not migrated in this phase.
