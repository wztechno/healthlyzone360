<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\B2b\Enums\ApplicationSection;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\B2bApplicationContact;
use Healthy360\B2b\Models\B2bApplicationLocation;

/**
 * The wire shapes of a B2B application.
 *
 * **One presenter for the applicant and the reviewer, and that is a decision
 * rather than an oversight.** Everything on `b2b_applications` was typed in by
 * the applicant or is a fact about the decision taken on it — there is no
 * column here a reviewer may see and the company may not. `decision_note` is
 * the one that looks like a counter-example and is not: it is the internal
 * half of a verdict, so it is served **only** by `review()` and is absent from
 * the applicant shape by construction rather than by a flag. Two shapes with a
 * boolean between them is one wrong argument away from leaking; two methods
 * cannot be called wrongly.
 *
 * `applicant_message` is the opposite case and is served to both, because it is
 * the half of the verdict the applicant is *meant* to read.
 *
 * `completed_sections` is echoed back as what it is — the applicant's own claim
 * about their progress, never consulted by the submission gate. The server's
 * definition of complete arrives as `missing_fields` / `missing_documents` on
 * the refusal, and a surface that treated the claim as the answer would show a
 * green wizard next to a 422.
 *
 * No `lock_version` is hidden and none is decorative: it is the `ETag` every
 * write on this resource sends back as `If-Match`.
 */
final class B2bApplicationPresenter
{
    /**
     * The applicant's own view.
     *
     * @return array{
     *     id: string,
     *     reference: string,
     *     status: string,
     *     applicant_user_id: string,
     *     legal_name: string|null,
     *     legal_name_ar: string|null,
     *     trading_name: string|null,
     *     business_type: string|null,
     *     country_code: string|null,
     *     commercial_registration_number: string|null,
     *     tax_registration_number: string|null,
     *     incorporated_on: string|null,
     *     website: string|null,
     *     signatory_name: string|null,
     *     signatory_title: string|null,
     *     signatory_email: string|null,
     *     signatory_phone: string|null,
     *     requested_payment_terms: string|null,
     *     requested_credit_limit_minor: int|null,
     *     currency_code: string|null,
     *     expected_volume_band: string|null,
     *     expected_order_frequency: string|null,
     *     product_categories: list<string>,
     *     preferred_delivery_window: string|null,
     *     lead_time_days: int|null,
     *     requires_invoice_per_location: bool,
     *     delivery_notes: string|null,
     *     completed_sections: list<string>,
     *     writable_sections: list<string>,
     *     information_request: string|null,
     *     information_requested_sections: list<string>,
     *     information_requested_at: string|null,
     *     applicant_message: string|null,
     *     submitted_at: string|null,
     *     review_started_at: string|null,
     *     decided_at: string|null,
     *     withdrawn_at: string|null,
     *     provisioned_organisation_id: string|null,
     *     customer_account_id: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function application(B2bApplication $application): array
    {
        return [
            'id' => (string) $application->getKey(),
            'reference' => $application->reference,
            'status' => $application->status->value,
            'applicant_user_id' => $application->applicant_user_id,
            'legal_name' => $application->legal_name,
            'legal_name_ar' => $application->legal_name_ar,
            'trading_name' => $application->trading_name,
            'business_type' => $application->business_type,
            'country_code' => $application->country_code,
            'commercial_registration_number' => $application->commercial_registration_number,
            'tax_registration_number' => $application->tax_registration_number,
            'incorporated_on' => $application->incorporated_on?->toDateString(),
            'website' => $application->website,
            'signatory_name' => $application->signatory_name,
            'signatory_title' => $application->signatory_title,
            'signatory_email' => $application->signatory_email,
            'signatory_phone' => $application->signatory_phone,
            'requested_payment_terms' => $application->requested_payment_terms?->value,
            'requested_credit_limit_minor' => $application->requested_credit_limit_minor,
            'currency_code' => $application->currency_code,
            'expected_volume_band' => $application->expected_volume_band,
            'expected_order_frequency' => $application->expected_order_frequency,
            'product_categories' => $application->product_categories ?? [],
            'preferred_delivery_window' => $application->preferred_delivery_window,
            'lead_time_days' => $application->lead_time_days,
            'requires_invoice_per_location' => $application->requires_invoice_per_location,
            'delivery_notes' => $application->delivery_notes,
            'completed_sections' => $application->completed_sections,
            // What the applicant may edit right now, computed rather than
            // stored. In `info_requested` this is the reviewer's narrowing,
            // and a wizard that had to infer it from the status alone would
            // reopen the whole form.
            'writable_sections' => array_map(
                static fn (ApplicationSection $section): string => $section->value,
                $application->writableSections(),
            ),
            'information_request' => $application->information_request,
            'information_requested_sections' => $application->information_requested_sections ?? [],
            'information_requested_at' => $application->information_requested_at?->toIso8601String(),
            'applicant_message' => $application->applicant_message,
            'submitted_at' => $application->submitted_at?->toIso8601String(),
            'review_started_at' => $application->review_started_at?->toIso8601String(),
            'decided_at' => $application->decided_at?->toIso8601String(),
            'withdrawn_at' => $application->withdrawn_at?->toIso8601String(),
            // Read through `getAttribute()` rather than as properties: the two
            // provisioning links were added to the table by the migration that
            // wires them and are not declared on the model, so naming them
            // magically here would be a static-analysis error rather than a
            // fact the reader can check.
            'provisioned_organisation_id' => $this->nullableString($application, 'provisioned_organisation_id'),
            'customer_account_id' => $this->nullableString($application, 'customer_account_id'),
            'lock_version' => $application->lock_version,
            'created_at' => $application->created_at?->toIso8601String(),
            'updated_at' => $application->updated_at?->toIso8601String(),
        ];
    }

    /**
     * The reviewer's view: everything the applicant sees, plus the internal
     * half of the decision and who is holding the file.
     *
     * @return array<string, mixed>
     */
    public function review(B2bApplication $application): array
    {
        return $this->application($application) + [
            'decision_note' => $application->decision_note,
            'reviewed_by' => $application->reviewed_by,
            'duplicate_of_application_id' => $application->duplicate_of_application_id,
        ];
    }

