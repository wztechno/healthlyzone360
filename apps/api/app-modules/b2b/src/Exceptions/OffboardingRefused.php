<?php

declare(strict_types=1);

namespace Healthy360\B2b\Exceptions;

use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\Contracts\ProvidesApiError;
use Healthy360\Support\Api\ErrorCode;
use RuntimeException;

/**
 * An offboarding was asked to do something it cannot.
 *
 * **Stable reason strings rather than error codes**, per the convention J1
 * established and G1 and C1 followed: the wire vocabulary belongs to the HTTP
 * follow-up, and a domain service that picked its own codes would be choosing
 * a public contract it does not own. `toApiError()` is where the two meet, and
 * it maps onto codes that **already exist** — B2 adds none, because the
 * `ErrorCode` enum is a shared file the integration wave owns.
 *
 * **The integration wave settled the codes B2 asked for**, in the two places
 * the reasons said they mattered:
 *
 * | reason | code |
 * |---|---|
 * | `offboarding.already_in_flight` | `offboarding.refused` |
 * | `offboarding.transition_not_allowed` | `offboarding.refused` |
 * | `offboarding.no_active_agreement` | `offboarding.refused` |
 * | `offboarding.settlement_outstanding` | `offboarding.settlement_outstanding` — a client branches on it to render the blocker list |
 * | `offboarding.waiver_not_permitted` | `authz.permission_denied` |
 * | `offboarding.not_a_corporate_customer` and the three shape refusals | `validation.failed` |
 * | `offboarding.signatory_required` | `b2b.signatory_required` |
 *
 * `details.reason` still carries the string on every one of them, so a client
 * that wants finer granularity than the code has it without a second lookup.
 */
final class OffboardingRefused extends RuntimeException implements ProvidesApiError
{
    /**
     * @param  array<string, scalar|list<string>|null>  $details
     */
    private function __construct(
        private readonly string $reason,
        string $message,
        private readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public static function alreadyInFlight(string $organisationId): self
    {
        return new self(
            'offboarding.already_in_flight',
            'This organisation is already being offboarded.',
            ['organisation_id' => $organisationId],
        );
    }

    public static function notCorporate(): self
    {
        return new self(
            'offboarding.not_a_corporate_customer',
            'Only a corporate customer organisation is offboarded this way.',
        );
    }

    public static function noActiveAgreement(): self
    {
        return new self(
            'offboarding.no_active_agreement',
            'There is no agreement in force to end.',
        );
    }

    public static function illegalTransition(OffboardingStatus $from, OffboardingStatus $to): self
    {
        return new self(
            'offboarding.transition_not_allowed',
            "An offboarding that is {$from->value} cannot become {$to->value}.",
            [
                'status' => $from->value,
                'requested_status' => $to->value,
                'allowed_transitions' => array_map(
                    static fn (OffboardingStatus $status): string => $status->value,
                    $from->allowedTransitions(),
                ),
            ],
        );
    }

    /**
     * Settlement is not resolved, with every blocker named.
     *
     * All of them, not the first, for the reason the account-activation
     * refusal gives: somebody winding up a relationship wants the list, not a
     * sequence of discoveries.
     *
     * @param  list<string>  $blockers
     */
    public static function settlementOutstanding(array $blockers): self
    {
        return new self(
            'offboarding.settlement_outstanding',
            'Settlement is not resolved, so this offboarding cannot move to sign-off.',
            ['blockers' => $blockers],
        );
    }

    public static function waiverNotPermitted(): self
    {
        return new self(
            'offboarding.waiver_not_permitted',
            'Setting aside an outstanding settlement position is not something this actor may do.',
        );
    }

    public static function waiverNeedsReason(): self
    {
        return new self(
            'offboarding.waiver_needs_reason',
            'Waiving settlement has to say why, because a waiver nobody explained is not a waiver.',
        );
    }

    public static function cancellationNeedsReason(): self
    {
        return new self(
            'offboarding.cancellation_needs_reason',
            'Calling off an offboarding has to say why.',
        );
    }

    public static function signatoryRequired(): self
    {
        return new self(
            'offboarding.signatory_required',
            'A sign-off needs a passcode the signatory has already spent.',
        );
    }

    public static function signoffEvidenceIncomplete(): self
    {
        return new self(
            'offboarding.signoff_evidence_incomplete',
            'A sign-off has to record who accepted, in what capacity, and the wording they accepted.',
        );
    }

    public static function noSignatoryContact(): self
    {
        return new self(
            'offboarding.no_signatory_contact',
            'The agreement names no signatory the platform can reach, so no passcode can be sent.',
        );
    }

    public function reason(): string
    {
        return $this->reason;
    }

    public function toApiError(): ApiError
    {
        $code = match ($this->reason) {
            'offboarding.waiver_not_permitted' => ErrorCode::AuthzPermissionDenied,
            'offboarding.not_a_corporate_customer',
            'offboarding.waiver_needs_reason',
            'offboarding.cancellation_needs_reason',
            'offboarding.signoff_evidence_incomplete',
            'offboarding.no_signatory_contact' => ErrorCode::ValidationFailed,
            'offboarding.signatory_required' => ErrorCode::B2bSignatoryRequired,
            'offboarding.settlement_outstanding' => ErrorCode::OffboardingSettlementOutstanding,
            default => ErrorCode::OffboardingRefused,
        };

        return ApiError::make($code, $this->getMessage(), ['reason' => $this->reason] + $this->details);
    }
}
