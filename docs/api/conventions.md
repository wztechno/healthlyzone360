# API Conventions

Wire-level conventions for the Healthy360 JSON API. The OpenAPI 3.1 document is the authoritative contract for implemented endpoints (ADR-0005); this document fixes the conventions that every endpoint follows.

The implementation of record is `apps/api`: `Healthy360\Support\Api\ErrorCode` (the code vocabulary), `Healthy360\Support\Api\ApiResponse` (the only place a body is built) and `apps/api/openapi/healthy360.v1.yaml` (the contract). A Pest test asserts that the enum and the document agree, and that every route is described.

## Versioning

- All endpoints live under `/api/v1/`.
- Within a major version, changes are **additive only**: new endpoints, new optional fields, new enum values documented as extensible. Removing or repurposing a field, changing a type, or changing an error code requires `/api/v2`.
- Clients must ignore unknown response fields.

## Response envelopes

**Success**

```json
{
  "data": {
    "id": "0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3c",
    "name": "Cedar Clinic"
  },
  "meta": {
    "correlation_id": "0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3d"
  }
}
```

Collections return `data` as an array; pagination, counts and similar belong in `meta`. `meta.correlation_id` is always present.

**Error**

```json
{
  "error": {
    "code": "context.branch_out_of_scope",
    "message": "The requested branch is not within your membership scope.",
    "details": {},
    "correlation_id": "0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3d"
  }
}
```

`message` is a safe, translatable human summary — never a stack trace. `details` carries structured, code-specific data (for `validation.failed`: a `fields` map of field → messages). The error object carries exactly these four keys.

**Envelope exceptions** (documented, deliberate): `204 No Content` responses (`DELETE /api/v1/me/devices/{device}`, and `POST /api/v1/auth/email/verification-notification` when the address is already verified); file downloads (`/storage/{path}`); streaming responses; the health check at `/up`; the service banner at `/`; the Sanctum CSRF-cookie handshake at `/sanctum/csrf-cookie`.

## Headers

| Direction | Header | Purpose | Notes |
|---|---|---|---|
| Client → server | `X-Organisation-Id` | Active organisation context | Never trusted without server-side validation against active membership |
| Client → server | `X-Branch-Id` | Active branch context | Only where the workflow is branch-scoped; validated against membership scope |
| Client → server | `Accept-Language` | Locale negotiation | `en`, `ar` (with regional subtags accepted) |
| Client → server | `X-Client-Request-Id` | Client-generated request identifier for support correlation | Opaque; sanitised, capped at 128 characters, written to the log context and echoed back as a response header. Never used as the correlation identifier |
| Client → server | `Origin` | First-party session handshake | Required on the cookie-session endpoints (`POST /api/v1/auth/login`, `/logout`, `/two-factor-challenge`); must match `SANCTUM_STATEFUL_DOMAINS`. A caller without one receives `400 request.invalid` and should use `POST /api/v1/auth/token` |
| Client → server | `X-App-Mode` | Build family (`customer`, `staff`, `kiosk`, `driver`, `all-dev`) | Diagnostic; never an authorisation input |
| Client → server | `X-Client-Version` | App version for diagnostics and deprecation telemetry | |
| Client → server | `X-Client-Platform` | `web`, `ios`, `android` | |
| Client → server | `Idempotency-Key` | De-duplication of retried commands | **Only on explicitly idempotent command endpoints** (marked in OpenAPI). Do not attach automatically to every mutation. Keys are scoped per endpoint per user; replays return the original response. No implemented endpoint accepts it yet |
| Client → server | `If-Match` | Optimistic concurrency | **Required on writes to resources supporting it** (those with `lock_version` — see ERD). Absent returns `428` with `request.precondition_required`; mismatch returns `409` with `resource.conflict`. First accepted by the K1.1 ingredient writes (`PATCH /catalogue/ingredients/{ingredient}`, `POST …/archive`); K1.2 added the recipe and recipe-version writes |
| Server → client | `ETag` | The validator of a lock-versioned resource | `"<lock_version>"`, quoted. Returned by the single-resource GET and by every write that succeeds; sent back as `If-Match` |
| Server → client | `X-Correlation-Id` | Server-generated correlation identifier | Generated per request, returned on every response, embedded in `meta`/`error` and in audit logs |

## Error code namespaces

Codes are stable, machine-readable, dot-separated: `namespace.specific_condition`. Clients branch on `code`, never on `message`. Within `/api/v1` a code may be **added**, never renamed or repurposed.

The complete implemented vocabulary — `Healthy360\Support\Api\ErrorCode`, mirrored by the `ErrorCode` schema in the OpenAPI document:

