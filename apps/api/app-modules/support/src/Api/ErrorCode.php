<?php

declare(strict_types=1);

namespace Healthy360\Support\Api;

/**
 * The stable, machine-readable error vocabulary of the Healthy360 API
 * (docs/api/conventions.md). Clients branch on these codes, never on
 * messages, so a value may only be added — never renamed or repurposed —
 * within `/api/v1`.
 *
 * Separated authorisation concerns (context, permission, step-up, email
 * verification, two-factor) each carry a distinct code and are never
 * collapsed into one generic denial.
 */
enum ErrorCode: string
{
    case ValidationFailed = 'validation.failed';

    case AuthUnauthenticated = 'auth.unauthenticated';
    case AuthInvalidCredentials = 'auth.invalid_credentials';
    case AuthEmailUnverified = 'auth.email_unverified';
    case AuthTwoFactorRequired = 'auth.two_factor_required';
    case AuthTwoFactorInvalid = 'auth.two_factor_invalid';
    case AuthStepUpRequired = 'auth.step_up_required';
    case AuthCsrfTokenMismatch = 'auth.csrf_token_mismatch';
    case AuthInvalidSignature = 'auth.invalid_signature';

    case ContextOrganisationRequired = 'context.organisation_required';
    case ContextOrganisationForbidden = 'context.organisation_forbidden';
    case ContextBranchOutOfScope = 'context.branch_out_of_scope';

    /**
     * An endpoint that operates on one branch was reached with no branch
     * selected (K1.7). Distinct from `context.branch_out_of_scope`: the caller
     * has not asked for a branch they may not have, they have not asked for
     * one at all, and the fix is to send `X-Branch-Id` rather than to pick a
     * different branch. `branch.context` deliberately permits an absent
     * header — an organisation-wide membership may legitimately select no
     * branch — so the requirement belongs to the endpoints that genuinely
     * cannot answer without one, not to the middleware.
     */
    case ContextBranchRequired = 'context.branch_required';

    case AuthzPermissionDenied = 'authz.permission_denied';

    case RequestInvalid = 'request.invalid';

    /**
     * A write to a lock-versioned resource arrived without `If-Match`
     * (master plan v2 §4.13). Distinct from `resource.conflict`: the client
     * has not lost a race, it never entered one, and the fix is to read the
     * resource and retry with its validator rather than to reload and merge.
     */
    case RequestPreconditionRequired = 'request.precondition_required';

    /**
     * An `Idempotency-Key` was replayed against a *different* request body
     * (master plan v2 §4.14). Distinct from `resource.conflict`: nothing about
     * the resource has changed under the caller — the caller has reused a key
     * that already means something else, and the fix is a new key rather than
     * a reload. Replaying the *same* body is not an error at all; it returns
     * the original envelope with `Idempotency-Replayed: true`.
     */
    case RequestIdempotencyKeyReused = 'request.idempotency_key_reused';

    case ResourceNotFound = 'resource.not_found';
    case ResourceConflict = 'resource.conflict';

    /**
     * The organisation on one side of this request has been suspended by the
     * platform (PA1), so the request cannot be honoured however well formed it
     * is. Raised on both sides of the same fact: a buyer reaching a suspended
     * kitchen's plan or items, and a suspended kitchen's own staff attempting a
     * catalogue or publication write.
     *
     * A 409 rather than a 403, and the distinction is the point.
     * `authz.permission_denied` means *you* may not do this; this code means
     * nobody may, because the world is in a state that forbids it, and the
     * remedy is a conversation with the platform rather than a different role.
     * It is also not `resource.not_found`: the anonymous marketplace hides a
     * suspended kitchen entirely, but a signed-in member of that kitchen
     * already knows it exists and is owed the real reason.
     *
     * `details.organisation_id` names the organisation whose suspension caused
     * the refusal — the kitchen, never the caller's own organisation, when the
     * two differ.
     */
    case OrganisationSuspended = 'organisation.suspended';

    /**
     * A catalogue record cannot be withdrawn because something still points at
     * it — an ingredient referenced by a recipe version that is not retired.
     * Distinct from the generic conflict: the caller has not lost a race, and
     * `details` names what is holding the record, so the answer is "retire
     * those first" rather than "reload and try again".
     */
    case CatalogueInUse = 'catalogue.in_use';

