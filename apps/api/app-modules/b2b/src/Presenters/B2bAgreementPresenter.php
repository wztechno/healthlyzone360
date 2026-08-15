<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Models\B2bAgreement;

/**
 * The wire shape of one version of a corporate agreement.
 *
 * **The signature block is evidence, and it is served as evidence.** The
 * document digest, the typed name, the stated capacity and the consent wording
 * verbatim all appear, because the whole point of click-wrap is that the
 * signatory can afterwards see precisely what they were shown and what they
 * accepted. What does *not* appear is anything that could be replayed:
 * `signature_ip_hash` and `signature_user_agent_hash` are corroboration for a
 * dispute, not facts a client needs, and `signature_otp_challenge_id` is
 * reduced to the boolean `signature_otp_verified` — the challenge identifier
 * itself is an internal key and handing it out invites a caller to reason
 * about somebody else's passcodes.
 *
 * **`signature_otp_verified` is derived from the column, not from a claim.**
 * `AgreementService::sign()` refuses without a consumed `b2b_signatory`
 * challenge belonging to the person signing, so a stamped challenge id *is*
 * the proof and `true` here means exactly that.
 *
 * **Nothing here may be described as a qualified electronic signature**, on any
 * surface that consumes this shape (master plan v2 Phase B1; INT-007 covers
 * real e-sign). This is a record that somebody clicked, with good evidence
 * about who and when.
 *
 * Money is integers of minor units with the currency beside it, never
 * formatted — `4500` with `AED`, never `"45.00 AED"`. And `payment_terms` is a
 * term *recorded*, not enforced: no invoicing exists (PAY1 is discovery-gated)
 * and nothing in the platform will chase a net-30 balance.
 */
final class B2bAgreementPresenter
{
    /**
     * @return array{
     *     id: string,
     *     b2b_application_id: string,
     *     organisation_id: string|null,
     *     version: int,
     *     supersedes_agreement_id: string|null,
     *     status: string,
     *     title: string,
     *     currency_code: string|null,
     *     price_list_id: string|null,
     *     payment_terms: string|null,
     *     credit_limit_minor: int|null,
     *     minimum_order_minor: int|null,
     *     delivery_lead_time_days: int|null,
     *     notice_period_days: int|null,
     *     starts_on: string|null,
     *     ends_on: string|null,
     *     auto_renews: bool,
     *     terms_summary: string|null,
     *     signature_document_sha256: string|null,
     *     signatory_name: string|null,
     *     signatory_title: string|null,
     *     signatory_user_id: string|null,
     *     signature_consent_statement: string|null,
     *     signature_otp_verified: bool,
     *     signed_at: string|null,
     *     activated_at: string|null,
     *     suspended_at: string|null,
     *     terminated_at: string|null,
     *     termination_reason: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function agreement(B2bAgreement $agreement): array
    {
        return [
            'id' => (string) $agreement->getKey(),
            'b2b_application_id' => $agreement->b2b_application_id,
            // Read through `getAttribute()`: provisioning's anchor was added to
            // the table by the migration that wires it and is not declared on
            // the model, so naming it magically would be a static-analysis
            // error rather than a fact a reader can check.
            'organisation_id' => $this->nullableString($agreement, 'organisation_id'),
            'version' => $agreement->version,
            'supersedes_agreement_id' => $agreement->supersedes_agreement_id,
            'status' => $agreement->status->value,
            'title' => $agreement->title,
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
            'signature_document_sha256' => $agreement->signature_document_sha256,
            'signatory_name' => $agreement->signatory_name,
            'signatory_title' => $agreement->signatory_title,
            'signatory_user_id' => $agreement->signatory_user_id,
            'signature_consent_statement' => $agreement->signature_consent_statement,
            'signature_otp_verified' => $agreement->signature_otp_challenge_id !== null,
            'signed_at' => $agreement->signed_at?->toIso8601String(),
            'activated_at' => $agreement->activated_at?->toIso8601String(),
            'suspended_at' => $agreement->suspended_at?->toIso8601String(),
            'terminated_at' => $agreement->terminated_at?->toIso8601String(),
            'termination_reason' => $agreement->termination_reason,
            'lock_version' => $agreement->lock_version,
            'created_at' => $agreement->created_at?->toIso8601String(),
            'updated_at' => $agreement->updated_at?->toIso8601String(),
        ];
    }

    private function nullableString(B2bAgreement $agreement, string $attribute): ?string
    {
        $value = $agreement->getAttribute($attribute);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