| Code | HTTP | Raised when |
|---|---|---|
| `validation.failed` | 422 | Input failed validation. `details.fields` maps field → messages |
| `auth.unauthenticated` | 401 | No usable credential |
| `auth.invalid_credentials` | 422 | Email/password rejected (sign-in, token exchange, password confirmation) |
| `auth.email_unverified` | 403 | A `verified`-protected endpoint reached before verification |
| `auth.two_factor_required` | 403 | `POST /api/v1/auth/token` without a two-factor code for an enrolled account |
| `auth.two_factor_invalid` | 422 | The supplied TOTP or recovery code was rejected |
| `auth.step_up_required` | 403 | A sensitive action without a recent password confirmation |
| `auth.csrf_token_mismatch` | 419 | The CSRF token is missing or has expired |
| `auth.invalid_signature` | 403 | A signed link (email verification) is tampered with or expired |
| `context.organisation_required` | 400 | An organisation-scoped endpoint reached without `X-Organisation-Id` |
| `context.organisation_forbidden` | 403 | No active membership in the claimed organisation (also when it does not exist) |
| `context.branch_out_of_scope` | 403 | The claimed branch is not an active branch inside the membership scope |
| `context.branch_required` | 400 | An endpoint that operates on one branch was reached with no branch selected (K1.7). `details.required_headers` names `X-Branch-Id`. Distinct from `context.branch_out_of_scope`: the caller has not asked for a branch they may not have, they have not asked for one at all. `branch.context` deliberately permits an absent header — an organisation-wide membership may legitimately select no branch — so the requirement belongs to the endpoints that cannot answer without one |
| `authz.permission_denied` | 403 | The six-step RBAC decision denied. `details.reason` names the denying step, `details.permission` the code |
| `request.invalid` | 400 | The request cannot be processed as sent (for example a session endpoint without a first-party `Origin`, a malformed cursor, or an `If-Match` that is not an `ETag` this API issued) |
| `request.precondition_required` | 428 | A write to a lock-versioned resource arrived without `If-Match`. `details.required_headers` names it. Distinct from `resource.conflict`: the caller has not lost a race, it never entered one |
| `resource.not_found` | 404 | The resource does not exist, or is not the caller's to see |
| `resource.conflict` | 409 | The change conflicts with the current state |
| `catalogue.in_use` | 409 | A catalogue record cannot be withdrawn because something still points at it — an ingredient named by a non-retired recipe version or listed by a non-retired catalogue item (`details.recipe_ids`, `details.recipe_version_ids`, `details.catalogue_item_ids`), a recipe with a published version (`details.published_version_ids`), or a published recipe version a published catalogue item sells (`details.catalogue_item_ids`). Distinct from `resource.conflict`: the caller has not lost a race, and the answer is "retire those first" rather than "reload and try again" |
| `catalogue.version_immutable` | 409 | A write reached a published or retired recipe version. `details.status` names which. Published versions are immutable — a change is a new draft version, because a label a customer has already been shown must stay reconstructable |
| `catalogue.allergen_unmapped` | 422 | Publication refused: at least one line ingredient carries no allergen determination at all. `details.ingredient_ids` names them. An ingredient passes when it holds a mapping row in any layer, **or** when its `verification_status` is `verified` — silence is not a statement of absence |
| `catalogue.publish_blocked` | 409 | Publication refused by the readiness evaluator for any other reason. `details.reasons` carries **every** blocker as `{reason, …context}`, so a kitchen fixes them in one pass rather than one per attempt. Recipe versions: `version_quarantined`, `version_not_a_draft`, `no_lines`, `line_quantity_missing`, `ingredient_requires_review`. Catalogue items (K1.4): `item_quarantined`, `item_not_a_draft`, `translation_incomplete`, `no_active_variant`, `no_allergen_basis`, `linked_recipe_quarantined` |
| `rate_limit.exceeded` | 429 | A rate limit was exceeded. Served with `Retry-After` |
| `server.internal_error` | 500 | Anything unrecognised. Safe message only; never a message or trace from the underlying exception |

Namespaces: `auth.*` authentication state · `authz.*` permission denial (RBAC steps 4–6) · `context.*` organisation and branch context · `resource.*` resource state · `catalogue.*` kitchen-catalogue rules that a generic resource code would flatten · `validation.*` input · `request.*` malformed request · `rate_limit.*` throttling · `server.*` faults.

Separated authorisation concerns (context, entitlement, consent, relationship, step-up, email verification — plan §10) each surface a **distinct** code; they are never collapsed into a generic permission denial. Within `authz.permission_denied` the exact RBAC step is reported in `details.reason` (`unauthenticated`, `membership_inactive`, `branch_out_of_scope`, `permission_not_granted`, `resource_outside_organisation`, `policy_denied`).

**Specific rule — step-up authentication**: when a sensitive action requires recent password confirmation, the API returns **HTTP 403** with `error.code = auth.step_up_required` and `details.confirmation_endpoint`. It does **not** use HTTP 423. The step-up protected endpoints are:

- `DELETE /api/v1/me/devices/{device}`
- `DELETE /api/v1/auth/two-factor-authentication`

A confirmation is bound to the credential that performed it — the session for cookie clients, the personal access token for bearer clients — and lapses after `auth.password_timeout` seconds. `GET /api/v1/auth/confirmed-password-status` reports the current state.

## Optimistic concurrency (`If-Match`)

A management endpoint that serves a lock-versioned resource returns the current version as its validator: `ETag: "<lock_version>"` on the single-resource GET. A write to such a resource requires `If-Match` carrying the value the client last read.

- **Match** — the write proceeds and the response carries the new `ETag`.
- **Mismatch** — `409 resource.conflict`, carrying `details.current_lock_version` so the client can offer "reload" or "keep mine" without a second round trip just to discover what it lost to. Somebody changed the resource since it was read; the client re-reads and decides, rather than retrying blindly over another author's work.
- **Absent** — HTTP **428** `request.precondition_required`, with `details.required_headers`. Deliberately not 409 and not 400: the caller has not lost a race, it never entered one, and the fix is to read the resource and retry with its validator rather than to reload and merge.
- **Unusable** — an `If-Match` that is not an `ETag` this API issued (`"abc"`) is `400 request.invalid`. A malformed request is not a lost race either.