    /**
     * A write reached a published or retired recipe version. Published
     * versions are immutable (master plan v2 §4.7) — a change is a new draft
     * version, never an edit in place, because a label a customer has already
     * been shown must stay reconstructable.
     */
    case CatalogueVersionImmutable = 'catalogue.version_immutable';

    /**
     * Publication was refused because at least one line ingredient carries no
     * allergen determination at all. Silence is not a statement of absence:
     * an ingredient nobody has assessed is not the same as one assessed and
     * found clear, and only the second may reach a plate.
     * `details.ingredient_ids` names them.
     */
    case CatalogueAllergenUnmapped = 'catalogue.allergen_unmapped';

    /**
     * Publication was refused by the readiness evaluator for a reason other
     * than an unmapped allergen — an unquantified line, a quarantined
     * ingredient, a version in the wrong state. `details.reasons` carries one
     * structured entry per blocker, so a UI can list every problem at once
     * rather than revealing them one publish attempt at a time.
     */
    case CataloguePublishBlocked = 'catalogue.publish_blocked';

    /**
     * The submitted passcode does not match the live challenge (J1). A 422
     * rather than a 401: the caller is authenticated perfectly well — or is a
     * guest who never claimed to be — and what failed is one attempt at a
     * short-lived proof. `details.attempts_remaining` says how many are left,
     * because a client that cannot show that has to guess when to stop.
     */
    case OtpInvalid = 'otp.invalid';

    /**
     * The challenge is no longer live: five minutes have passed, it was
     * superseded by a newer one, or it has already been spent. Distinct from
     * `otp.invalid` because the remedy is different — ask for a new code
     * rather than re-read the message.
     */
    case OtpExpired = 'otp.expired';

    /**
     * Three wrong codes against one challenge. A 429, not a 422: the challenge
     * is now closed and no further attempt against it can succeed, so this is
     * a limit reached rather than a value rejected.
     */
    case OtpAttemptsExceeded = 'otp.attempts_exceeded';

    /**
     * A resend arrived inside the 45-second cooldown.
     * `details.retry_after_seconds` carries the wait, mirrored into the
     * `Retry-After` header.
     */
    case OtpCooldownActive = 'otp.cooldown_active';

    /**
     * Too many failures across challenges have locked this destination for
     * fifteen minutes. Distinct from `otp.attempts_exceeded`, which closes one
     * challenge: this closes the *contact*, so issuing a fresh challenge will
     * not help either. `details.locked_until` says when it lifts.
     */
    case OtpLocked = 'otp.locked';

    /**
     * No driver can reach this destination on the requested channel — SMS and
     * WhatsApp have no provider in this deployment (OQ-034), and an email
     * challenge cannot be sent to a phone. `details.available_channels` names
     * what *would* work, so a client can offer the person a real alternative
     * rather than a dead end.
     */
    case OtpChannelUnavailable = 'otp.channel_unavailable';

    /**
     * The destination is already *proven* by somebody else (J1). Deliberately
     * only ever raised on a **verified** collision: two people may both claim
     * an address — a typo, a shared family mailbox — and refusing the claim
     * would let anybody deny an address to its real owner by typing it first.
     */
    case ContactAlreadyInUse = 'contact.already_in_use';

    /**
     * The customer account is not activated, and the endpoint reached needs it
     * to be. A 403 rather than a 409: nothing about the request conflicts with
     * anything, the caller simply lacks a standing the platform has not yet
     * granted them. `details.outstanding` carries the checklist codes that are
     * still unsatisfied, so the client can send the person to the right step.
     */
    case AccountVerificationRequired = 'account.verification_required';

    /**
     * No kitchen delivers to the delivery area named on the address. A 422:
     * the area exists and is a perfectly valid reference, and what fails is
     * the *usefulness* of the combination rather than its shape.
     */
    case AddressAreaNotServed = 'address.area_not_served';

    /**
     * The `X-Guest-Token` presented is unknown, expired, revoked, or does not
     * carry the grade the endpoint requires (G1). One code for all four on
     * purpose: distinguishing them would tell a token-guesser which of their
     * guesses was closest. A 401, because the fix is to obtain a credential.
     */
    case GuestSessionInvalid = 'guest.session_invalid';

