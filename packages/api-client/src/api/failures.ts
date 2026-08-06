import type { ApiFailure, SubscriptionRefusal, ValidationFields } from '../contracts/failure.ts';
import {
    apiFailure,
    closureRefusedFailure,
    conflictFailure,
    offboardingRefusedFailure,
    orderPlacementRefusedFailure,
    otpCooldownFailure,
    otpInvalidFailure,
    otpLockedFailure,
    permissionDeniedFailure,
    rateLimitFailure,
    settlementOutstandingFailure,
    subscriptionRefusedFailure,
    validationFailure,
} from '../contracts/failure.ts';
import { OTP_CHANNELS } from '../contracts/verification.ts';
import type { OtpChannel } from '../contracts/verification.ts';
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

/**
 * `details.attempts_remaining` → the number the panel prints after a wrong code.
 *
 * `0` when the server did not send one, and that is the safe direction rather than the convenient
 * one: a missing count means the client cannot promise another try, and a panel that invented a
 * spare attempt would invite the keystroke that locks the account.
 */
function readAttemptsRemaining(details: unknown): number {
    if (!isRecord(details)) return 0;
    const value = details['attempts_remaining'];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * `details.locked_until` → when the lockout lifts.
 *
 * Falls back to *now* rather than to a fabricated future instant. A lockout screen counting down
 * from a number nobody sent would be counting down to nothing; showing it as already lifted at
 * least makes the missing field visible the moment somebody presses the button and is refused
 * again.
 */
function readLockedUntil(details: unknown): string {
    const value = isRecord(details) ? details['locked_until'] : undefined;
    return typeof value === 'string' && value !== '' ? value : new Date().toISOString();
}

/**
 * `details.available_channels` → the escape hatch a lockout offers.
 *
 * The wire sends either bare strings or `{ channel, simulated }` objects depending on the endpoint,
 * so both are read. Anything that is not a channel this build knows is dropped: an empty list is a
 * statement the screen can make ("there is nothing else to try"), and a list containing a string
 * nobody can render is not.
 */
function readAvailableChannels(details: unknown): readonly OtpChannel[] {
    const raw = isRecord(details) ? details['available_channels'] : undefined;
    if (!Array.isArray(raw)) return [];

    const channels: OtpChannel[] = [];
    for (const entry of raw) {
        const candidate =
            typeof entry === 'string' ? entry : isRecord(entry) ? entry['channel'] : undefined;
        if (typeof candidate !== 'string') continue;
        if ((OTP_CHANNELS as readonly string[]).includes(candidate))
            channels.push(candidate as OtpChannel);
    }
    return channels;
}

/**
 * `details.reasons` → the list a configurator, or a checkout, draws.
 *
 * Each entry is `{ reason, ...context }` on the wire, and the split is done here rather than in the
 * screen: `reason` is lifted out and *everything else is kept verbatim*, because what travels
 * beside a reason differs per reason and is precisely what makes the sentence specific. An entry
 * with no string `reason` is dropped — there is nothing a screen could say about it — and a
 * `details.reasons` that is not an array yields the empty list, which the failure carries honestly.
 */
function readRefusalReasons(details: unknown): readonly SubscriptionRefusal[] {
    const raw = isRecord(details) ? details['reasons'] : undefined;
    if (!Array.isArray(raw)) return [];

    const reasons: SubscriptionRefusal[] = [];
    for (const entry of raw) {
        if (!isRecord(entry)) continue;
        const reason = entry['reason'];
        if (typeof reason !== 'string' || reason === '') continue;

        const { reason: _lifted, ...context } = entry;
        reasons.push({ reason, context });
    }
    return reasons;
}

/**
 * A `details` member that has to be an array of strings; anything else yields the empty list.
 *
 * Used for `offboarding.settlement_outstanding`'s `blockers` and `offboarding.refused`'s
 * `allowed_transitions`. Non-string members are dropped rather than stringified: a transition
 * nobody can name is a button nobody can draw.
 */
function readDetailStrings(details: unknown, key: string): readonly string[] {
    const raw = isRecord(details) ? details[key] : undefined;
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
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
 * | `otp.locked`               | `otp.attempts_exceeded`    | the same sentence to a screen — locked, until *this*, try *these* |
 * | `context.branch_required`  | `context.organisation_required` | the picker is the same picker; the branch step is inside it |
 * | `catalogue.*` (five)       | `validation.failed`        | publish/version/allergen refusals name the row, and the editors already render field messages |
 * | anything else              | `server`                   | see `mapErrorEnvelope` |
 *
 * `authz.permission_denied` and `resource.conflict` are one-for-one too, but they carry structured
 * detail and so get their own branches in `mapErrorEnvelope` rather than a row here — the same
 * reason `validation.failed` and `rate_limit.exceeded` are excluded from the derived type below.
 * Three of the five `otp.*` codes are in that category as well.
 *
 * Nine of the ten journey codes (`contact.already_in_use` … `b2b.signatory_required`) are
 * one-for-one and carry nothing but the base three, so they are plain rows: the screen behaviour
 * each one buys is documented on `API_FAILURE_CODES`, and none of them needs a number the message
 * does not carry. The tenth, `order.placement_refused`, carries `details.reasons` and so has a
 * branch of its own.
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
    'request.idempotency_key_reused': 'request.idempotency_key_reused',
    'rate_limit.exceeded': 'rate_limit.exceeded',

    // J1's OTP surface. `otp.invalid`, `otp.cooldown_active` and `otp.attempts_exceeded` are not
    // here: each carries structured detail and is built by its own branch below.
    'otp.expired': 'otp.expired',
    'otp.channel_unavailable': 'otp.channel_unavailable',

    // The ten journey rejections (J1, G1, B1).
    'contact.already_in_use': 'contact.already_in_use',
    'account.verification_required': 'account.verification_required',
    'address.area_not_served': 'address.area_not_served',
    'guest.session_invalid': 'guest.session_invalid',
    'cart.line_refused': 'cart.line_refused',
    // `order.placement_refused` is deliberately not here: it carries `details.reasons` and is built
    // by its own branch below, for the reason the OTP three and the refusal five are.
    'b2b.application_state_invalid': 'b2b.application_state_invalid',
    'b2b.documents_incomplete': 'b2b.documents_incomplete',
    'b2b.signatory_required': 'b2b.signatory_required',

    // The one of the six refusal codes that carries nothing structured. The other five are built by
    // their own branches below, for the reason the OTP three are: the detail *is* the screen.
    'record_export.unavailable': 'record_export.unavailable',
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

    /* ── the three OTP codes that carry structured detail ───────────────────────────────────────
     *
     * Each is built through the contract's own builder rather than through `apiFailure`, so the
     * detail the panel branches on is present by construction and the mock and the wire produce
     * byte-identical failures. `otp.locked` joins `otp.attempts_exceeded` because the two are one
     * outcome with two backend causes: too many wrong codes, or a lock the limiter applied. The
     * screen shows the same thing and offers the same escape.
     */
    if (code === 'otp.invalid') {
        return otpInvalidFailure(readAttemptsRemaining(details), { message, correlationId });
    }

    if (code === 'otp.cooldown_active') {
        return otpCooldownFailure(readRetryAfter(context.retryAfterHeader ?? null, details), {
            message,
            correlationId,
        });
    }

    if (code === 'otp.attempts_exceeded' || code === 'otp.locked') {
        return otpLockedFailure(readLockedUntil(details), readAvailableChannels(details), {
            message,
            correlationId,
        });
    }

    /**
     * The placement refusal, which carries the same `{ reason, ...context }` list the subscription
     * codes do — `cart_not_open`, `zone_suspended`, `cut_off_passed`, `branch_closed`, and the rest
     * of the placement vocabulary, plus a per-line entry for each line that could not be sold.
     *
     * Routed through `readRefusalReasons` rather than through `DIRECT_CODES` because that table
     * builds a failure from `{ message, correlationId }` alone: every reason the server took the
     * trouble to name was being dropped between the envelope and the checkout, which then had
     * nothing to show but the server's one English sentence.
     */
    if (code === 'order.placement_refused') {
        return orderPlacementRefusedFailure(readRefusalReasons(details), {
            message,
            correlationId,
        });
    }

    /* ── the five refusal codes that carry structured detail (S1, J2, B2) ───────────────────────
     *
     * Each is built through the contract's own builder, so the detail a screen branches on is
     * present by construction. The two subscription codes share a builder because they share a
     * shape — a list of `{ reason, ...context }` — and differ only in which surface is asking.
     */
    if (code === 'subscription.refused' || code === 'subscription.change_refused') {
        return subscriptionRefusedFailure(code, readRefusalReasons(details), {
            message,
            correlationId,
        });
    }

    if (code === 'closure.refused') {
        return closureRefusedFailure(readDetailString(details, 'reason'), {
            message,
            correlationId,
        });
    }

    /**
     * Settlement before the state machine: sign-off refused for unsettled money is its own code
     * with its own remedy — settle the named checks, or waive them — and answering it with the
     * generic transition refusal would send somebody to look for a button instead of an invoice.
     */
    if (code === 'offboarding.settlement_outstanding') {
        return settlementOutstandingFailure(readDetailStrings(details, 'blockers'), {
            message,
            correlationId,
        });
    }

    if (code === 'offboarding.refused') {
        return offboardingRefusedFailure(
            readDetailString(details, 'reason'),
            readDetailStrings(details, 'allowed_transitions'),
            { message, correlationId },
        );
    }

    /**
     * The branch picker is one control, and the branch step lives inside it. A client that told
     * these two apart would draw the same screen twice.
     */
    if (code === 'context.branch_required') {
        return apiFailure('context.organisation_required', { message, correlationId });
    }

    /**
     * K1's five catalogue refusals. Every one of them names a row or a field the editor already
     * renders messages against — an ingredient still in use, a published version somebody tried to
     * edit, an unmapped allergen blocking a publish — so they reach the screen as a validation
     * failure carrying the server's own sentence rather than as a generic `server`, which would
     * hide the reason the save was refused.
     */
    if (code.startsWith('catalogue.')) {
        const fields = readValidationFields(details);
        return validationFailure(Object.keys(fields).length > 0 ? fields : { form: [message] }, {
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
    'context.branch_required',
    'authz.permission_denied',
    'request.invalid',
    'request.precondition_required',
    'request.idempotency_key_reused',
    'resource.not_found',
    'resource.conflict',
    'catalogue.in_use',
    'catalogue.version_immutable',
    'catalogue.allergen_unmapped',
    'catalogue.publish_blocked',
    'otp.invalid',
    'otp.expired',
    'otp.attempts_exceeded',
    'otp.cooldown_active',
    'otp.locked',
    'otp.channel_unavailable',
    'contact.already_in_use',
    'account.verification_required',
    'address.area_not_served',
    'guest.session_invalid',
    'cart.line_refused',
    'order.placement_refused',
    'b2b.application_state_invalid',
    'b2b.documents_incomplete',
    'b2b.signatory_required',
    'subscription.refused',
    'subscription.change_refused',
    'closure.refused',
    'offboarding.refused',
    'offboarding.settlement_outstanding',
    'record_export.unavailable',
    'rate_limit.exceeded',
    'server.internal_error',
];