`If-Match: *` is accepted per RFC 9110 and means "as long as the resource exists"; the endpoint's own existence check answers that.

The freshness of the validator is decided **inside the write statement** (`UPDATE … WHERE lock_version = ?`), not by reading the row first: a read-then-write leaves a window in which the row changes, which is the exact race the header exists to close.

The header applies only to resources that carry `lock_version`. A resource without one has no concurrency contract and is not sent `If-Match` — ingredient categories and allergen classes are examples.

**Endpoints that require it** (as of K1.6):

- `PATCH /api/v1/catalogue/ingredients/{ingredient}` · `POST /api/v1/catalogue/ingredients/{ingredient}/archive`
- `PATCH /api/v1/catalogue/recipes/{recipe}` · `POST /api/v1/catalogue/recipes/{recipe}/archive`
- `PATCH /api/v1/catalogue/recipes/{recipe}/versions/{version}` and its `…/lines`, `…/outputs`, `…/steps`, `…/publish`, `…/retire` sub-resources
- `PATCH /api/v1/catalogue/sales-channels/{channel}`
- `PATCH /api/v1/catalogue/items/{item}` and its `…/variants`, `…/ingredients`, `…/diet-classifications`, `…/channels`, `…/publish`, `…/retire` sub-resources
- `PATCH /api/v1/catalogue/price-lists/{priceList}` and its `…/entries`, `…/channels`, `…/publish`, `…/archive` sub-resources
- `PUT /api/v1/catalogue/plans/{item}/profile` · `…/variants` · `…/variant-durations` — the validator is the **item's**

On the version, item, price-list and plan sub-resources the validator is the **parent's** `lock_version`, not a line's, a step's, a variant's, a price row's or a matrix cell's. The set is the unit of change: a per-row validator would let two editors replace different halves of one formulation — or one listing, one tariff, one matrix — and each believe they had written the whole of it.

The plan **vocabularies** (`/catalogue/plan-vocabulary/…`) deliberately take no `If-Match`: those rows carry no `lock_version`, and the rule above applies. Two editors renaming a calorie band at once is a lost caption; two editors replacing a plan's matrix at once is a lost tariff, which is why only the second is guarded.

## Cursor pagination

Collection endpoints paginate by keyset over `(created_at, id)`, never by offset: a catalogue is written to while it is being walked, and `LIMIT/OFFSET` silently skips and repeats rows when that happens.

- `limit` — 1 to 100, default 25. Outside the range is `400 request.invalid` with `details.parameter`.
- `cursor` — the previous page's `meta.next_cursor`. Opaque: clients echo it back and never construct one.
- `meta` carries `next_cursor` (null on the last page) and `has_more`, answered by reading one row beyond the page rather than by a separate count that would disagree with the page under concurrent writes.
- A cursor the endpoint did not issue is `400 request.invalid`, never a silent restart from the beginning — that would turn a client bug into an infinite loop that looks like a working list.

## Idempotent commands (`Idempotency-Key`)

A command endpoint marked idempotent in OpenAPI accepts an `Idempotency-Key`. The middleware over the existing `idempotency_keys` table gives it exactly these semantics:

- The key is scoped per endpoint and per caller, and is stored with a **fingerprint** of the request.
- A repeat with the same key and the same fingerprint **replays the original response envelope**, status included. The command does not run twice.
- A repeat with the same key and a **different** fingerprint is a client error and answers `409`, with a dedicated code introduced alongside the first endpoint that can raise it (phase C1).
- The client attaches a key deliberately, on the endpoints that document one. It is never attached automatically to every mutation, and never inferred server-side.

Until C1 no implemented endpoint accepts the header, so the `Idempotency-Key` row in the header table above also stays literally true until then.

## Lifecycle transitions

A change of lifecycle state is a **POST to a sub-resource action** — `POST …/publish`, `POST …/retire`, `POST …/approve` — never a `PATCH` carrying a `status` field.

Each action has its own permission and its own audit action, so "may edit this record" and "may publish it" are separately grantable and separately auditable, and the set of legal transitions lives in the routing table instead of in validation rules on a free-form field.

**One documented exception, introduced in K1.6.** `POST /api/v1/catalogue/items/{item}/publish` is guarded by `catalogue.publish_organisation` in the routing table *and* by `plan.publish_organisation` inside the action service when the item turns out to be a subscription plan. Middleware cannot branch on a row it has not loaded, and giving one action two URLs — `/items/{item}/publish` and `/plans/{item}/publish` — would give it two audit trails and two places for a gate to be forgotten. So the second code composes with the first rather than replacing it, and the check lives where the item type is known. Both seeded roles that may publish anything hold both codes, so no template role behaves differently; what the extra code buys is that a bespoke role can be granted authority over products and meals without acquiring authority over the commercial instrument a subscription is. The precedent is the cost-snapshot endpoint, which stacks `recipe.manage_organisation` inside `recipe.view_costs_organisation`.

## Implemented endpoints