    /**
     * A cart line was refused — an unbuyable item, a branch that cannot make
     * it on the requested day, a currency that does not match the cart's
     * (C1). `details.reason` names which, and no partial line is written.
     */
    case CartLineRefused = 'cart.line_refused';

    /**
     * A basket cannot be opened on this sales channel with the caller's account
     * shape. Private-pricing channels require a corporate buyer account.
     */
    case CartChannelRefused = 'cart.channel_refused';

    /**
     * Checkout was refused. A 409 rather than a 422, because what changed is
     * the *world* — a branch closed, a price was withdrawn, a cut-off passed
     * between building the cart and submitting it — and the remedy is to
     * re-read the cart. `details.reasons` carries one structured entry per
     * blocker so a client can show all of them at once.
     */
    case OrderPlacementRefused = 'order.placement_refused';

    /**
     * The action is not available from the application's current state — a
     * submitted application cannot be edited, a declined one cannot be
     * approved (B1). `details.status` carries the state it is actually in.
     */
    case B2bApplicationStateInvalid = 'b2b.application_state_invalid';

    /**
     * Submission or approval was refused because the KYC pack is not complete:
     * a required document kind is missing, or one is still pending review or
     * was rejected. `details.missing` names the kinds — never the documents
     * themselves, which stay behind the platform review surface.
     */
    case B2bDocumentsIncomplete = 'b2b.documents_incomplete';

    /**
     * Signing was attempted without proof that the *signatory* is present: no
     * verified OTP challenge of purpose `b2b_signatory`, or one belonging to
     * somebody else. A 403 — click-wrap evidence with no identity proof behind
     * it is not evidence, and the agreement is what a court would be shown.
     */
    case B2bSignatoryRequired = 'b2b.signatory_required';

    /**
     * A quotation action is not available from its current state (B5) — a
     * quoted quotation cannot be re-quoted, an accepted one cannot be
     * declined, a draft with no lines cannot be submitted. `details.status`
     * carries the state it is actually in.
     */
    case B2bQuotationStateInvalid = 'b2b.quotation_state_invalid';

    /**
     * Submission was refused because the draft carries no lines. Its own code
     * rather than `validation.failed`: nothing about the request body is
     * malformed, the resource itself has nothing in it yet to send for
     * pricing.
     */
    case B2bQuotationEmpty = 'b2b.quotation_empty';

    /**
     * A subscription could not be started (S1). Its own code rather than
     * `order.placement_refused`, which S1 borrowed while this enum was closed
     * to it: a client branches on the code to decide which screen to render,
     * and a checkout basket and a twenty-day plan are not the same screen.
     * `details.reasons` carries **every** blocker at once — a plan is a longer,
     * more considered purchase than a single order, and revealing one problem
     * per attempt is three round trips through a form already filled in.
     */
    case SubscriptionRefused = 'subscription.refused';

    /**
     * A change to a live subscription was refused — mostly the plan's own
     * change window (§2), also a transition the state machine forbids, a right
     * the plan withholds, a day already settled or a stale `lock_version`.
     * Distinct from `subscription.refused`, which is about starting one:
     * nothing is wrong with this subscription, and what has happened is that
     * time passed. `details.reasons` carries `cut_off_at` and `effective_from`
     * so a client can say when changes closed and which day is next.
     */
    case SubscriptionChangeRefused = 'subscription.change_refused';

    /**
     * An account closure the platform will not perform (J2) — a second request
     * while one is in flight, proof offered for a request awaiting none, a
     * cancellation after there is nothing to cancel, or no verified contact to
     * send a passcode to. `details.reason` carries the stable reason string.
     *
     * **Deliberately not the code for a *blocked* closure.** A blocker is part
     * of the journey — "you have two orders in flight" is information a
     * customer acts on — and it comes back inside a 200 acknowledgement with
     * `blocked` and `blockers`, because the request survives so they can come
     * back when the food has arrived. An error code there would turn a
     * checklist into a failure.
     */
    case ClosureRefused = 'closure.refused';

