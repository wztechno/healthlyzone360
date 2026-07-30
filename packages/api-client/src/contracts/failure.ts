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
    'validation.failed',
    'rate_limit.exceeded',
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

type SimpleFailureCode = Exclude<ApiFailureCode, 'validation.failed' | 'rate_limit.exceeded'>;

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
    'validation.failed',
    'rate_limit.exceeded',
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
    'validation.failed': 'Some of the details need correcting.',
    'rate_limit.exceeded': 'Too many attempts. Wait a moment and try again.',
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
