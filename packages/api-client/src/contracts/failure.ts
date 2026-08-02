import type { IsoDateTime } from '@healthy360/domain-types';

import type { OtpChannel } from './verification.ts';

/**
 * The failure contract every repository — mock today, generated-OpenAPI-backed in 5c — speaks.
 *
 * Screens branch on `ApiFailure['code']` and nothing else. That is the whole point: a screen must
 * behave identically whether it was handed a mocked rejection or a real `4xx` envelope, so the
 * codes below mirror `error.code` from the backend envelope (plan §14) rather than HTTP statuses.
 */

/**
 * Every code a repository may reject with.
 *
 * `auth.unauthenticated` is not in the original Phase-5b brief but is unavoidable: session
 * restoration calls `me()` with a persisted token, and an expired or revoked token has to be
 * distinguishable from bad sign-in credentials or the guard kernel will send the user to the wrong
 * screen. It maps to a plain `401` (recorded in `docs/architecture/notes/phase5b-decisions.md`).
 *
 * `prototype.not_implemented` is **client-side**, like `network`. It has no wire counterpart and
 * never will: it is what the eight Prompt 2 repositories reject with when the application is running
 * against the real API, because the endpoints behind them are proposed drafts
 * (`docs/api/proposed/`) rather than implemented routes. Giving it a code of its own — rather than
 * projecting it onto `server` — is what lets a screen say "this part of the prototype needs a
 * backend" instead of "something went wrong on our side", which would be untrue.
 *
 * ## The four management codes (K1)
 *
 * `authz.permission_denied`, `resource.not_found`, `resource.conflict` and
 * `request.precondition_required` were previously projected onto `server` by `api/failures.ts`,
 * because no implemented repository could reach them. The kitchen-admin surface reaches all four,
 * and each needs a *different* screen behaviour, which is the only test for membership of this
 * union:
 *
 * - **`authz.permission_denied`** — the person is signed in and in the right organisation but their
 *   roles do not carry the code the endpoint requires. A screen hides or disables the affordance
 *   and says which permission is missing; retrying is pointless.
 * - **`resource.not_found`** — the row is gone, or was never visible to this tenant. A list screen
 *   drops the row and refetches; a detail screen shows "no longer available" rather than an error.
 * - **`resource.conflict`** — optimistic-locking rejection (plan §4.13). Somebody else saved first.
 *   The editor offers reload-vs-keep, and `currentLockVersion` is what lets it say *how far* behind
 *   the local copy is. Optional because a conflict that is not lock-versioned carries no version.
 * - **`request.precondition_required`** — a write on a lock-versioned resource arrived without
 *   `If-Match`. It is a **client defect**, never something a person can fix, so a screen must be
 *   able to tell it apart from a validation failure and report it rather than blame the user.
 *
 * `request.precondition_required` has no counterpart in the *current* generated `ErrorCode` union:
 * the backend enum gains it with K1's first lock-versioned endpoint (plan §4.17, additive within
 * v1). It is declared here anyway because the mock repositories raise it today, and the whole point
 * of this union is that the mock and the API reject with identical codes.
 *
 * ## The five OTP codes (J1)
 *
 * A one-time-code panel is the densest error surface in the product: five rejections, each of which
 * has to change what the panel *shows and offers*, and none of which is "something went wrong".
 * Projecting them onto `validation.failed` — the obvious shortcut, since a wrong code is a wrong
 * field — would lose exactly the structured detail the screen needs:
 *
 * - **`otp.invalid`** — the code was wrong. `attemptsRemaining` is the number *after* this attempt,
 *   authored by the server. The panel says how many tries are left; a client that decremented its
 *   own copy would disagree with the server the moment two tabs raced.
 * - **`otp.expired`** — the challenge timed out (300 s). The panel flips to an expired state whose
 *   only affordance is "send a new code"; retrying the same code is meaningless.
 * - **`otp.cooldown_active`** — a resend arrived inside the 45 s window. Distinct from
 *   `rate_limit.exceeded` because it is *expected* traffic on a normal journey, not abuse: the panel
 *   disables the resend button and counts down instead of showing an error.
 * - **`otp.attempts_exceeded`** — the lockout. Carries `lockedUntil` **and** `availableChannels`,
 *   because a lockout screen that cannot say when it lifts and cannot offer another channel is a
 *   dead end. Both are the server's answer.
 * - **`otp.channel_unavailable`** — the requested channel cannot be used (no verified number, or a
 *   channel with no real driver in this environment). The panel removes the channel rather than
 *   letting the person press it again.
 *
 * None of the five is in the *current* generated `ErrorCode` union either; the backend enum gains
 * them with J1's OTP endpoints (additive within v1). They are declared here now because the mock
 * repositories raise them today.
 */
