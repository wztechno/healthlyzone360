<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Healthy360\B2b\Enums\PaymentTerms;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for one step of the application wizard.
 *
 * **The rules describe every field on the application, and the *section* is
 * what narrows them.** That looks back-to-front until you notice where the
 * narrowing has to live: `ApplicationSection::fields()` is the allowlist, the
 * service checks the payload against it, and the refusal it produces names the
 * section that actually owns the stray key. Restating that mapping here would
 * be a second copy of the wizard's shape — one that would drift the first time
 * a field moved between steps — and it would answer "that field is not
 * allowed" where the service answers "that field belongs to the company step".
 *
 * So this class does the job a `FormRequest` is genuinely good at: **types**.
 * `lead_time_days` is an integer or it is nothing; `product_categories` is a
 * list of strings; `incorporated_on` is a date written the one way dates are
 * written. Whether a given field may be written *now* is a question about
 * state, and state is the service's.
 *
 * Everything is `sometimes`, because a section PATCH carries only that
 * section's answers and a rule that demanded the rest would make the wizard
 * unusable. Completeness is checked once, at submission, by the server's own
 * definition of it.
 *
 * `status`, `completed_sections`, `lock_version` and every decision column are
 * absent by construction: those are the server's, and `completed_sections` in
 * particular is written as a *consequence* of a section being saved rather
 * than as a claim a client may post.
 */
class UpdateApplicationSectionRequest extends FormRequest
{
    /**
     * Authorisation is ownership, and ownership is the service's
     * `applicant_user_id` check; a form request that also guessed would give
     * two answers to one question.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // Company.
            'legal_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'legal_name_ar' => ['sometimes', 'nullable', 'string', 'max:255'],
            'trading_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'business_type' => ['sometimes', 'nullable', 'string', 'max:80'],
            'country_code' => ['sometimes', 'nullable', 'string', 'size:2'],
            'commercial_registration_number' => ['sometimes', 'nullable', 'string', 'max:80'],
            'tax_registration_number' => ['sometimes', 'nullable', 'string', 'max:80'],
            'incorporated_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'website' => ['sometimes', 'nullable', 'string', 'max:255'],

            // Signatory.
            'signatory_name' => ['sometimes', 'nullable', 'string', 'max:160'],
            'signatory_title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'signatory_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'signatory_phone' => ['sometimes', 'nullable', 'string', 'max:32'],

            // Trade terms. `requested_credit_limit_minor` is minor units of the
            // stated currency and is never a decimal: §4.4 forbids a money
            // amount that is not an integer beside its currency.
            'requested_payment_terms' => ['sometimes', 'nullable', new Enum(PaymentTerms::class)],
            'requested_credit_limit_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'currency_code' => ['sometimes', 'nullable', 'string', 'size:3'],
            'expected_volume_band' => ['sometimes', 'nullable', 'string', 'max:40'],
            'expected_order_frequency' => ['sometimes', 'nullable', 'string', 'max:40'],
            'product_categories' => ['sometimes', 'nullable', 'array', 'max:40'],
            'product_categories.*' => ['string', 'max:80'],

            // Logistics.
            'preferred_delivery_window' => ['sometimes', 'nullable', 'string', 'max:60'],
            'lead_time_days' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:365'],
            'requires_invoice_per_location' => ['sometimes', 'boolean'],
            'delivery_notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }

    /**
     * The validated body **plus every key the client sent that these rules do
     * not describe**, so the service can refuse it by name.
     *
     * Silently dropping a field somebody believed they were saving is how a
     * five-minute bug becomes a support ticket about vanishing data six weeks
     * later. Passing the stray key through means the answer is "that field
     * belongs to the signatory step" or "that is not a field on a B2B
     * application" — which is the thing the client needs to know.
     *
     * The return type is the loose one for the same reason the catalogue's
     * `payload()` is: the value deliberately carries keys no shape can
     * enumerate, and a tighter annotation would be a lie a static analyser
     * would believe.
     *
     * @return array<string, mixed>
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        $described = array_keys($this->rules());

        /** @var array<string, mixed> $body */
        $body = $this->all();

        foreach ($body as $field => $value) {
            if (in_array($field, $described, true)) {
                continue;
            }

            $validated[$field] = $value;
        }

        return $validated;
    }
}