    /**
     * The list row — a queue entry, not a file.
     *
     * Deliberately thin. A reviewer's queue answers "which of these do I open
     * next", and every confidential field carried in a list is a field
     * displayed on a screen somebody walks past.
     *
     * @return array{
     *     id: string,
     *     reference: string,
     *     status: string,
     *     legal_name: string|null,
     *     trading_name: string|null,
     *     country_code: string|null,
     *     submitted_at: string|null,
     *     decided_at: string|null,
     *     reviewed_by: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function summary(B2bApplication $application): array
    {
        return [
            'id' => (string) $application->getKey(),
            'reference' => $application->reference,
            'status' => $application->status->value,
            'legal_name' => $application->legal_name,
            'trading_name' => $application->trading_name,
            'country_code' => $application->country_code,
            'submitted_at' => $application->submitted_at?->toIso8601String(),
            'decided_at' => $application->decided_at?->toIso8601String(),
            'reviewed_by' => $application->reviewed_by,
            'lock_version' => $application->lock_version,
            'created_at' => $application->created_at?->toIso8601String(),
            'updated_at' => $application->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     role: string,
     *     name: string,
     *     title: string|null,
     *     email: string|null,
     *     phone: string|null,
     *     notes: string|null
     * }
     */
    public function contact(B2bApplicationContact $contact): array
    {
        return [
            'id' => (string) $contact->getKey(),
            'role' => $contact->role->value,
            'name' => $contact->name,
            'title' => $contact->title,
            'email' => $contact->email,
            'phone' => $contact->phone,
            'notes' => $contact->notes,
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     label: string,
     *     delivery_area_id: string|null,
     *     address_line1: string,
     *     address_line2: string|null,
     *     city: string|null,
     *     country_code: string|null,
     *     contact_name: string|null,
     *     contact_phone: string|null,
     *     delivery_notes: string|null,
     *     is_primary: bool,
     *     is_billing_address: bool,
     *     expected_headcount: int|null
     * }
     */
    public function location(B2bApplicationLocation $location): array
    {
        return [
            'id' => (string) $location->getKey(),
            'label' => $location->label,
            'delivery_area_id' => $location->delivery_area_id,
            'address_line1' => $location->address_line1,
            'address_line2' => $location->address_line2,
            'city' => $location->city,
            'country_code' => $location->country_code,
            'contact_name' => $location->contact_name,
            'contact_phone' => $location->contact_phone,
            'delivery_notes' => $location->delivery_notes,
            'is_primary' => $location->is_primary,
            'is_billing_address' => $location->is_billing_address,
            'expected_headcount' => $location->expected_headcount,
        ];
    }

    private function nullableString(B2bApplication $application, string $attribute): ?string
    {
        $value = $application->getAttribute($attribute);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