export const API_FAILURE_CODES = [
    'auth.invalid_credentials',
    'auth.unauthenticated',
    'auth.email_unverified',
    'auth.two_factor_required',
    'auth.step_up_required',
    'context.organisation_required',
    'context.organisation_forbidden',
    'context.branch_out_of_scope',
    'authz.permission_denied',
    'resource.not_found',
    'resource.conflict',
    'request.precondition_required',
    'validation.failed',
    'rate_limit.exceeded',
    'otp.invalid',
    'otp.expired',
    'otp.cooldown_active',
    'otp.attempts_exceeded',
    'otp.channel_unavailable',
    'network',
    'server',
    'prototype.not_implemented',
] as const;
export type ApiFailureCode = (typeof API_FAILURE_CODES)[number];

/** Field path → messages, exactly the shape `mapLaravelValidationErrors` consumes. */
export type ValidationFields = Readonly<Record<string, readonly string[]>>;

interface ApiFailureBase {
    /**
     * Server-authored, already-localised text. Screens prefer their own translated copy and fall
     * back to this only when they have nothing better — never show a raw code to a person.
     */
    readonly message: string;
    /** `error.correlation_id`. Displayed on the error state so support can find the request. */
    readonly correlationId: string | null;
    /** True when retrying the identical request could plausibly succeed. */
    readonly retryable: boolean;
}

/** Codes whose failure carries nothing beyond the three base fields. */
type SimpleFailureCode = Exclude<
    ApiFailureCode,
    | 'validation.failed'
    | 'rate_limit.exceeded'
    | 'resource.conflict'
    | 'authz.permission_denied'
    | 'otp.invalid'
    | 'otp.cooldown_active'
    | 'otp.attempts_exceeded'
>;

export type ApiFailure =
    | (ApiFailureBase & { readonly code: SimpleFailureCode })
    | (ApiFailureBase & {
          readonly code: 'validation.failed';
          /** `error.details` — per-field messages, ready for React Hook Form. */
          readonly fields: ValidationFields;
      })
    | (ApiFailureBase & {
          readonly code: 'rate_limit.exceeded';
          /** Seconds until the caller may try again (`Retry-After`). */
          readonly retryAfterSeconds: number;
      })
    | (ApiFailureBase & {
          readonly code: 'resource.conflict';
          /**
           * The lock version the server holds, when the conflict is an optimistic-locking one.
           *
           * Optional rather than required because `resource.conflict` also covers conflicts that
           * have no version at all — a duplicate slug, a second publish of the same row. A screen
           * that needs the number must handle its absence, and an editor that invents one would be
           * telling the person something the server never said.
           */
          readonly currentLockVersion?: number | undefined;
      })
    | (ApiFailureBase & {
          readonly code: 'authz.permission_denied';
          /** The permission code the endpoint required, e.g. `catalogue.publish_organisation`. */
          readonly permission: string;
          /** The denying RBAC step, verbatim from `details.reason`. */
          readonly reason: string;
      })
    | (ApiFailureBase & {
          readonly code: 'otp.invalid';
          /** Tries left **after** this rejection. Zero means the next wrong code locks the account. */
          readonly attemptsRemaining: number;
      })
    | (ApiFailureBase & {
          readonly code: 'otp.cooldown_active';
          /** Seconds until another send is accepted. Seeds the panel's countdown. */
          readonly retryAfterSeconds: number;
      })
    | (ApiFailureBase & {
          readonly code: 'otp.attempts_exceeded';
          /** When the lockout lifts. Shown, not merely counted down from. */
          readonly lockedUntil: IsoDateTime;
          /**
           * Channels the person may switch to instead of waiting.
           *
           * Required rather than optional, and possibly empty: "there is no other channel" is a
           * real answer the screen must be able to state, and it is not the same as "the server did
           * not say".
           */
          readonly availableChannels: readonly OtpChannel[];
      });