    /**
     * An offboarding was asked to do something it cannot (B2) — an
     * organisation already being wound up, a transition the state machine
     * forbids, no agreement in force to end. `details.reason` names which, and
     * `details.allowed_transitions` names the moves that are legal from here.
     */
    case OffboardingRefused = 'offboarding.refused';

    /**
     * Sign-off was refused because settlement is not resolved.
     * `details.blockers` names **every** outstanding check, so a wind-up screen
     * renders the list rather than discovering it one attempt at a time. Its
     * own code rather than `offboarding.refused` because a client has to branch
     * on it: the remedy is to settle or to waive, not to retry.
     */
    case OffboardingSettlementOutstanding = 'offboarding.settlement_outstanding';

    /**
     * A records bundle exists and cannot be downloaded: it is still building,
     * it failed, or its window has closed and the bytes are gone.
     * `details.status` says which. A 409 rather than a 404 deliberately — the
     * caller is looking at an export they may see and can already list, and a
     * 404 would be a lie about a row in front of them.
     */
    case RecordExportUnavailable = 'record_export.unavailable';

    case RateLimitExceeded = 'rate_limit.exceeded';

    case ServerInternalError = 'server.internal_error';

    /**
     * The HTTP status this code is served with unless the thrower overrides
     * it. One code maps to exactly one status in this phase.
     */
    public function status(): int
    {
        return match ($this) {
            self::ContextOrganisationRequired, self::ContextBranchRequired, self::RequestInvalid => 400,
            self::AuthUnauthenticated, self::GuestSessionInvalid => 401,
            self::AuthEmailUnverified,
            self::AuthTwoFactorRequired,
            self::AuthStepUpRequired,
            self::AuthInvalidSignature,
            self::ContextOrganisationForbidden,
            self::ContextBranchOutOfScope,
            self::AccountVerificationRequired,
            self::B2bSignatoryRequired,
            self::AuthzPermissionDenied,
            self::CartChannelRefused => 403,
            self::ResourceNotFound => 404,
            self::ResourceConflict,
            self::OrganisationSuspended,
            self::CatalogueInUse,
            self::CatalogueVersionImmutable,
            self::CataloguePublishBlocked,
            self::RequestIdempotencyKeyReused,
            self::ContactAlreadyInUse,
            self::OrderPlacementRefused,
            self::B2bApplicationStateInvalid,
            self::B2bQuotationStateInvalid,
            self::SubscriptionRefused,
            self::SubscriptionChangeRefused,
            self::ClosureRefused,
            self::OffboardingRefused,
            self::OffboardingSettlementOutstanding,
            self::RecordExportUnavailable => 409,
            self::RequestPreconditionRequired => 428,
            self::AuthCsrfTokenMismatch => 419,
            self::ValidationFailed,
            self::AuthInvalidCredentials,
            self::AuthTwoFactorInvalid,
            self::CatalogueAllergenUnmapped,
            self::OtpInvalid,
            self::OtpExpired,
            self::OtpChannelUnavailable,
            self::AddressAreaNotServed,
            self::CartLineRefused,
            self::B2bDocumentsIncomplete,
            self::B2bQuotationEmpty => 422,
            self::RateLimitExceeded,
            self::OtpAttemptsExceeded,
            self::OtpCooldownActive,
            self::OtpLocked => 429,
            self::ServerInternalError => 500,
        };
    }

