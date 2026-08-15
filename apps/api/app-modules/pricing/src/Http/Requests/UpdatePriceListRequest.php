<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Requests;

use Healthy360\Pricing\Enums\CustomerScope;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for editing a price list header.
 *
 * `code` is deliberately **not** in these rules and is refused by the service
 * rather than stripped here. Silently dropping a field a client believed it
 * was writing is how a caller learns nothing; a 422 saying "a price list code
 * is fixed when the list is created" teaches the rule once.
 *
 * `currency_code` **is** accepted, because it is legitimately editable right
 * up until the list holds its first price. Whether this particular list still
 * qualifies is a question about its rows, not about the request, so the
 * refusal lives in the service and is a `409 resource.conflict` carrying
 * `reason: currency_locked` — a state conflict rather than a malformed field.
 *
 * `status` is absent (§4.15): publication and archiving are POST actions.
 */
class UpdatePriceListRequest extends FormRequest
{
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
            'name_en' => ['sometimes', 'string', 'max:255'],
            'name_ar' => ['sometimes', 'nullable', 'string', 'max:255'],
            'currency_code' => ['sometimes', 'string', 'size:3'],
            'customer_scope' => ['sometimes', new Enum(CustomerScope::class)],
            'branch_id' => ['sometimes', 'nullable', 'uuid'],
            'valid_from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'valid_to' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * The validated body **plus** the field the rules refuse to describe, so
     * the service can reject it explicitly.
     *
     * @return array<string, mixed>
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        if ($this->has('code')) {
            $validated['code'] = $this->input('code');
        }

        return $validated;
    }
}
