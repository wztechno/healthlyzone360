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
| Client → server | `If-Match` | Optimistic concurrency | **Only on resources supporting it** (those with `lock_version` — see ERD). Mismatch returns `409` with `resource.conflict`. No implemented endpoint accepts it yet |
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
| `authz.permission_denied` | 403 | The six-step RBAC decision denied. `details.reason` names the denying step, `details.permission` the code |
| `request.invalid` | 400 | The request cannot be processed as sent (for example a session endpoint without a first-party `Origin`) |
| `resource.not_found` | 404 | The resource does not exist, or is not the caller's to see |
| `resource.conflict` | 409 | The change conflicts with the current state |
| `rate_limit.exceeded` | 429 | A rate limit was exceeded. Served with `Retry-After` |
| `server.internal_error` | 500 | Anything unrecognised. Safe message only; never a message or trace from the underlying exception |

Namespaces: `auth.*` authentication state · `authz.*` permission denial (RBAC steps 4–6) · `context.*` organisation and branch context · `resource.*` resource state · `validation.*` input · `request.*` malformed request · `rate_limit.*` throttling · `server.*` faults.

Separated authorisation concerns (context, entitlement, consent, relationship, step-up, email verification — plan §10) each surface a **distinct** code; they are never collapsed into a generic permission denial. Within `authz.permission_denied` the exact RBAC step is reported in `details.reason` (`unauthenticated`, `membership_inactive`, `branch_out_of_scope`, `permission_not_granted`, `resource_outside_organisation`, `policy_denied`).

**Specific rule — step-up authentication**: when a sensitive action requires recent password confirmation, the API returns **HTTP 403** with `error.code = auth.step_up_required` and `details.confirmation_endpoint`. It does **not** use HTTP 423. The step-up protected endpoints are:

- `DELETE /api/v1/me/devices/{device}`
- `DELETE /api/v1/auth/two-factor-authentication`

A confirmation is bound to the credential that performed it — the session for cookie clients, the personal access token for bearer clients — and lapses after `auth.password_timeout` seconds. `GET /api/v1/auth/confirmed-password-status` reports the current state.

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
