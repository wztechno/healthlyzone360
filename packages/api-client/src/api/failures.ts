import type { ApiFailure, ValidationFields } from '../contracts/failure.ts';
import {
    apiFailure,
    conflictFailure,
    permissionDeniedFailure,
    rateLimitFailure,
    validationFailure,
} from '../contracts/failure.ts';
import type { ErrorCode, ErrorEnvelope } from '../generated/types.ts';

/**
 * Backend error envelope → the `ApiFailure` union the screens already branch on.
 *
 * The union is deliberately *not* the backend vocabulary. It is the set of outcomes a screen can
 * usefully do something different about, and the mock repositories reject with exactly the same
 * codes — that identity is what makes a screen transport-agnostic (plan §18). Anything the union
 * does not carry therefore has to be projected onto something it does, and every such projection is
 * named below rather than left to a `default:` branch.
 */

/** `error.details`, as far as anything here cares about it. */
interface ErrorDetails {
    readonly fields?: unknown;
    readonly retry_after_seconds?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows an unknown parsed body to the documented envelope. */
export function asErrorEnvelope(body: unknown): ErrorEnvelope | null {
    if (!isRecord(body) || !isRecord(body['error'])) return null;
    const error = body['error'];
    if (typeof error['code'] !== 'string' || typeof error['message'] !== 'string') return null;
    return body as unknown as ErrorEnvelope;
}

/** `details.fields` → the `field → messages` map React Hook Form consumes. */
export function readValidationFields(details: unknown): ValidationFields {
    if (!isRecord(details) || !isRecord(details['fields'])) return {};

    const fields: Record<string, readonly string[]> = {};
    for (const [field, messages] of Object.entries(details['fields'])) {
        if (Array.isArray(messages)) {
            fields[field] = messages.filter(
                (message): message is string => typeof message === 'string',
            );
        } else if (typeof messages === 'string') {
            fields[field] = [messages];
        }
    }
    return fields;
}

/** A `details` member that has to be a string to be worth showing; `''` when it is not one. */
function readDetailString(details: unknown, key: string): string {
    if (!isRecord(details)) return '';
    const value = details[key];
    return typeof value === 'string' ? value : '';
}

/**
 * `details.current_lock_version` → the number an editor compares its local copy against.
 *
 * `undefined` rather than `0` when the server did not send one: a conflict with no version is a
 * real case (a duplicate slug, a second publish), and a fabricated zero would make the editor
 * claim the row had been reset.
 */
function readCurrentLockVersion(details: unknown): number | undefined {
    if (!isRecord(details)) return undefined;
    const value = details['current_lock_version'];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readRetryAfter(headerValue: string | null, details: unknown): number {
    const fromHeader = headerValue === null ? Number.NaN : Number.parseInt(headerValue, 10);
    if (Number.isFinite(fromHeader) && fromHeader >= 0) return fromHeader;

    const fromDetails = isRecord(details)
        ? (details as ErrorDetails).retry_after_seconds
        : undefined;
    if (typeof fromDetails === 'number' && Number.isFinite(fromDetails)) return fromDetails;

    // The limiter windows are all one minute (docs/api/conventions.md §Rate limits), so a missing
    // `Retry-After` is a full window rather than "try again immediately".
    return 60;
}

/**
 * Codes that exist one-for-one in both vocabularies.
 *
 * The projections that are *not* one-for-one:
 *
 * | wire code                  | becomes                    | why                                        |
 * |----------------------------|----------------------------|--------------------------------------------|
 * | `auth.two_factor_invalid`  | `validation.failed` (code) | exactly what the mock does: the field is wrong, not the session |
 * | `auth.csrf_token_mismatch` | `auth.unauthenticated`     | session-only; a bearer client that sees it has no usable credential |
 * | anything else              | `server`                   | see `mapErrorEnvelope` |
 *
 * `authz.permission_denied` and `resource.conflict` are one-for-one too, but they carry structured
 * detail and so get their own branches in `mapErrorEnvelope` rather than a row here — the same
 * reason `validation.failed` and `rate_limit.exceeded` are excluded from the derived type below.
 *
 * `request.precondition_required` is listed even though the *current* generated `ErrorCode` union
 * has no such member: the backend enum gains it with K1's first `If-Match`-guarded endpoint (plan
 * §4.13/§4.17), and having the row here already means the day it appears on the wire the client
 * speaks it rather than flattening a 428 onto `server`.
 */
const DIRECT_CODES = {
    'validation.failed': 'validation.failed',
    'auth.unauthenticated': 'auth.unauthenticated',
    'auth.invalid_credentials': 'auth.invalid_credentials',
    'auth.email_unverified': 'auth.email_unverified',
    'auth.two_factor_required': 'auth.two_factor_required',
    'auth.step_up_required': 'auth.step_up_required',
    'context.organisation_required': 'context.organisation_required',
    'context.organisation_forbidden': 'context.organisation_forbidden',
    'context.branch_out_of_scope': 'context.branch_out_of_scope',
    'resource.not_found': 'resource.not_found',
    'request.precondition_required': 'request.precondition_required',
    'rate_limit.exceeded': 'rate_limit.exceeded',
} as const;

export interface ErrorEnvelopeContext {
    readonly status: number;
    readonly retryAfterHeader?: string | null | undefined;
    readonly correlationIdHeader?: string | null | undefined;
}

/**
 * The single place a `4xx`/`5xx` becomes an `ApiFailure`.
 *
 * Unmapped codes (`request.invalid`, `auth.invalid_signature`, `server.internal_error`) become
 * `server` while keeping the **server's own message and correlation identifier**, so the person
 * still sees a true sentence and support can still find the request. `retryable` follows the status
 * class: repeating a rejected `4xx` unchanged cannot help, a `5xx` might.
 *
 * None of those codes is reachable from an implemented repository call today. When one becomes
 * reachable, it earns a place in `API_FAILURE_CODES` rather than a wider `default:` — which is
 * exactly what happened to `authz.permission_denied`, `resource.not_found` and `resource.conflict`
 * when the kitchen-admin contract arrived.
 */
export function mapErrorEnvelope(body: unknown, context: ErrorEnvelopeContext): ApiFailure {
    const envelope = asErrorEnvelope(body);
    const correlationId = envelope?.error.correlation_id ?? context.correlationIdHeader ?? null;

    if (envelope === null) {
        return apiFailure('server', {
            correlationId,
            retryable: context.status >= 500,
        });
    }

    const { code, message, details } = envelope.error;

    if (code === 'validation.failed') {
        return validationFailure(readValidationFields(details), { message, correlationId });
    }

    if (code === 'auth.two_factor_invalid') {
        const fields = readValidationFields(details);
        return validationFailure(Object.keys(fields).length > 0 ? fields : { code: [message] }, {
            message,
            correlationId,
        });
    }

    if (code === 'rate_limit.exceeded') {
        return rateLimitFailure(readRetryAfter(context.retryAfterHeader ?? null, details), {
            message,
            correlationId,
        });
    }

    if (code === 'auth.csrf_token_mismatch') {
        return apiFailure('auth.unauthenticated', { message, correlationId });
    }

    if (code === 'authz.permission_denied') {
        return permissionDeniedFailure(
            readDetailString(details, 'permission'),
            readDetailString(details, 'reason'),
            { message, correlationId },
        );
    }

    if (code === 'resource.conflict') {
        const currentLockVersion = readCurrentLockVersion(details);
        return conflictFailure({
            ...(currentLockVersion === undefined ? {} : { currentLockVersion }),
            message,
            correlationId,
        });
    }

    const direct = DIRECT_CODES[code as keyof typeof DIRECT_CODES] as
        Exclude<keyof typeof DIRECT_CODES, 'validation.failed' | 'rate_limit.exceeded'> | undefined;

    if (direct !== undefined) return apiFailure(direct, { message, correlationId });

    return apiFailure('server', {
        message,
        correlationId,
        retryable: context.status >= 500,
    });
}

/** Every wire code, so a spec change that adds one is caught by the compiler in a test. */
export const WIRE_ERROR_CODES: readonly ErrorCode[] = [
    'validation.failed',
    'auth.unauthenticated',
    'auth.invalid_credentials',
    'auth.email_unverified',
    'auth.two_factor_required',
    'auth.two_factor_invalid',
    'auth.step_up_required',
    'auth.csrf_token_mismatch',
    'auth.invalid_signature',
    'context.organisation_required',
    'context.organisation_forbidden',
    'context.branch_out_of_scope',
    'authz.permission_denied',
    'request.invalid',
    'resource.not_found',
    'resource.conflict',
    'rate_limit.exceeded',
    'server.internal_error',
];
