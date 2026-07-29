# API Conventions

Wire-level conventions for the Healthy360 JSON API. The OpenAPI 3.1 document is the authoritative contract for implemented endpoints (ADR-0005); this document fixes the conventions that every endpoint follows.

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
    "correlation_id": "req_01j9x7q2v8"
  }
}
```

Collections return `data` as an array; pagination, counts and similar belong in `meta`.

**Error**

```json
{
  "error": {
    "code": "tenancy.branch_not_in_scope",
    "message": "The selected branch is not within your membership scope.",
    "details": {},
    "correlation_id": "req_01j9x7q2v8"
  }
}
```

`message` is a safe, translatable human summary — never a stack trace. `details` carries structured, code-specific data (for `validation.failed`: a `fields` map of field → error codes).

**Envelope exceptions** (documented, deliberate): `204 No Content` responses; file downloads; streaming responses; health-check endpoints.

## Headers

| Direction | Header | Purpose | Notes |
|---|---|---|---|
| Client → server | `X-Organisation-Id` | Active organisation context | Never trusted without server-side validation against active membership |
| Client → server | `X-Branch-Id` | Active branch context | Only where the workflow is branch-scoped; validated against membership scope |
| Client → server | `Accept-Language` | Locale negotiation | `en`, `ar` (with regional subtags accepted) |
| Client → server | `X-Client-Request-Id` | Client-generated request identifier for support correlation | Opaque; echoed into logs, not into responses |
| Client → server | `X-App-Mode` | Build family (`customer`, `staff`, `kiosk`, `driver`, `all-dev`) | Diagnostic; never an authorisation input |
| Client → server | `X-Client-Version` | App version for diagnostics and deprecation telemetry | |
| Client → server | `X-Client-Platform` | `web`, `ios`, `android` | |
| Client → server | `Idempotency-Key` | De-duplication of retried commands | **Only on explicitly idempotent command endpoints** (marked in OpenAPI). Do not attach automatically to every mutation. Keys are scoped per endpoint per user; replays return the original response |
| Client → server | `If-Match` | Optimistic concurrency | **Only on resources supporting it** (those with `lock_version` — see ERD). Mismatch returns `409` with `resource.version_conflict` |
| Server → client | `X-Correlation-Id` | Server-generated correlation identifier | Generated per request, returned on every response, embedded in `meta`/`error` and in audit logs |

## Error code namespaces

Codes are stable, machine-readable, dot-separated: `namespace.specific_condition`. Clients branch on `code`, never on `message`.

| Namespace | Meaning | Typical HTTP | Examples |
|---|---|---|---|
| `auth.*` | Authentication state | 401, 403 | `auth.unauthenticated`, `auth.email_unverified`, `auth.invalid_credentials`, `auth.two_factor_required`, `auth.step_up_required` |
| `authz.*` | Permission denial (RBAC step 4–6) | 403 | `authz.permission_missing`, `authz.policy_denied` |
| `tenancy.*` | Organisation/branch context problems | 403, 422 | `tenancy.context_missing`, `tenancy.membership_inactive`, `tenancy.branch_not_in_scope`, `tenancy.resource_outside_organisation` |
| `resource.*` | Resource state | 404, 409, 410 | `resource.not_found`, `resource.version_conflict`, `resource.gone` |
| `validation.*` | Input validation | 422 | `validation.failed` (field detail in `details.fields`) |
| `rate_limit.*` | Throttling | 429 | `rate_limit.exceeded` (with `Retry-After`) |
| `server.*` | Server faults | 500, 503 | `server.internal`, `server.unavailable` |

Separated authorisation concerns (entitlement, consent, relationship, step-up — plan §10) each surface a **distinct** code; they are never collapsed into a generic `authz.permission_missing`.

**Specific rule — step-up authentication**: when a sensitive action requires recent password confirmation (or equivalent), the API returns **HTTP 403** with `error.code = auth.step_up_required`. It does **not** use HTTP 423.

## Initial endpoints (plan §14)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/register` | Fortify JSON |
| POST | `/api/v1/auth/login` | Web session (cookie) or token flow |
| POST | `/api/v1/auth/logout` | |
| POST | `/api/v1/auth/forgot-password` | |
| POST | `/api/v1/auth/reset-password` | |
| POST | `/api/v1/auth/email/verification-notification` | Resend verification |
| GET | `/api/v1/auth/verify-email/{id}/{hash}` | Signed verification link |
| GET | `/api/v1/me` | Current user, context, permissions, entitlements |
| GET | `/api/v1/me/memberships` | Organisations/branches available to the user |
| PUT | `/api/v1/me/context` | Select organisation/branch; server-validated |
| GET | `/api/v1/me/devices` | Registered devices |
| DELETE | `/api/v1/me/devices/{device}` | Revoke a device/token |

Additional Fortify two-factor routes (enrolment, confirmation, challenge, recovery codes) follow the same `/api/v1/auth/*` convention and envelope rules. No authentication action depends on Inertia views.

## General rules

- Authentication: Sanctum cookie session for web; personal access tokens for native clients.
- All identifiers in payloads are UUIDv7 strings (ISO codes for reference data).
- Timestamps are RFC 3339 UTC; localisation happens client-side.
- Responses never leak other tenants' identifiers, even in error messages.