The full set as implemented in Phase 4. `openapi/healthy360.v1.yaml` is authoritative for shapes.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/register` | — | Account, profile and consent grants in one transaction; sends the verification mail |
| POST | `/api/v1/auth/login` | — | Cookie session. Requires a first-party `Origin`. `data.two_factor_required` selects the next step |
| POST | `/api/v1/auth/logout` | session | |
| POST | `/api/v1/auth/token` | — | Native flow: personal access token bound to a device |
| POST | `/api/v1/auth/forgot-password` | — | Always 202. Link points at the client application |
| POST | `/api/v1/auth/reset-password` | — | No session is established |
| POST | `/api/v1/auth/email/verification-notification` | session or bearer | 202; 204 when already verified |
| GET | `/api/v1/auth/verify-email/{id}/{hash}` | session or bearer | Signed link; idempotent |
| POST | `/api/v1/auth/confirm-password` | session or bearer | Step-up confirmation |
| GET | `/api/v1/auth/confirmed-password-status` | session or bearer | Step-up state of the calling credential |
| POST | `/api/v1/auth/two-factor-challenge` | — | Completes a two-factor sign-in. Requires a first-party `Origin` |
| POST | `/api/v1/auth/two-factor-authentication` | session or bearer | Begin enrolment (secret + recovery codes) |
| POST | `/api/v1/auth/confirmed-two-factor-authentication` | session or bearer | Complete enrolment |
| DELETE | `/api/v1/auth/two-factor-authentication` | session or bearer | **Step-up protected** |
| GET | `/api/v1/auth/two-factor-qr-code` | session or bearer | |
| GET | `/api/v1/auth/two-factor-secret-key` | session or bearer | |
| GET | `/api/v1/auth/two-factor-recovery-codes` | session or bearer | |
| POST | `/api/v1/auth/two-factor-recovery-codes` | session or bearer | Regenerate |
| GET | `/api/v1/me` | session or bearer | Current user, profile, memberships, context, permissions, entitlements, pending consents. Reachable before verification |
| GET | `/api/v1/me/memberships` | session or bearer | Workspaces available to the user |
| PUT | `/api/v1/me/context` | session or bearer, verified | Select organisation/branch; server-validated and remembered |
| GET | `/api/v1/me/devices` | session or bearer, verified | Active devices |
| DELETE | `/api/v1/me/devices/{device}` | session or bearer, verified | **Step-up protected**. 204 |
| GET | `/api/v1/organisations/current` | session or bearer, verified | Organisation context probe; requires `organisation.view_current` |
| GET | `/api/v1/catalogue/ingredients` | session or bearer, verified, org | Cursor-paginated; the organisation's rows plus the platform library. Filters `query`, `status`, `category`. `catalogue.view_organisation` |
| POST | `/api/v1/catalogue/ingredients` | session or bearer, verified, org | Creates an `active`/`unverified` organisation row. `catalogue.manage_organisation` |
| GET | `/api/v1/catalogue/ingredients/{ingredient}` | session or bearer, verified, org | Returns `ETag: "<lock_version>"`. `catalogue.view_organisation` |
| PATCH | `/api/v1/catalogue/ingredients/{ingredient}` | session or bearer, verified, org | **`If-Match` required.** `catalogue.manage_organisation` |
| POST | `/api/v1/catalogue/ingredients/{ingredient}/archive` | session or bearer, verified, org | Lifecycle action. **`If-Match` required.** `catalogue.manage_organisation` |
| GET | `/api/v1/catalogue/ingredients/{ingredient}/allergens` | session or bearer, verified, org | Platform baseline and organisation overlay, each labelled. `catalogue.view_organisation` |
| PUT | `/api/v1/catalogue/ingredients/{ingredient}/allergens` | session or bearer, verified, org | Replaces the caller's layer for one market scope; upgrade-only over the baseline. `catalogue.manage_organisation` |
| GET | `/api/v1/catalogue/ingredients/{ingredient}/aliases` | session or bearer, verified, org | `catalogue.view_organisation` |
| POST | `/api/v1/catalogue/ingredients/{ingredient}/aliases` | session or bearer, verified, org | `catalogue.manage_organisation` |
| DELETE | `/api/v1/catalogue/ingredients/{ingredient}/aliases/{alias}` | session or bearer, verified, org | 204. `catalogue.manage_organisation` |
| GET | `/api/v1/catalogue/ingredient-categories` | session or bearer, verified, org | Flat two-level taxonomy, unpaginated. `catalogue.view_organisation` |
| POST | `/api/v1/catalogue/ingredient-categories` | session or bearer, verified, org | `catalogue.manage_organisation` |
| PATCH | `/api/v1/catalogue/ingredient-categories/{category}` | session or bearer, verified, org | No `If-Match` — categories carry no `lock_version`. `catalogue.manage_organisation` |
| GET | `/api/v1/catalogue/recipes` | session or bearer, verified, org | Cursor-paginated. Filters `query`, `status`, `category`. `published_version_number` is computed, not stored. `recipe.view_organisation` |
| POST | `/api/v1/catalogue/recipes` | session or bearer, verified, org | Creates the recipe **and** its draft version 1 in one transaction. `recipe.manage_organisation` |
| GET | `/api/v1/catalogue/recipes/{recipe}` | session or bearer, verified, org | Recipe plus its version summaries. Returns `ETag: "<lock_version>"`. `recipe.view_organisation` |
| PATCH | `/api/v1/catalogue/recipes/{recipe}` | session or bearer, verified, org | **`If-Match` required.** `recipe.manage_organisation` |
| POST | `/api/v1/catalogue/recipes/{recipe}/archive` | session or bearer, verified, org | Lifecycle action. Refused with `catalogue.in_use` while a published version exists. **`If-Match` required.** `recipe.manage_organisation` |
| GET | `/api/v1/catalogue/recipes/{recipe}/versions` | session or bearer, verified, org | Version history, unpaginated. `recipe.view_organisation` |
| POST | `/api/v1/catalogue/recipes/{recipe}/versions` | session or bearer, verified, org | Opens a draft, optionally `copy_from_version`. No `If-Match` — nothing existing is written. `recipe.manage_organisation` |
| GET | `/api/v1/catalogue/recipes/{recipe}/versions/{version}` | session or bearer, verified, org | Header, lines, outputs, steps and the frozen label. `{version}` accepts an identifier or a version number. **No cost fields** — those live only on the technical sheet. `recipe.view_organisation` |
| PATCH | `/api/v1/catalogue/recipes/{recipe}/versions/{version}` | session or bearer, verified, org | Draft or quarantined only; published/retired is `catalogue.version_immutable`. **`If-Match` required.** `recipe.manage_organisation` |
| PUT | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/lines` | session or bearer, verified, org | Set-replace; array order is the line sequence; duplicate ingredients allowed. Accepts `unit_cost_amount` + `cost_currency_code` per line (`line_cost_amount` is derived, never accepted); writing **or erasing** costs additionally requires `recipe.view_costs_organisation`. **`If-Match` (the version's) required.** `recipe.manage_organisation` |
| PUT | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/outputs` | session or bearer, verified, org | Set-replace; exactly one primary when non-empty. **`If-Match` required.** `recipe.manage_organisation` |
| PUT | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/steps` | session or bearer, verified, org | Set-replace; array order is the step sequence. **`If-Match` required.** `recipe.manage_organisation` |
| GET | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/allergens` | session or bearer, verified, org | Declared and derived label rows; `meta.derivation_state` says whether the label still matches the mappings. `recipe.view_organisation` |
| GET | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/readiness` | session or bearer, verified, org | A read of the publish gate — the same evaluator, so `publishable: true` is what the publish attempt will say. Reasons are `{code, detail, context}`; `allergen_unmapped` appears here as an ordinary reason though publication raises it as its own 422. No `If-Match`. `recipe.view_organisation`, deliberately not the publish code |
| POST | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/publish` | session or bearer, verified, org | Readiness gate, frozen label, demotion of the incumbent. **`If-Match` required.** `recipe.publish_organisation` |
| POST | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/retire` | session or bearer, verified, org | Terminal. **`If-Match` required.** `recipe.publish_organisation` |
| GET | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/technical-sheet` | session or bearer, verified, org | The only projection that serialises money. Lines with unit/line costs, the latest snapshot of each basis, `uncosted_line_numbers`. Audited as `catalogue.technical_sheet_viewed` (purpose `organisation_administration`, classification `confidential`). `recipe.view_costs_organisation` |
| GET | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/cost-snapshots` | session or bearer, verified, org | Cursor-paginated, **newest first**; the keyset runs over when a snapshot was recorded, not `calculated_at`. `recipe.view_costs_organisation` |
| POST | `/api/v1/catalogue/recipes/{recipe}/versions/{version}/cost-snapshots` | session or bearer, verified, org | Recomputes from the lines and appends. `basis` accepts `recalculated` only — `as_recorded` is importer-only. 422 with `uncosted_line_numbers` when incomplete; 409 when the version is retired. No `If-Match` (appends beside the version, never mutates it). **Both** `recipe.manage_organisation` and `recipe.view_costs_organisation` |
| GET | `/api/v1/catalogue/sales-channels` | session or bearer, verified, org | Unpaginated; inactive channels included. `catalogue.view_organisation` |
| POST | `/api/v1/catalogue/sales-channels` | session or bearer, verified, org | Always created `active`. A duplicate `code` is 409. `catalogue.manage_organisation` |
| GET | `/api/v1/catalogue/sales-channels/{channel}` | session or bearer, verified, org | `{channel}` accepts an identifier or the `code`. Returns `ETag: "<lock_version>"`. `catalogue.view_organisation` |
| PATCH | `/api/v1/catalogue/sales-channels/{channel}` | session or bearer, verified, org | `code` and `channel_kind` are immutable and not accepted; `status` **is** — a channel is operational configuration, not published content. **`If-Match` required.** `catalogue.manage_organisation` |
| GET | `/api/v1/catalogue/items` | session or bearer, verified, org | Cursor-paginated. Filters `query`, `status`, `item_type`, `product_category_id`. Retired excluded unless asked for. **No price, cost or margin field exists.** `catalogue.view_organisation` |
| POST | `/api/v1/catalogue/items` | session or bearer, verified, org | Creates a `draft`; slug derived and thereafter immutable; `catalogue_id` optional (a `default` catalogue is created on demand). `catalogue.manage_organisation` |
| GET | `/api/v1/catalogue/items/{item}` | session or bearer, verified, org | `{item}` accepts an identifier or the `slug`. Item plus variants, ingredients, diet-tag codes and channel assignments. Returns `ETag: "<lock_version>"`. `catalogue.view_organisation` |
| PATCH | `/api/v1/catalogue/items/{item}` | session or bearer, verified, org | `slug` and `item_type` are **rejected**, not ignored. A published item stays editable; a retired one is 409. **`If-Match` required.** `catalogue.manage_organisation` |
| POST | `/api/v1/catalogue/items/{item}/publish` | session or bearer, verified, org | Readiness gate; response carries the derived allergen set. A **subscription plan** additionally needs `plan.publish_organisation` and additionally checks its profile, matrix, durations and **confirmed prices on every active configuration**. **`If-Match` required.** `catalogue.publish_organisation` |
| POST | `/api/v1/catalogue/items/{item}/retire` | session or bearer, verified, org | Terminal, and the only withdrawal a sellable item has — available from `draft` too. Optional `reason` is audited. **`If-Match` required.** `catalogue.publish_organisation` |
| PUT | `/api/v1/catalogue/items/{item}/variants` | session or bearer, verified, org | Set-replace matched on `code`; absent codes are **archived**, not deleted; `variant_type` derived from the item; exactly one default. **`If-Match` (the item's) required.** `catalogue.manage_organisation` |
| PUT | `/api/v1/catalogue/items/{item}/ingredients` | session or bearer, verified, org | Set-replace; array order is `display_order`; **no quantity field exists**. Also a meal's fallback allergen basis. **`If-Match` required.** `catalogue.manage_organisation` |
| PUT | `/api/v1/catalogue/items/{item}/diet-classifications` | session or bearer, verified, org | Set-replace by platform **code**; an unknown or inactive code is 422 with `details.unknown`. **`If-Match` required.** `catalogue.manage_organisation` |
| PUT | `/api/v1/catalogue/items/{item}/channels` | session or bearer, verified, org | Set-replace; optional per-variant rows; dates not timestamps; no price. **`If-Match` required.** `catalogue.manage_organisation` |
| GET | `/api/v1/catalogue/items/{item}/allergens` | session or bearer, verified, org | Derived on read, never stored and never authored — **no writer exists**. `meta.basis` is `recipe_version`, `item_ingredients` or `none` ("nobody has said", not "no allergens"). `catalogue.view_organisation` |
| GET | `/api/v1/catalogue/items/{item}/readiness` | session or bearer, verified, org | A read of the publish gate — the same evaluator, so `publishable: true` is what the publish attempt will say. Reasons are `{code, detail, context}`, plan reasons included. A verdict about the **data**, never about authority: a plan still needs `plan.publish_organisation` to publish. No `If-Match`. `catalogue.view_organisation`, deliberately not the publish code |
| GET | `/api/v1/catalogue/price-lists` | session or bearer, verified, org | Cursor-paginated. Filters `query`, `status`, `customer_scope`. Archived excluded unless asked for. **No amounts** — the header carries a currency, never a price. `price_list.view_organisation` |
| POST | `/api/v1/catalogue/price-lists` | session or bearer, verified, org | Creates a `draft`; `currency_code` required and upper-cased, no default; duplicate `code` is 409. `price_list.manage_organisation` |
| GET | `/api/v1/catalogue/price-lists/{priceList}` | session or bearer, verified, org | `{priceList}` accepts an identifier or the `code`. List plus channel assignments; `meta.entry_counts` gives standing and confirmed counts. Returns `ETag: "<lock_version>"`. `price_list.view_organisation` |
| PATCH | `/api/v1/catalogue/price-lists/{priceList}` | session or bearer, verified, org | `code` is **rejected**, not ignored. `currency_code` moves only while the list holds no rows at all (history included), then 409 `reason: currency_locked`. **`If-Match` required.** `price_list.manage_organisation` |
| POST | `/api/v1/catalogue/price-lists/{priceList}/publish` | session or bearer, verified, org | Draft → active. Blocked only by `no_open_rows` / `price_list_not_a_draft` — placeholder and market rows are welcome on an active list. **`If-Match` required.** `catalogue.publish_organisation` |
| POST | `/api/v1/catalogue/price-lists/{priceList}/archive` | session or bearer, verified, org | Refused while a channel still names it (409 `reason: channel_assignments_active`). Nothing is deleted. **`If-Match` required.** `catalogue.publish_organisation` |
| GET | `/api/v1/catalogue/price-lists/{priceList}/entries` | session or bearer, verified, org | Cursor-paginated. Standing rows by default; `include_history=1` adds closed rows and walks **newest-first**. Amounts are integer minor units with `currency_code` on every row, never formatted. Placeholder/market rows served in full. `price_list.view_organisation` |
| PUT | `/api/v1/catalogue/price-lists/{priceList}/entries` | session or bearer, verified, org | Set-replace over effective-dated storage: the body is the desired **current** state, keyed by `(item, variant, min_quantity)`; unchanged points are untouched, changed ones close and reopen, absent ones close. No dates in the body. **`If-Match` (the list's) required.** `price_list.manage_organisation` |
| PUT | `/api/v1/catalogue/price-lists/{priceList}/channels` | session or bearer, verified, org | Set-replace; **array order is the priority**, lowest consulted first; empty detaches everything. **`If-Match` required.** `price_list.manage_organisation` |
| GET | `/api/v1/catalogue/plan-vocabulary/combinations` | session or bearer, verified, org | Unpaginated; deactivated rows served **with** their flag, there being no delete. `includes_*` and `meals_per_day` are different facts. `plan.manage_organisation` |
| POST | `/api/v1/catalogue/plan-vocabulary/combinations` | session or bearer, verified, org | Duplicate `code` in the organisation is 409; the same code in another kitchen is not a collision. A combination covering no sitting is 422. `plan.manage_organisation` |
| PATCH | `/api/v1/catalogue/plan-vocabulary/combinations/{combination}` | session or bearer, verified, org | No `If-Match` — vocabulary rows carry no `lock_version`. `code` is **rejected**, not ignored. `is_active: false` is the only withdrawal there is. `plan.manage_organisation` |
| GET | `/api/v1/catalogue/plan-vocabulary/energy-bands` | session or bearer, verified, org | Unpaginated, ordered lowest bracket first. A band, never a per-person target. `plan.manage_organisation` |
| POST | `/api/v1/catalogue/plan-vocabulary/energy-bands` | session or bearer, verified, org | `max_kcal` strictly above `min_kcal`. `plan.manage_organisation` |
| PATCH | `/api/v1/catalogue/plan-vocabulary/energy-bands/{band}` | session or bearer, verified, org | No `If-Match`; `code` rejected. One end alone may be submitted — the comparison runs against the merged row. `plan.manage_organisation` |
| GET | `/api/v1/catalogue/plan-vocabulary/durations` | session or bearer, verified, org | Unpaginated, **one-off first**. `duration_kind` carries the meaning, `duration_days` the number; there is no zero-day row (§4.3). `plan.manage_organisation` |
| POST | `/api/v1/catalogue/plan-vocabulary/durations` | session or bearer, verified, org | `duration_days` required for `fixed_days`, refused for `one_off`; `0` is 422 with a message about the removed sentinel. A CHECK enforces the same underneath. `plan.manage_organisation` |
| PATCH | `/api/v1/catalogue/plan-vocabulary/durations/{duration}` | session or bearer, verified, org | No `If-Match`; `code` rejected. The kind/days rule applies to the **merged** row, so turning a run into a one-off means sending `duration_days: null` too. `plan.manage_organisation` |
| GET | `/api/v1/catalogue/plans/{item}/profile` | session or bearer, verified, org | `profile` is **null** when nobody has written terms — the state the publish gate refuses, never filled in with defaults. A non-plan item is 422, not 404. Returns the item's `ETag`. The one plan read that is not commercial: `catalogue.view_organisation` |
| PUT | `/api/v1/catalogue/plans/{item}/profile` | session or bearer, verified, org | Whole-document PUT; omitted fields take their defaults (`both`, `per_day`, skippable, pausable, **24 h**). `change_cutoff_hours: 0` is accepted. **`If-Match` (the item's) required.** `plan.manage_organisation` |
| GET | `/api/v1/catalogue/plans/{item}/variants` | session or bearer, verified, org | The configuration matrix; each cell carries the `catalogue_item_variant_id` a price points at, its `code` and its `status`. Archived cells included. `plan.manage_organisation` |
| PUT | `/api/v1/catalogue/plans/{item}/variants` | session or bearer, verified, org | Set-replace of **cells**; each writes a variant + its plan profile atomically. Code derived `combination-tier[-band]` unless supplied. Absent cells **archived**, their coordinates still occupied — a second configuration at an occupied cell is 409 naming the occupant. **`If-Match` (the item's) required.** `plan.manage_organisation` |
| GET | `/api/v1/catalogue/plans/{item}/variant-durations` | session or bearer, verified, org | `discount_percent` is **null** where nobody stated one, never `"0.00"`; `meta.unstated_discount_count` counts them. `plan.manage_organisation` |
| PUT | `/api/v1/catalogue/plans/{item}/variant-durations` | session or bearer, verified, org | Set-replace; rows name configuration and duration by identifier **or** code. Absent rows deleted; `is_available: false` keeps the negotiated discount. NULL discounts survive the round trip and are never coerced to 0. **`If-Match` (the item's) required.** `plan.manage_organisation` |
| GET | `/api/v1/catalogue/delivery-zones` | session or bearer, verified, org | Cursor-paginated. Filters `status`, `branch_id` (a branch identifier or the literal `organisation`), `query`. Archived excluded unless asked for. Areas are not embedded. `delivery_zone.manage_organisation` |
| POST | `/api/v1/catalogue/delivery-zones` | session or bearer, verified, org | Created `active` and covering nowhere. `currency_code` optional — defaults to the organisation's. A duplicate `code` is 409. `delivery_zone.manage_organisation` |
| GET | `/api/v1/catalogue/delivery-zones/{zone}` | session or bearer, verified, org | `{zone}` accepts an identifier or the `code`. Returns `ETag: "<lock_version>"`; `meta.area_count` counts the map without fetching it. `delivery_zone.manage_organisation` |
| PATCH | `/api/v1/catalogue/delivery-zones/{zone}` | session or bearer, verified, org | `code` and `status` are **rejected**, not ignored; `is_active` is the reversible suspension. Changing `branch_id` re-scopes the zone **and its area claims** in one transaction, 409 `area_already_served` if the destination is taken. **`If-Match` required.** `delivery_zone.manage_organisation` |
| POST | `/api/v1/catalogue/delivery-zones/{zone}/archive` | session or bearer, verified, org | Terminal, and it **releases the area claims** so a replacement zone can take them. Suspension keeps them. Nothing is deleted. No customer-address check exists yet — J1 adds it. **`If-Match` required.** `delivery_zone.manage_organisation` |
| GET | `/api/v1/catalogue/delivery-zones/{zone}/areas` | session or bearer, verified, org | Unpaginated; platform areas in admin shape with `is_active`. `meta.inactive_area_count` flags places the platform has since withdrawn. `delivery_zone.manage_organisation` |
| PUT | `/api/v1/catalogue/delivery-zones/{zone}/areas` | session or bearer, verified, org | Set-replace; absent areas are released. **One area, one zone per branch** — a collision at the same scope is 409 `area_already_served` naming the occupying zone, and an organisation-wide zone may coexist with a branch zone (the branch wins). Another country is 422 `area_country_mismatch`; a withdrawn area is 422 `area_inactive` unless already claimed. **`If-Match` (the zone's) required.** `delivery_zone.manage_organisation` |
| GET | `/api/v1/catalogue/delivery-windows` | session or bearer, verified, org | Unpaginated; deactivated windows served **with** their flag. `weekdays: []` means every day. `delivery_zone.manage_organisation` |
| POST | `/api/v1/catalogue/delivery-windows` | session or bearer, verified, org | Times are paired (both or neither) and the end is strictly after the start — no overnight windows. All seven weekdays normalise to `[]`. `delivery_zone.manage_organisation` |
| PATCH | `/api/v1/catalogue/delivery-windows/{window}` | session or bearer, verified, org | No `If-Match` — windows carry no `lock_version`. `code` rejected. The time rules run against the **merged** row. `is_active: false` is the only withdrawal. `delivery_zone.manage_organisation` |
| GET | `/api/v1/kitchen/branch-operating` | session or bearer, verified, org, **branch** | The current branch's week, in weekday order. Unconfigured days are **absent**, never invented; `meta.is_complete` says so. No branch selected is 400 `context.branch_required`. `branch.view_current` |
| PUT | `/api/v1/kitchen/branch-operating` | session or bearer, verified, org, **branch** | Set-replace of the whole week in one transaction — no `If-Match`, because there is no half-week to protect. A closed day is a row with no times; an empty `days` clears the week. Per-row rules: both times or neither, close after open, no cut-off on a closed day. `branch.manage_current` |
| GET | `/api/v1/reference/allergen-classes` | — | **Anonymous.** Active classes only, one server-localised name from `Accept-Language` |
| POST | `/api/v1/reference/allergen-classes` | session or bearer, verified, platform org | `platform.context` + `reference.manage_platform` |
| PATCH | `/api/v1/reference/allergen-classes/{code}` | session or bearer, verified, platform org | `code` is immutable and a request carrying it is rejected. `platform.context` + `reference.manage_platform` |
| POST | `/api/v1/reference/allergen-classes/{code}/deactivate` | session or bearer, verified, platform org | No DELETE exists. `platform.context` + `reference.manage_platform` |
| GET | `/api/v1/reference/diet-classifications` | — | **Anonymous.** Active classifications only, one server-localised name from `Accept-Language`. A preference filter, never a medical restriction — what a dish contains is the allergen list |
| GET | `/api/v1/reference/delivery-areas` | — | **Anonymous** — J1 asks for a delivery area before an account exists. `country_code` **required** (codes are unique per country, not globally); an unknown one is 400, not an empty page. Cursor-paginated, unlike the other two public vocabularies. Active areas only, one server-localised name. `region` is carried and is null on every row (OD-12) |

No authentication action depends on Inertia views, and no endpoint issues a redirect.

## Rate limits

| Limiter | Budget | Key | Applied to |
|---|---|---|---|
| `api` | 60/min | Authenticated user, else IP | Every `/api` route |
| login | 5/min | Email + IP | `POST /auth/login` (inside the authentication pipeline, so a lockout raises `Illuminate\Auth\Events\Lockout` and is audited) and `POST /auth/token`, which shares the key |
| `two-factor` | 5/min | Pending sign-in, else IP | `POST /auth/two-factor-challenge` |
| `forgot-password` | 3/min | Email | `POST /auth/forgot-password` |
| `verification` | 6/min | Authenticated user, else IP | Email verification send and verify |

Every rejection is `429 rate_limit.exceeded` with `Retry-After`.

## General rules

- Authentication: Sanctum cookie session for first-party origins; personal access tokens for native clients. Both are accepted by `auth:sanctum`.
- All identifiers in payloads are UUIDv7 strings (ISO codes for reference data).
- Timestamps are RFC 3339 UTC; localisation happens client-side.
- Responses never leak other tenants' identifiers, even in error messages. An organisation the caller is not a member of and an organisation that does not exist are both `context.organisation_forbidden`; another person's device and a device that never existed are both `resource.not_found`.
- Authentication activity is audited (`auth.login_succeeded`, `auth.login_failed`, `auth.login_locked_out`, `auth.logout`, `auth.password_reset`, `auth.step_up_confirmed`, `auth.step_up_failed`, `auth.two_factor_*`, `auth.device_revoked`) with the correlation identifier. Passwords, tokens and two-factor codes are never written to audit metadata.
- **Money is an integer of minor units plus a currency, never a formatted string and never a float.** `{"unit_amount_minor": 4500, "currency_code": "AED"}`, not `"45.00 AED"` and not `45.0`. A float loses money at the fourth decimal of a currency that has three; a server-formatted string picks a locale and a symbol position on behalf of a client that already knows the user's locale and this one does not; and a formatted amount has to be parsed back before it can be added up, which is where the rounding goes wrong. The client formats. Every amount carries or inherits exactly one currency, and no endpoint performs cross-currency arithmetic (master plan v2 §4.4).
- Audit metadata keys avoid the substrings `password`, `token`, `secret`, `code`, `authorization` and `cookie`, because `AuditRecorder` matches its redaction list as a substring (OQ-036 / R-018). A currency is therefore recorded under `currency`, not `currency_code` — the over-match would otherwise erase the one fact that makes an amount meaningful.
