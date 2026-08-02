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
    'validation.failed' | 'rate_limit.exceeded' | 'resource.conflict' | 'authz.permission_denied'
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