    /**
     * A safe, human-readable summary. Never a stack trace, never another
     * tenant's data, and never a hint about whether an account exists.
     */
    public function message(): string
    {
        return match ($this) {
            self::ValidationFailed => 'The submitted data is invalid.',
            self::AuthUnauthenticated => 'Authentication is required for this endpoint.',
            self::AuthInvalidCredentials => 'These credentials do not match our records.',
            self::AuthEmailUnverified => 'Your email address must be verified before you can use this endpoint.',
            self::AuthTwoFactorRequired => 'A two-factor authentication code is required.',
            self::AuthTwoFactorInvalid => 'The provided two-factor authentication code was invalid.',
            self::AuthStepUpRequired => 'This action requires you to confirm your password again.',
            self::AuthCsrfTokenMismatch => 'The CSRF token is missing or has expired.',
            self::AuthInvalidSignature => 'This link is invalid or has expired. Please request a new one.',
            self::ContextOrganisationRequired => 'An X-Organisation-Id header is required for this endpoint.',
            self::ContextOrganisationForbidden => 'You do not have an active membership in the requested organisation.',
            self::ContextBranchOutOfScope => 'The requested branch is not within your membership scope.',
            self::ContextBranchRequired => 'An X-Branch-Id header is required for this endpoint.',
            self::AuthzPermissionDenied => 'You do not have permission to perform this action.',
            self::RequestInvalid => 'The request could not be processed as sent.',
            self::RequestPreconditionRequired => 'This resource requires an If-Match header carrying the version you last read.',
            self::ResourceNotFound => 'The requested resource does not exist.',
            self::ResourceConflict => 'The requested change conflicts with the current state of the resource.',
            self::OrganisationSuspended => 'This organisation has been suspended by the platform.',
            self::CatalogueInUse => 'This record is still referenced by a recipe version that has not been retired.',
            self::CatalogueVersionImmutable => 'A published or retired recipe version cannot be changed. Create a new draft version instead.',
            self::CatalogueAllergenUnmapped => 'Every ingredient in a published recipe must carry an allergen determination.',
            self::CataloguePublishBlocked => 'This recipe version is not ready to be published.',
            self::RequestIdempotencyKeyReused => 'This Idempotency-Key has already been used for a different request.',
            self::OtpInvalid => 'That code is not correct. Check the message and try again.',
            self::OtpExpired => 'That code is no longer valid. Ask for a new one.',
            self::OtpAttemptsExceeded => 'Too many incorrect codes. Ask for a new one.',
            self::OtpCooldownActive => 'A code was sent a moment ago. Wait before asking for another.',
            self::OtpLocked => 'Too many attempts on this contact. Try again later.',
            self::OtpChannelUnavailable => 'A code cannot be sent to that destination on this channel.',
            self::ContactAlreadyInUse => 'That contact is already verified on another account.',
            self::AccountVerificationRequired => 'Your account is not fully set up yet.',
            self::AddressAreaNotServed => 'No kitchen currently delivers to that area.',
            self::GuestSessionInvalid => 'This guest session is not valid for that action.',
            self::CartLineRefused => 'This item cannot be added to the basket as asked for.',
            self::CartChannelRefused => 'This sales channel is only available to corporate buyer accounts.',
            self::OrderPlacementRefused => 'This order cannot be placed as it stands.',
            self::B2bApplicationStateInvalid => 'This application cannot be changed from its current state.',
            self::B2bDocumentsIncomplete => 'The required documents are not all present and accepted.',
            self::B2bSignatoryRequired => 'Signing requires a verified passcode from the named signatory.',
            self::B2bQuotationStateInvalid => 'This quotation cannot be changed from its current state.',
            self::B2bQuotationEmpty => 'This quotation has no lines to submit.',
            self::SubscriptionRefused => 'This subscription cannot be started as it stands.',
            self::SubscriptionChangeRefused => 'This change cannot be made to the subscription as it stands.',
            self::ClosureRefused => 'This closure request cannot be handled as asked for.',
            self::OffboardingRefused => 'This offboarding cannot do that from its current state.',
            self::OffboardingSettlementOutstanding => 'Settlement is not resolved, so this offboarding cannot move to sign-off.',
            self::RecordExportUnavailable => 'This records bundle is not available to download.',
            self::RateLimitExceeded => 'Too many requests. Please retry later.',
            self::ServerInternalError => 'An unexpected error occurred. The correlation identifier can be quoted to support.',
        };
    }

    /**
     * The code an unmapped HTTP error status is reported as. Used only as the
     * last step of exception rendering, so that no framework-generated error
     * can escape the envelope.
     */
    public static function forHttpStatus(int $status): self
    {
        return match ($status) {
            401 => self::AuthUnauthenticated,
            403 => self::AuthzPermissionDenied,
            404 => self::ResourceNotFound,
            409 => self::ResourceConflict,
            419 => self::AuthCsrfTokenMismatch,
            422 => self::ValidationFailed,
            428 => self::RequestPreconditionRequired,
            429 => self::RateLimitExceeded,
            default => $status >= 400 && $status < 500 ? self::RequestInvalid : self::ServerInternalError,
        };
    }
}
