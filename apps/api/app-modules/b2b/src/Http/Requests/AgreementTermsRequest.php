<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Requests;

use Healthy360\B2b\Enums\PaymentTerms;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The body of a platform agreement draft or edit.
 *
 * Shape only. Whether a price list is agreement-scoped, in the right currency
 * and free is `AgreementService`'s call, because it is also the rule for every
 * other way an agreement is written.
 */
class AgreementTermsRequest extends FormRequest
{
    /**
     * The terms a reviewer may set, in the order `AgreementService` applies
     * them. `title` travels separately on a draft.
     *
     * @var list<string>
     */
    private const array TERMS = [
        'currency_code',
        'price_list_id',
        'payment_terms',
        'credit_limit_minor',
        'minimum_order_minor',
        'delivery_lead_time_days',
        'notice_period_days',
        'starts_on',
        'ends_on',
        'auto_renews',
        'terms_summary',
    ];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $draft = $this->isMethod('POST');

        return [
            'title' => [$draft ? 'required' : 'sometimes', 'string', 'max:160'],
            'currency_code' => ['sometimes', 'nullable', 'string', 'size:3'],
            'price_list_id' => ['sometimes', 'nullable', 'uuid'],
            'payment_terms' => ['sometimes', 'nullable', Rule::enum(PaymentTerms::class)],
            'credit_limit_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'minimum_order_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'delivery_lead_time_days' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:365'],
            'notice_period_days' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:3650'],
            'starts_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'ends_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'auto_renews' => ['sometimes', 'boolean'],
            'terms_summary' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ];
    }

    public function title(): string
    {
        return (string) $this->validated('title', '');
    }

    /**
     * The terms the body actually sent — an absent key leaves a term alone.
     *
     * @return array<string, mixed>
     */
    public function terms(): array
    {
        $terms = [];

        foreach (self::TERMS as $field) {
            if ($this->has($field)) {
                $terms[$field] = $this->validated($field);
            }
        }

        if ($this->isMethod('PATCH') && $this->has('title')) {
            $terms['title'] = $this->validated('title');
        }

        return $terms;
    }
}