/** Codes where retrying the same request unchanged is pointless or harmful. */
const NEVER_RETRYABLE: ReadonlySet<ApiFailureCode> = new Set<ApiFailureCode>([
    'auth.invalid_credentials',
    'auth.unauthenticated',
    'auth.email_unverified',
    'auth.two_factor_required',
    'auth.step_up_required',
    'context.organisation_required',
    'context.organisation_forbidden',
    'context.branch_out_of_scope',
    // Roles do not change between two attempts, a missing row does not reappear, a stale lock
    // version stays stale, and a request with no `If-Match` still has none the second time.
    'authz.permission_denied',
    'resource.not_found',
    'resource.conflict',
    'request.precondition_required',
    'validation.failed',
    'rate_limit.exceeded',
    // The same wrong code stays wrong, an expired challenge does not un-expire, a cooldown does not
    // end sooner because it was asked twice, and a lockout is the point. Every one of the five needs
    // a *person* to do something different — enter another code, ask for a new one, wait, or switch
    // channel — so an automatic retry would only burn an attempt.
    'otp.invalid',
    'otp.expired',
    'otp.cooldown_active',
    'otp.attempts_exceeded',
    'otp.channel_unavailable',
    // Retrying cannot conjure an endpoint that has not been built.
    'prototype.not_implemented',
]);

export function isApiFailureCode(value: unknown): value is ApiFailureCode {
    return typeof value === 'string' && (API_FAILURE_CODES as readonly string[]).includes(value);
}

export function defaultRetryable(code: ApiFailureCode): boolean {
    return !NEVER_RETRYABLE.has(code);
}

/**
 * The thrown form. Repositories reject rather than return a `Result`, because TanStack Query's
 * error channel is what every screen already listens to and a second failure convention would
 * simply be forgotten somewhere.
 */
export class ApiError extends Error {
    readonly failure: ApiFailure;

    constructor(failure: ApiFailure) {
        super(failure.message);
        this.name = 'ApiError';
        this.failure = failure;
    }

    get code(): ApiFailureCode {
        return this.failure.code;
    }
}

export interface FailureOptions {
    readonly message?: string | undefined;
    readonly correlationId?: string | null | undefined;
    readonly retryable?: boolean | undefined;
}

/** Human-readable last resort. Screens translate by code; this is what reaches logs. */
const FALLBACK_MESSAGES: Readonly<Record<ApiFailureCode, string>> = {
    'auth.invalid_credentials': 'Those credentials do not match our records.',
    'auth.unauthenticated': 'This session is no longer valid.',
    'auth.email_unverified': 'This email address has not been confirmed yet.',
    'auth.two_factor_required': 'A two-factor code is required to finish signing in.',
    'auth.step_up_required': 'Confirm your password to continue.',
    'context.organisation_required': 'Choose an organisation before continuing.',
    'context.organisation_forbidden': 'You are not an active member of that organisation.',
    'context.branch_out_of_scope': 'That branch is outside your membership scope.',
    'authz.permission_denied': 'Your role does not allow that.',
    'resource.not_found': 'That record no longer exists.',
    'resource.conflict': 'Somebody else changed this while you were editing it.',
    'request.precondition_required': 'This change was sent without the version it was based on.',
    'validation.failed': 'Some of the details need correcting.',
    'rate_limit.exceeded': 'Too many attempts. Wait a moment and try again.',
    'otp.invalid': 'That code is not right.',
    'otp.expired': 'That code has expired.',
    'otp.cooldown_active': 'Another code cannot be sent quite yet.',
    'otp.attempts_exceeded': 'Too many incorrect codes. This is locked for a while.',
    'otp.channel_unavailable': 'A code cannot be sent that way.',
    network: 'Healthy360 could not be reached.',
    server: 'Something went wrong on our side.',
    'prototype.not_implemented':
        'This part of the prototype has no backend yet, so it cannot be used against the live API.',
};

export function apiFailure(code: SimpleFailureCode, options: FailureOptions = {}): ApiFailure {
    return {
        code,
        message: options.message ?? FALLBACK_MESSAGES[code],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? defaultRetryable(code),
    };
}

