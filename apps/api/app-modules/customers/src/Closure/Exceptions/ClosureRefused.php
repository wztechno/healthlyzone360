<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Exceptions;

use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\Contracts\ProvidesApiError;
use Healthy360\Support\Api\ErrorCode;
use RuntimeException;

/**
 * A closure the platform will not perform.
 *
 * **Distinct from a blocker, and the difference is who the answer is for.** A
 * blocker is part of the journey: "you have two orders in flight" is
 * information a customer acts on, it comes back inside a successful response,
 * and the request survives so they can come back when the food has arrived.
 * This exception is the other kind — a request that should not have been made
 * at all, because it is malformed, out of order, or aimed at somebody else's
 * account.
 *
 * Every named constructor carries a `reason` the API layer maps to an
 * `ErrorCode`. The reasons stay stable strings — this module does not own the
 * wire vocabulary — and `toApiError()` is where the two meet, added by the
 * integration wave alongside `closure.refused`.
 *
 * **Three reasons deliberately do not land on `closure.refused`.** A support
 * actor who tries to finish somebody else's erasure is `authz.permission_denied`
 * — a statement about the actor, not about the request. A passcode that did not
 * verify is `otp.invalid`, which is the one shape all four of wrong, expired,
 * superseded and locked-out collapse into; a distinct answer here would tell an
 * attacker holding a borrowed session which of their guesses was closest. And a
 * reason outside the vocabulary is `validation.failed`, because it is an input
 * that never should have been sent.
 */
final class ClosureRefused extends RuntimeException implements ProvidesApiError
{
    private function __construct(string $message, public readonly string $reason)
    {
        parent::__construct($message);
    }

    /**
     * A second request while one is still going somewhere.
     *
     * Refused rather than silently returning the existing one: the two may
     * differ in scope or reason, and quietly handing back an older request
     * would answer a question nobody asked.
     */
    public static function alreadyInFlight(): self
    {
        return new self('A closure request is already in progress for this account.', 'closure_already_in_flight');
    }

    /**
     * Proof offered for a request that is not waiting for any.
     */
    public static function notAwaitingVerification(): self
    {
        return new self('This closure request is not awaiting verification.', 'closure_not_awaiting_verification');
    }

    /**
     * The passcode did not verify — wrong, expired, superseded or locked out.
     *
     * One shape for all four, exactly as the guest deletion journey collapses
     * its refusals: distinguishing them would tell an attacker holding a
     * borrowed session which of their guesses was closest.
     */
    public static function verificationFailed(): self
    {
        return new self('That code could not be verified.', 'closure_verification_failed');
    }

    /**
     * No destination to send a passcode to.
     *
     * A real state, not a defect: somebody may hold a login whose contact point
     * was retired. Refusing here is better than closing the account without
     * proof because proof was inconvenient to obtain.
     */
    public static function noVerifiableContact(): self
    {
        return new self('This account has no verified contact point to send a code to.', 'closure_no_verifiable_contact');
    }

    /**
     * A support actor tried to verify a closure themselves.
     *
     * The one rule the support-initiated variant exists to enforce. Support may
     * open a closure on somebody's behalf; the proof still goes to the
     * customer's own destination and is entered by the customer, because a
     * journey where staff can both start and finish an erasure is a journey
     * where an erasure needs no customer at all.
     */
    public static function supportCannotSelfVerify(): self
    {
        return new self('A closure opened on a customer\'s behalf must be verified by the customer.', 'closure_support_cannot_self_verify');
    }

    /**
     * A cancellation arriving after there is anything left to cancel.
     */
    public static function notCancellable(): self
    {
        return new self('This closure request can no longer be cancelled.', 'closure_not_cancellable');
    }

    /**
     * A note was supplied against a reason that has no room for one, or the
     * request named a reason outside the vocabulary.
     */
    public static function unknownReason(string $code): self
    {
        return new self("'{$code}' is not a closure reason.", 'closure_unknown_reason');
    }

    public function toApiError(): ApiError
    {
        $code = match ($this->reason) {
            'closure_support_cannot_self_verify' => ErrorCode::AuthzPermissionDenied,
            'closure_verification_failed' => ErrorCode::OtpInvalid,
            'closure_unknown_reason' => ErrorCode::ValidationFailed,
            default => ErrorCode::ClosureRefused,
        };

        return ApiError::make($code, $this->getMessage(), ['reason' => $this->reason]);
    }
}
