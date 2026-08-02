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
| measurement_units | Reference | Public | No | Clinical, culinary and pack units. K1.1 added `dimension` (`mass`/`volume`/`count`/`serving`/`package`/`energy`/`length`) so automatic conversion can be confined to one dimension (D-047 strategy `platform-public-ref`); `unit_system` gained `packaging` for bunch/can/bag/bottle |
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

## Kitchen catalogue — phase K1.1 (ingredients & allergens)

Every row names exactly one isolation strategy from the vocabulary below. K1.1 adds **no** PostgreSQL policy: the strategies named here describe the intended protection, and in this slice it is enforced at the application layer (global scope, service-layer platform-row rule) and proven by cross-organisation feature tests. The RLS set is unchanged, and `RlsTest` still covers six tables.

| Table | Cluster | Classification | PII | Isolation strategy | Notes |
|---|---|---|---|---|---|
| allergens | Kitchen reference | Public | No | `platform-public-ref` | The 14 canonical EU-14 classes. **`code` is the primary key** — the justified exception to UUIDv7 surrogates (D-023): an allergen class is a regulatory identity that mappings, customer declarations and frozen labels all point at. Never renamed, never deleted; withdrawal is deactivation. Read anonymously through a public projection; written only by a platform operator |
| ingredient_categories | Kitchen catalogue | Internal | No | `org-rls` (app-scope in K1.1) | Two-level taxonomy in one self-referencing table. `organisation_id` NULL = platform library, visible in every tenant (the `roles` pattern); tenant rows visible only in their own. `UNIQUE NULLS NOT DISTINCT (organisation_id, code)` |
| ingredients | Kitchen catalogue | Internal | No | `org-rls` (app-scope in K1.1) | Platform library (`organisation_id` NULL) plus tenant rows. Carries `lock_version` (optimistic concurrency), `verification_status` (the burghul/pita contradiction is recorded as `requires_review`, never resolved silently) and `source_system`/`source_ref` for import convergence. **No `ingredient_kind`, no `produced_by_recipe_id`** — an intermediate is derived from `recipe_version_outputs` in K1.2 |
| ingredient_aliases | Kitchen catalogue | Internal | No | `join-rls-parent` | Other names an ingredient answers to. `alias_normalised` is model-written (lower/trim/collapse) and is what designation lookup matches; deliberately no stemming or transliteration (risk R4). Reached only through `ingredients`, cascade-deleted with it |
| ingredient_allergens | Kitchen catalogue | Internal (mapping) / Public (the declaration it produces) | No | `join-rls-parent` | Two layers in one table: `organisation_id` NULL = platform baseline, a tenant identifier = that kitchen's overlay. The overlay is **upgrade-only** — a kitchen may add or strengthen, never drop or weaken a baseline row. `market_scope` exists because EU-14 and US Big-9 differ (coconut is US-only). `allergen_code` is `restrictOnDelete` |

`audit_logs.subject_id` widened from `uuid` to `varchar(64)` in the same migration group: allergen classes are the first auditable subject whose identity is a code rather than a surrogate key. The column was never a foreign key — it points at whatever `subject_type` names — so no integrity guarantee is lost.

**Data loading**: `allergens` and the platform `ingredients`/`ingredient_categories`/`ingredient_aliases`/`ingredient_allergens` rows are mechanism (a) — committed, production-safe platform reference seeders (`KitchenReferenceSeeder`). They contain names, categories and regulated allergen classes only: no formulation, no cost, no supplier, no yield. Those arrive exclusively through the private importer (mechanism (c)), never as a file in this repository. The seeders are insert-if-absent, so a platform operator's curation of a seeded row survives the next deployment (risk R8).

## Standing conventions

- UUIDv7 primary keys, application-generated via the central identifier service; ISO-code PKs for stable reference tables (Plan §8).
- Tenant-owned tables carry `organisation_id` (and `branch_id` where applicable), `created_by`, timestamps; `lock_version` where optimistic concurrency matters.
- Retention periods and deletion/anonymisation rules are **not yet decided** (OQ-002); crypto-shredding and jurisdiction-specific deletion remain documented designs (Plan §12).
- Deferred tables (tax, integrations, webhooks, billing, commissions, settlements, kitchen, nutrition, clinical) may appear in future ERDs but are not migrated in this phase.

## Data loading — three mechanisms, and only three (D-046)

Every row that reaches a database arrives by one of these, and the mechanism is stated wherever data is described:

1. **Platform reference seeders** — committed to the repository, non-confidential, production-safe: allergen classes, measurement units, the delivery-area gazetteer, currencies, countries, languages and other controlled vocabularies.
2. **Synthetic fixtures** — committed, demo and test only, and labelled synthetic on screen. They contain **no real formulations, costs or supplier terms**; a synthetic nutrition or cost figure is never promoted to production data.
3. **Private tenant importer** — an artisan command reading confidential source data from an out-of-repo path supplied at run time, with a manifest and sha256 checksums, a dry-run mode, created/skipped/failed counts, unresolved-alias, data-quality, allergen-review and quarantine reports, insert-if-absent semantics so operator edits are never overwritten, idempotent re-runs, environment allowlisting and an audited execution record.

**Confidential source data is never committed to this repository in any form** — not as a seeder, not as a JSON fixture, not as a test resource, and not behind an environment guard. A local-only guard on a committed file still commits the file.

## Isolation strategy vocabulary (D-047)

Every table added from phase K1 onwards names **exactly one** strategy in its register row. The vocabulary is closed; "application scoped" is not a member of it:

| Strategy | Meaning |
|---|---|
| `platform-public-ref` | Platform-owned reference data, readable by everyone, written only by a platform operator |
| `org-rls` | Tenant data protected by a PostgreSQL row-level-security policy on `organisation_id` |
| `user-owner-rls` / `customer-owner-rls` | Rows owned by one person or one customer account, protected by an owner-matching policy |
| `join-rls-parent` | Child rows reached only through an RLS-protected parent — FK cascade plus a denormalised organisation id so the policy can be evaluated directly |
| `platform-only` | Reachable only through an explicit platform-operator permission; no tenant read path exists |
| `capability-token` | Rows reachable only by presenting an opaque, capability-limited token issued by a service (guest sessions and the rows they reach) |
| `append-only-ledger` | Insert-only, with `UPDATE` and `DELETE` revoked from the application role |

The twenty-three foundation rows above predate the vocabulary; each is annotated when its isolation next changes. RLS tests run under the non-owner role (`rls` group, `SET ROLE`) and extend in every phase that adds a policy.
