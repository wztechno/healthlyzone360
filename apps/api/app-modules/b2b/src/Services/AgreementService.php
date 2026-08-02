<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\PaymentTerms;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;

/**
 * Drafting terms, versioning them, and recording that somebody accepted them.
 *
 * ## Versioning
 *
 * `draft()` on an application that already has agreements produces the next
 * version, pointed at its predecessor. `amend()` is the same act made explicit:
 * it takes an agreement in force and returns a fresh draft carrying its terms
 * forward, because the way to change what is in force is to replace it, never
 * to edit it. An active agreement is immutable, and `update()` refuses on the
 * state rather than on a permission — the record somebody accepted has to stay
 * the record somebody accepted.
 *
 * ## Signing — a shell, and honest about it
 *
 * `sign()` records click-wrap evidence: the digest of the exact document
 * shown, the signatory's typed name and stated title, the consent wording
 * verbatim, and hashed session corroboration. That evidence is real and is
 * what a dispute would rest on.
 *
 * **What it does not do is verify an OTP.** `signature_otp_challenge_id` is
 * recorded if the caller supplies one, and is not checked against anything:
 * the verification module is being built in parallel (J1) and B1 has no way to
 * confirm a challenge was ever completed. The column carries no foreign key
 * for the same reason. `SigningEvidence::$otpVerified` is `false` on every
 * signature this phase produces, and the flag exists so that a later reader
 * can tell a stepped-up signature from an un-stepped-up one rather than
 * assuming.
 *
 * **This is never a qualified electronic signature** and no surface may
 * describe it as one (master plan v2 Phase B1; INT-007 covers real e-sign).
 *
 * ## Prices
 *
 * `price_list_id` must name a list whose `customer_scope` is `agreement`.
 * Pointing an agreement at a public tariff would quietly publish a negotiated
 * position, and pointing two buyers at one agreement list is the leak K1.5
 * built the scope column to prevent.
 */
