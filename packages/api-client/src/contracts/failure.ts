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
 * All five are now in the generated `ErrorCode` union, which gained them — and eleven more — with
 * the four journey backends. `api/failures.ts` speaks every one of them directly.
 *
 * ## The ten journey codes (J1, G1, B1)
 *
 * The wire grew fifteen codes with the four journeys. Five of them are the `otp.*` set above, which
 * this union already carried; `otp.locked` is projected onto `otp.attempts_exceeded` because the
 * two say the same thing to a screen — you are locked out, here is when it lifts, here is what else
 * you may try. The remaining ten are here because each one changes what a screen *does*, which is
 * the only test for membership:
 *
 * - **`contact.already_in_use`** — the address or number belongs to another account. The contact
 *   form keeps what was typed and offers sign-in, rather than clearing the field the way a
 *   validation failure would.
 * - **`account.verification_required`** — the action needs a verified contact the account does not
 *   have yet. The screen sends the person to the verification panel and back; it is a *route*, not
 *   an error state.
 * - **`address.area_not_served`** — the delivery area is outside every zone. The address editor
 *   marks the area select rather than the street lines, because the street is not the problem.
 * - **`guest.session_invalid`** — the guest token expired, was revoked by a sign-in, or was spent
 *   by a conversion. The checkout clears the store and starts a new session instead of retrying
 *   into the same rejection.
 * - **`cart.line_refused`** — a line cannot be ordered: unpublished, out of area, past the cut-off.
 *   The basket marks the line and keeps the rest, which a whole-request failure cannot express.
 * - **`order.placement_refused`** — the basket priced but the order was refused as a whole. The
 *   checkout returns to the basket rather than showing a confirmation nobody will honour. It carries
 *   `reasons`, on the same terms the subscription refusals do: the backend refuses a placement for
 *   several things at once — an account that is not active, a zone that has been suspended, a
 *   cut-off that passed while the basket sat open — and a checkout that could only say "no" would
 *   send somebody back to a basket with nothing to change.
 * - **`b2b.application_state_invalid`** — the write is legal for some state and not this one,
 *   usually because a reviewer moved the application in another tab. The wizard refetches.
 * - **`b2b.documents_incomplete`** — submission was refused for missing documents rather than
 *   missing fields. The screen scrolls to the vault, not to the form.
 * - **`b2b.signatory_required`** — signing was attempted without the step-up. The panel reopens the
 *   passcode step.
 * - **`b2b.quotation_state_invalid`** — pricing was refused because the quotation is no longer
 *   `submitted`: the buyer accepted, declined or let it expire while the kitchen had it open. The
 *   panel re-reads and shows where it actually stands, rather than offering the prices again against
 *   a state that will refuse them a second time.
 * - **`request.idempotency_key_reused`** — the same key arrived with a *different* body. It is a
 *   client defect, like `request.precondition_required`, and must be reported rather than retried:
 *   a retry with a fresh key would place a second order.
 *
 * ## The six refusal codes (S1, J2, B2)
 *
 * The integrator wave gave three long-running journeys — a standing subscription, closing an
 * account, winding a company down — a `409` each rather than a shared one, and the reason is the
 * same one that earned the ten journey codes their place: **the remedy differs**. Five of the six
 * carry structured detail, because in every case the *specific* refusal is what a screen has to
 * draw, and a single sentence would collapse "you may not change tomorrow's delivery" into "no".
 *
 * - **`subscription.refused`** — the plan cannot be bought as configured. `reasons` is a list, not
 *   one string, because a configurator is refused for several things at once (this duration is not
 *   offered *and* nobody delivers to that area) and fixing one of them is not progress the person
 *   can see unless all of them are named.
 * - **`subscription.change_refused`** — the subscription exists and this *change* is refused. Its
 *   commonest reason, `inside_cut_off`, carries `cut_off_hours` and `effective_from`, which is the
 *   difference between "that is not allowed" and "that is not allowed until Thursday" — so the
 *   context object travels with each reason rather than being flattened away.
 * - **`closure.refused`** — the closure request itself was refused: one is already in flight, or
 *   this one is no longer at the step being attempted. The wizard **refetches the live request**
 *   and lands on the step that actually exists, which is why the reason is carried and the message
 *   is not enough. A *blocked* closure is deliberately not this code — it comes back inside a
 *   successful acknowledgement as `blocked` with its blockers, and leaves the request alive.
 * - **`offboarding.settlement_outstanding`** — sign-off was refused because money is unsettled. It
 *   is its own code rather than a reason on the one below because the remedy is different and
 *   specific: settle the named checks, or waive them. `blockers` names *every* outstanding check,
 *   so the panel lists them instead of revealing them one refusal at a time.
 * - **`offboarding.refused`** — the state machine refused the transition. It carries
 *   `allowedTransitions`, and that is the point: the wind-down surface draws its buttons from what
 *   the server says is legal *now* rather than from a second copy of the state machine on the
 *   device, which would disagree the first time the backend gained a state.
 * - **`record_export.unavailable`** — the bundle is not downloadable yet, or no longer is. It is
 *   the one of the six that carries nothing beyond the base three, because no repository method
 *   reaches it yet: `B2BApplicationRepository` has no export methods, and until an export panel
 *   exists there is no screen to branch on a reason. It is declared now, with its family, on the
 *   same terms `request.precondition_required` was — a code the vocabulary knows about is a code
 *   that cannot silently become `server`.
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
    'request.idempotency_key_reused',
    'validation.failed',
    'rate_limit.exceeded',
    'otp.invalid',
    'otp.expired',
    'otp.cooldown_active',
    'otp.attempts_exceeded',
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
    'b2b.quotation_state_invalid',
    // The six refusal codes (S1, J2, B2).
    'subscription.refused',
    'subscription.change_refused',
    'closure.refused',
    'offboarding.refused',
    'offboarding.settlement_outstanding',
    'record_export.unavailable',
    'network',
    'server',
    'prototype.not_implemented',
] as const;
export type ApiFailureCode = (typeof API_FAILURE_CODES)[number];