export function validationFailure(
    fields: ValidationFields,
    options: FailureOptions = {},
): ApiFailure {
    return {
        code: 'validation.failed',
        fields,
        message: options.message ?? FALLBACK_MESSAGES['validation.failed'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

export function rateLimitFailure(
    retryAfterSeconds: number,
    options: FailureOptions = {},
): ApiFailure {
    return {
        code: 'rate_limit.exceeded',
        retryAfterSeconds,
        message: options.message ?? FALLBACK_MESSAGES['rate_limit.exceeded'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

export interface ConflictFailureOptions extends FailureOptions {
    /** Omit when the conflict is not a lock-versioned one. */
    readonly currentLockVersion?: number | undefined;
}

/**
 * The optimistic-locking rejection (plan §4.13).
 *
 * `currentLockVersion` is spread rather than assigned so that "the server did not say" stays
 * distinguishable from "the server said `undefined`" under `exactOptionalPropertyTypes`.
 */
export function conflictFailure(options: ConflictFailureOptions = {}): ApiFailure {
    return {
        code: 'resource.conflict',
        ...(options.currentLockVersion === undefined
            ? {}
            : { currentLockVersion: options.currentLockVersion }),
        message: options.message ?? FALLBACK_MESSAGES['resource.conflict'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

/**
 * The authorisation rejection.
 *
 * Both fields are required rather than optional: a permission failure a screen cannot name is a
 * permission failure nobody can act on, and the backend envelope carries the denying step already
 * (`details.reason`, generated `types.ts`).
 */
export function permissionDeniedFailure(
    permission: string,
    reason: string,
    options: FailureOptions = {},
): ApiFailure {
    return {
        code: 'authz.permission_denied',
        permission,
        reason,
        message: options.message ?? FALLBACK_MESSAGES['authz.permission_denied'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

/* ------------------------------------------------------------------------------------------------
 * The OTP builders (J1).
 *
 * Three of the five codes carry structured detail and so need a builder each; `otp.expired` and
 * `otp.channel_unavailable` are plain and go through `apiFailure`.
 * ---------------------------------------------------------------------------------------------- */

/** A wrong code. `attemptsRemaining` is what is left *after* this rejection. */
export function otpInvalidFailure(
    attemptsRemaining: number,
    options: FailureOptions = {},
): ApiFailure {
    return {
        code: 'otp.invalid',
        attemptsRemaining,
        message: options.message ?? FALLBACK_MESSAGES['otp.invalid'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

/** A resend inside the cooldown window. Seeds the panel's countdown rather than an error banner. */
export function otpCooldownFailure(
    retryAfterSeconds: number,
    options: FailureOptions = {},
): ApiFailure {
    return {
        code: 'otp.cooldown_active',
        retryAfterSeconds,
        message: options.message ?? FALLBACK_MESSAGES['otp.cooldown_active'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

/**
 * The lockout.
 *
 * `availableChannels` is passed explicitly even when empty, because an empty list is a statement —
 * "there is nothing else to try" — and the screen has to be able to make it.
 */
export function otpLockedFailure(
    lockedUntil: IsoDateTime,
    availableChannels: readonly OtpChannel[],
    options: FailureOptions = {},
): ApiFailure {
    return {
        code: 'otp.attempts_exceeded',
        lockedUntil,
        availableChannels,
        message: options.message ?? FALLBACK_MESSAGES['otp.attempts_exceeded'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

/** Narrows anything caught in a `catch` or handed to a query error boundary. */
export function asApiFailure(error: unknown): ApiFailure | null {
    if (error instanceof ApiError) return error.failure;
    if (typeof error !== 'object' || error === null) return null;
    const candidate = error as { code?: unknown; message?: unknown };
    if (!isApiFailureCode(candidate.code)) return null;
    return error as ApiFailure;
}

export function isApiFailure(error: unknown): error is ApiFailure {
    return asApiFailure(error) !== null;
}

export function isValidationFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'validation.failed' }> {
    return failure.code === 'validation.failed';
}

export function isRateLimitFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'rate_limit.exceeded' }> {
    return failure.code === 'rate_limit.exceeded';
}

export function isConflictFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'resource.conflict' }> {
    return failure.code === 'resource.conflict';
}

export function isPermissionDeniedFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'authz.permission_denied' }> {
    return failure.code === 'authz.permission_denied';
}

/** Every `otp.*` code, so a panel can ask "is this mine?" before reaching for the matrix. */
export function isOtpFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: `otp.${string}` }> {
    return failure.code.startsWith('otp.');
}

export function isOtpInvalidFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'otp.invalid' }> {
    return failure.code === 'otp.invalid';
}

export function isOtpCooldownFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'otp.cooldown_active' }> {
    return failure.code === 'otp.cooldown_active';
}

export function isOtpLockedFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'otp.attempts_exceeded' }> {
    return failure.code === 'otp.attempts_exceeded';
}

/**
 * True for failures a *retry policy* must never automatically repeat: an authentication or
 * validation rejection will produce the identical answer and a rate-limit retry makes things worse.
 */
export function isAutoRetryable(failure: ApiFailure): boolean {
    return failure.retryable;
}

export function throwFailure(failure: ApiFailure): never {
    throw new ApiError(failure);
}