final readonly class AgreementService
{
    public function __construct(
        private AuditRecorder $audit,
    ) {}

    /**
     * A new draft — version 1, or the next one after the latest.
     *
     * @param  array<string, mixed>  $terms
     *
     * @throws ApiException
     */
    public function draft(B2bApplication $application, string $title, array $terms, User $actor): B2bAgreement
    {
        $name = trim($title);

        if ($name === '') {
            throw $this->invalid('title', 'An agreement needs a title people can identify it by.');
        }

        return DB::transaction(function () use ($application, $name, $terms, $actor): B2bAgreement {
            $latest = B2bAgreement::query()
                ->where('b2b_application_id', $application->getKey())
                ->orderByDesc('version')
                ->lockForUpdate()
                ->first();

            $agreement = new B2bAgreement;
            $agreement->b2b_application_id = (string) $application->getKey();
            $agreement->version = $latest instanceof B2bAgreement ? $latest->version + 1 : 1;
            $agreement->supersedes_agreement_id = $latest?->getKey() === null ? null : (string) $latest->getKey();
            $agreement->status = AgreementStatus::Draft;
            $agreement->title = $name;
            $agreement->lock_version = 0;
            $agreement->created_by = (string) $actor->getKey();
            $agreement->updated_by = (string) $actor->getKey();

            $this->applyTerms($agreement, $terms);
            $agreement->save();

            $this->audit->record(
                'b2b.agreement_drafted',
                actorUserId: (string) $actor->getKey(),
                subjectType: 'b2b_agreement',
                subjectId: (string) $agreement->getKey(),
                metadata: [
                    'b2b_application_id' => (string) $application->getKey(),
                    'version' => $agreement->version,
                    'supersedes_agreement_id' => $agreement->supersedes_agreement_id,
                ],
            );

            return $agreement;
        });
    }

    /**
     * Change a draft's terms. Only a draft.
     *
     * @param  array<string, mixed>  $terms
     *
     * @throws ApiException
     */
    public function update(B2bAgreement $agreement, array $terms, User $actor): B2bAgreement
    {
        if (! $agreement->isEditable()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This agreement has left draft. Amend it with a new version instead of editing the one that was put in front of somebody.',
                ['status' => $agreement->status->value, 'current_lock_version' => $agreement->lock_version],
            );
        }

        $this->applyTerms($agreement, $terms);
        $agreement->updated_by = (string) $actor->getKey();
        $agreement->lock_version = $agreement->lock_version + 1;
        $agreement->save();

        $this->audit->record(
            'b2b.agreement_updated',
            actorUserId: (string) $actor->getKey(),
            subjectType: 'b2b_agreement',
            subjectId: (string) $agreement->getKey(),
            metadata: ['version' => $agreement->version, 'changed_fields' => array_keys($terms)],
        );

        return $agreement;
    }

    /**
     * Carry an existing agreement's terms into a new draft version.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws ApiException
     */
    public function amend(B2bAgreement $agreement, array $changes, User $actor): B2bAgreement
    {
        $application = $agreement->application;

        if (! $application instanceof B2bApplication) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'The requested resource does not exist.');
        }

        return $this->draft($application, $agreement->title, $this->currentTerms($agreement) + $changes, $actor);
    }

    /**
     * Put a draft in front of the signatory.
     *
     * @throws ApiException
     */
    public function sendForSignature(B2bAgreement $agreement, User $actor): B2bAgreement
    {
        return $this->transition($agreement, AgreementStatus::PendingSignature, $actor, []);
    }

    /**
     * Record acceptance — evidence only, no OTP verification (see the class
     * comment).
     *
     * @throws ApiException
     */
    public function sign(B2bAgreement $agreement, SigningEvidence $evidence, User $actor): B2bAgreement
    {
        if ($agreement->status !== AgreementStatus::PendingSignature) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'Only an agreement that has been sent for signature can be signed.',
                ['status' => $agreement->status->value],
            );
        }

        $agreement->signature_document_sha256 = $evidence->documentSha256;
        $agreement->signatory_name = $evidence->signatoryName;
        $agreement->signatory_title = $evidence->signatoryTitle;
        $agreement->signatory_user_id = (string) $actor->getKey();
        $agreement->signature_consent_statement = $evidence->consentStatement;
        $agreement->signature_ip_hash = $evidence->ipHash;
        $agreement->signature_user_agent_hash = $evidence->userAgentHash;
        $agreement->signature_otp_challenge_id = $evidence->otpChallengeId;
        $agreement->signed_at = CarbonImmutable::now();

        if (! $agreement->hasSignatureEvidence()) {
            // The database CHECK says the same thing. Refusing here means the
            // caller gets a field-level message rather than a constraint
            // violation, and the constraint stays as the thing nothing can
            // route around.
            throw $this->invalid('signature', 'A signature has to record which document was shown, who accepted it, in what capacity, and the wording they accepted.');
        }

        return $this->transition($agreement, AgreementStatus::Active, $actor, [
            'activated_at' => CarbonImmutable::now(),
        ], [
            'otp_verified' => $evidence->otpVerified,
            'signature_otp_challenge_id' => $evidence->otpChallengeId,
        ]);
    }

    /**
     * @throws ApiException
     */
    public function suspend(B2bAgreement $agreement, User $actor, ?string $reason = null): B2bAgreement
    {
        return $this->transition($agreement, AgreementStatus::Suspended, $actor, [
            'suspended_at' => CarbonImmutable::now(),
        ], ['reason' => $reason]);
    }

    /**
     * @throws ApiException
     */
    public function reinstate(B2bAgreement $agreement, User $actor): B2bAgreement
    {
        return $this->transition($agreement, AgreementStatus::Active, $actor, [
            'suspended_at' => null,
        ]);
    }

    /**
     * @throws ApiException
     */
    public function terminate(B2bAgreement $agreement, User $actor, string $reason): B2bAgreement
    {
        $trimmed = trim($reason);

        if ($trimmed === '') {
            throw $this->invalid('termination_reason', 'Ending an agreement has to say why.');
        }

        return $this->transition($agreement, AgreementStatus::Terminated, $actor, [
            'terminated_at' => CarbonImmutable::now(),
            'termination_reason' => mb_substr($trimmed, 0, 40),
        ]);
    }

    /**
     * @param  array<string, mixed>  $changes
     * @param  array<string, scalar|list<scalar>|null>  $metadata
     *
     * @throws ApiException
     */
    private function transition(
        B2bAgreement $agreement,
        AgreementStatus $next,
        User $actor,
        array $changes,
        array $metadata = [],
    ): B2bAgreement {
        $current = $agreement->status;

        if (! $current->canTransitionTo($next)) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                "An agreement that is {$current->value} cannot become {$next->value}.",
                [
                    'status' => $current->value,
                    'requested_status' => $next->value,
                    'allowed_transitions' => array_map(
                        static fn (AgreementStatus $status): string => $status->value,
                        $current->allowedTransitions(),
                    ),
                ],
            );
        }

        foreach ($changes as $column => $value) {
            $agreement->setAttribute($column, $value);
        }

        $agreement->status = $next;
        $agreement->updated_by = (string) $actor->getKey();
        $agreement->lock_version = $agreement->lock_version + 1;
        $agreement->save();

        $this->audit->record(
            'b2b.agreement_'.$next->value,
            actorUserId: (string) $actor->getKey(),
            subjectType: 'b2b_agreement',
            subjectId: (string) $agreement->getKey(),
            metadata: $metadata + [
                'from_status' => $current->value,
                'to_status' => $next->value,
                'version' => $agreement->version,
            ],
        );

        return $agreement;
    }

    /**
     * @param  array<string, mixed>  $terms
     *
     * @throws ApiException
     */
    private function applyTerms(B2bAgreement $agreement, array $terms): void
    {
        foreach ($terms as $field => $value) {
            match ($field) {
                'currency_code' => $agreement->currency_code = is_string($value) && trim($value) !== '' ? mb_strtoupper(trim($value)) : null,
                'price_list_id' => $agreement->price_list_id = $this->validatedPriceListId($value),
                'payment_terms' => $agreement->payment_terms = $this->validatedPaymentTerms($value),
                'credit_limit_minor' => $agreement->credit_limit_minor = $this->validatedMinor($value, 'credit_limit_minor'),
                'minimum_order_minor' => $agreement->minimum_order_minor = $this->validatedMinor($value, 'minimum_order_minor'),
                'delivery_lead_time_days' => $agreement->delivery_lead_time_days = $this->validatedDays($value, 'delivery_lead_time_days'),
                'notice_period_days' => $agreement->notice_period_days = $this->validatedDays($value, 'notice_period_days'),
                'starts_on' => $agreement->starts_on = $this->validatedDate($value, 'starts_on'),
                'ends_on' => $agreement->ends_on = $this->validatedDate($value, 'ends_on'),
                'auto_renews' => $agreement->auto_renews = (bool) $value,
                'terms_summary' => $agreement->terms_summary = is_string($value) && trim($value) !== '' ? trim($value) : null,
                'title' => $agreement->title = is_string($value) && trim($value) !== '' ? trim($value) : $agreement->title,
                default => throw $this->invalid($field, 'This is not a term on a B2B agreement.'),
            };
        }

        if (
            ($agreement->credit_limit_minor !== null || $agreement->minimum_order_minor !== null)
            && $agreement->currency_code === null
        ) {
            throw $this->invalid('currency_code', 'An amount without a currency is not a sum of anything (§4.4).');
        }

        if (
            $agreement->starts_on !== null
            && $agreement->ends_on !== null
            && $agreement->ends_on->lessThan($agreement->starts_on)
        ) {
            throw $this->invalid('ends_on', 'An agreement cannot end before it starts.');
        }
    }

    /**
     * The terms an amendment carries forward.
     *
     * @return array<string, mixed>
     */
    private function currentTerms(B2bAgreement $agreement): array
    {
        return [
            'currency_code' => $agreement->currency_code,
            'price_list_id' => $agreement->price_list_id,
            'payment_terms' => $agreement->payment_terms?->value,
            'credit_limit_minor' => $agreement->credit_limit_minor,
            'minimum_order_minor' => $agreement->minimum_order_minor,
            'delivery_lead_time_days' => $agreement->delivery_lead_time_days,
            'notice_period_days' => $agreement->notice_period_days,
            'starts_on' => $agreement->starts_on?->toDateString(),
            'ends_on' => $agreement->ends_on?->toDateString(),
            'auto_renews' => $agreement->auto_renews,
            'terms_summary' => $agreement->terms_summary,
        ];
    }

    /**
     * @throws ApiException
     */
    private function validatedPriceListId(mixed $value): ?string
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        $priceList = PriceList::withoutTenancy()->whereKey(trim($value))->first();

        if (! $priceList instanceof PriceList) {
            throw $this->invalid('price_list_id', 'That price list does not exist.');
        }

        if ($priceList->customer_scope !== CustomerScope::Agreement) {
            // Pointing an agreement at a public tariff would publish a
            // negotiated position by accident; pointing two buyers at one
            // agreement list is the leak the scope column exists to prevent.
            throw $this->invalid('price_list_id', 'An agreement prices from a negotiated list, not from a public tariff.');
        }

        return (string) $priceList->getKey();
    }

    /**
     * @throws ApiException
     */
    private function validatedPaymentTerms(mixed $value): ?PaymentTerms
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($value instanceof PaymentTerms) {
            return $value;
        }

        $terms = is_string($value) ? PaymentTerms::tryFrom($value) : null;

        if (! $terms instanceof PaymentTerms) {
            throw $this->invalid('payment_terms', 'Payment terms are prepaid, net 15, net 30 or net 60.');
        }

        return $terms;
    }

    /**
     * @throws ApiException
     */
    private function validatedMinor(mixed $value, string $field): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_int($value) || $value < 0) {
            throw $this->invalid($field, 'An amount is a whole number of minor units, zero or more.');
        }

        return $value;
    }

    /**
     * @throws ApiException
     */
    private function validatedDays(mixed $value, string $field): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_int($value) || $value < 0) {
            throw $this->invalid($field, 'A number of days is zero or more.');
        }

        return $value;
    }

    /**
     * @throws ApiException
     */
    private function validatedDate(mixed $value, string $field): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($value instanceof CarbonImmutable) {
            return $value;
        }

        if (! is_string($value)) {
            throw $this->invalid($field, 'A date is written as YYYY-MM-DD.');
        }

        try {
            return CarbonImmutable::parse($value)->startOfDay();
        } catch (\Throwable) {
            throw $this->invalid($field, 'A date is written as YYYY-MM-DD.');
        }
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