/**
 * One entry of a refusal.
 *
 * Named for the surface that needed it first; it is now the platform's *one* refusal-reason shape,
 * carried by `order.placement_refused` as well as by the two subscription codes, because the backend
 * sends the identical `details.reasons` array for all three and a second interface would be the same
 * two fields under another name.
 *
 * `reason` is the server's own vocabulary member — `inside_cut_off`, `duration_not_offered`,
 * `area_not_served`, `cut_off_passed`, `zone_suspended` — and `context` is the rest of the object
 * *verbatim*, because what travels beside a reason differs per reason and is exactly what makes the
 * message specific: `inside_cut_off` carries `delivery_date`, `cut_off_hours` and `effective_from`,
 * and a screen that dropped them could only say "too late" to somebody who wants to know until when.
 *
 * `reason` is a plain `string` rather than a closed union on purpose. The backend's list is long,
 * differs between the two subscription codes and will grow; a client that narrowed it would have to
 * choose between dropping a refusal it did not recognise — leaving a screen with nothing to say —
 * and carrying an `unknown` member that means the same thing as the string it discarded.
 */
export interface SubscriptionRefusal {
    readonly reason: string;
    /** Everything the server sent beside `reason`. Empty when it sent nothing. */
    readonly context: Readonly<Record<string, unknown>>;
}

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
    // The placement refusal carries the same `reasons` array the two subscription codes do.
    | 'order.placement_refused'
    // Five of the six refusal codes. `record_export.unavailable` is deliberately not here — see the
    // last bullet of the header.
    | 'subscription.refused'
    | 'subscription.change_refused'
    | 'closure.refused'
    | 'offboarding.refused'
    | 'offboarding.settlement_outstanding'
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
      })
    | (ApiFailureBase & {
          readonly code: 'order.placement_refused';
          /**
           * Every reason the placement was refused, in the server's order.
           *
           * Its own union member rather than a third code on the subscription one, so that
           * `Extract<ApiFailure, { code: 'subscription.refused' | … }>` keeps narrowing to exactly
           * the two codes it names. The *shape* is shared, which is the part that matters: a
           * checkout and a configurator render a refusal list the same way.
           *
           * Required and possibly empty. Empty means the server refused without naming a reason,
           * which a checkout has to be able to tell apart from "it did not refuse".
           */
          readonly reasons: readonly SubscriptionRefusal[];
      })
    | (ApiFailureBase & {
          readonly code: 'subscription.refused' | 'subscription.change_refused';
          /**
           * Every reason the request was refused, in the server's order.
           *
           * Required and possibly empty. Empty means the server refused without naming a reason,
           * which a configurator has to be able to tell apart from "it did not refuse".
           */
          readonly reasons: readonly SubscriptionRefusal[];
      })
    | (ApiFailureBase & {
          readonly code: 'closure.refused';
          /** `closure_already_in_flight`, `closure_not_cancellable`, … `''` when unstated. */
          readonly reason: string;
      })
    | (ApiFailureBase & {
          readonly code: 'offboarding.refused';
          /** `offboarding.transition_not_allowed`, … `''` when unstated. */
          readonly reason: string;
          /**
           * The transitions that *are* legal from where the wind-down actually is.
           *
           * The surface draws its buttons from this rather than from a copy of the state machine,
           * so a backend that gains a state does not leave a panel offering one that no longer
           * exists. Empty means the server named none — a terminal row, or an older deployment.
           */
          readonly allowedTransitions: readonly string[];
      })
    | (ApiFailureBase & {
          readonly code: 'offboarding.settlement_outstanding';
          /**
           * Every unsettled check, by name — `open_buyer_orders`, … — never just the first.
           *
           * A panel that revealed them one refusal at a time would make settling a wind-down a
           * guessing game played against the server.
           */
          readonly blockers: readonly string[];
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
    // The same key with the same body is *replayed*, which is a success. Reaching this code means
    // the body differed, and repeating a request whose body is the problem cannot help.
    'request.idempotency_key_reused',
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
    // Every journey rejection names something a *person* or another screen has to change: a contact
    // that belongs elsewhere, a verification that has not happened, an area nobody drives to, a
    // credential that is spent, a basket line that cannot be sold, an application a reviewer has
    // moved. None of them resolves by asking again with the identical request — and `place_order`
    // in particular must never be retried automatically, because the one thing worse than a refused
    // order is two accepted ones.
    'contact.already_in_use',
    'account.verification_required',
    'address.area_not_served',
    'guest.session_invalid',
    'cart.line_refused',
    'order.placement_refused',
    'b2b.application_state_invalid',
    'b2b.documents_incomplete',
    'b2b.signatory_required',
    'b2b.quotation_state_invalid',
    // The six refusals. Every one of them is a *verdict* about the request as sent: a duration the
    // plan does not offer stays unoffered, a change inside the cut-off is still inside it a second
    // later, a closure already in flight is still in flight, a transition the state machine refuses
    // is refused again, unsettled money stays unsettled, and a bundle that is still building does
    // not finish because somebody asked twice. Each needs a person to change something first.
    'subscription.refused',
    'subscription.change_refused',
    'closure.refused',
    'offboarding.refused',
    'offboarding.settlement_outstanding',
    'record_export.unavailable',
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
    'request.idempotency_key_reused': 'This request repeated a key with different details.',
    'validation.failed': 'Some of the details need correcting.',
    'rate_limit.exceeded': 'Too many attempts. Wait a moment and try again.',
    'otp.invalid': 'That code is not right.',
    'otp.expired': 'That code has expired.',
    'otp.cooldown_active': 'Another code cannot be sent quite yet.',
    'otp.attempts_exceeded': 'Too many incorrect codes. This is locked for a while.',
    'otp.channel_unavailable': 'A code cannot be sent that way.',
    'contact.already_in_use': 'That contact is already in use on another account.',
    'account.verification_required': 'Confirm a contact before continuing.',
    'address.area_not_served': 'Healthy360 does not deliver to that area yet.',
    'cart.line_refused': 'Something in your basket cannot be ordered right now.',
    'guest.session_invalid': 'This guest session has ended.',
    'order.placement_refused': 'This order could not be placed.',
    'b2b.application_state_invalid': 'This application has moved on since you opened it.',
    'b2b.documents_incomplete': 'Some required documents are still missing.',
    'b2b.signatory_required': 'Confirm the code we sent before signing.',
    'b2b.quotation_state_invalid': 'This quotation has moved on since you opened it.',
    'subscription.refused': 'This plan cannot be subscribed to as configured.',
    'subscription.change_refused': 'This change to your subscription was not accepted.',
    'closure.refused': 'This closure request could not be taken any further.',
    'offboarding.refused': 'This wind-down cannot move that way from where it is.',
    'offboarding.settlement_outstanding':
        'Settlement is not resolved, so this cannot be signed off.',
    'record_export.unavailable': 'This bundle is not available to download.',
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

/* ------------------------------------------------------------------------------------------------
 * The refusal builders (S1, J2, B2).
 *
 * Five of the six codes carry structured detail and so need a builder each, on the same terms as
 * the OTP three: the mock and the wire both go through these, so the failure a screen branches on
 * is identical whichever produced it. `record_export.unavailable` is plain and goes through
 * `apiFailure`.
 * ---------------------------------------------------------------------------------------------- */

/**
 * An order the platform will not accept.
 *
 * Built through a builder rather than through `apiFailure` for the reason every refusal above is:
 * the detail *is* the screen. A checkout that received only the server's sentence would have to tell
 * somebody their order was refused without saying that the kitchen shut, or that the cut-off passed
 * while they were choosing a slot — and those are the two things they can act on.
 *
 * `reasons` is passed explicitly even when empty, on the same terms `otpLockedFailure` passes an
 * empty channel list: "refused, and the server named nothing" is a statement, not a missing field.
 */
export function orderPlacementRefusedFailure(
    reasons: readonly SubscriptionRefusal[],
    options: FailureOptions = {},
): ApiFailure {
    return {
        code: 'order.placement_refused',
        reasons,
        message: options.message ?? FALLBACK_MESSAGES['order.placement_refused'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

/**
 * A subscription that cannot be bought, or a change that cannot be made.
 *
 * One builder for two codes, because the *shape* is one shape — a list of named reasons with their
 * context — and the two codes differ only in which screen is asking. Splitting it would be two
 * identical functions whose bodies drift.
 */
export function subscriptionRefusedFailure(
    code: 'subscription.refused' | 'subscription.change_refused',
    reasons: readonly SubscriptionRefusal[],
    options: FailureOptions = {},
): ApiFailure {
    return {
        code,
        reasons,
        message: options.message ?? FALLBACK_MESSAGES[code],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

/** The closure request itself refused — already in flight, or past the step being attempted. */
export function closureRefusedFailure(reason: string, options: FailureOptions = {}): ApiFailure {
    return {
        code: 'closure.refused',
        reason,
        message: options.message ?? FALLBACK_MESSAGES['closure.refused'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

/**
 * The wind-down state machine refusing a transition.
 *
 * `allowedTransitions` is passed explicitly even when empty, for the reason `otpLockedFailure`
 * passes an empty channel list: "there is nowhere to go from here" is a statement the surface has
 * to be able to make, and it is not the same as the server having said nothing.
 */
export function offboardingRefusedFailure(
    reason: string,
    allowedTransitions: readonly string[],
    options: FailureOptions = {},
): ApiFailure {
    return {
        code: 'offboarding.refused',
        reason,
        allowedTransitions,
        message: options.message ?? FALLBACK_MESSAGES['offboarding.refused'],
        correlationId: options.correlationId ?? null,
        retryable: options.retryable ?? false,
    };
}

/** Sign-off refused because money is unsettled. `blockers` names every outstanding check. */
export function settlementOutstandingFailure(
    blockers: readonly string[],
    options: FailureOptions = {},
): ApiFailure {
    return {
        code: 'offboarding.settlement_outstanding',
        blockers,
        message: options.message ?? FALLBACK_MESSAGES['offboarding.settlement_outstanding'],
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

/** The placement refusal, so a checkout can reach for `reasons` without a cast. */
export function isOrderPlacementRefusedFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'order.placement_refused' }> {
    return failure.code === 'order.placement_refused';
}

/**
 * Either subscription refusal, so a configurator can ask "is this mine?" before reaching for the
 * reasons — the same convenience {@link isOtpFailure} gives a passcode panel.
 */
export function isSubscriptionRefusalFailure(
    failure: ApiFailure,
): failure is Extract<
    ApiFailure,
    { code: 'subscription.refused' | 'subscription.change_refused' }
> {
    return (
        failure.code === 'subscription.refused' || failure.code === 'subscription.change_refused'
    );
}

export function isClosureRefusedFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'closure.refused' }> {
    return failure.code === 'closure.refused';
}

export function isOffboardingRefusedFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'offboarding.refused' }> {
    return failure.code === 'offboarding.refused';
}

export function isSettlementOutstandingFailure(
    failure: ApiFailure,
): failure is Extract<ApiFailure, { code: 'offboarding.settlement_outstanding' }> {
    return failure.code === 'offboarding.settlement_outstanding';
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
