<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for editing a delivery zone header.
 *
 * `code` and `status` are deliberately **not** in these rules and are refused
 * by the service rather than stripped here. Silently dropping a field a client
 * believed it was writing is how a caller learns nothing; a 422 naming the
 * rule teaches it once.
 *
 * `is_active` is the reversible half of the lifecycle and is accepted:
 * suspending a zone for the winter is an edit, while archiving it is a
 * decision with its own action, its own audit event and a side effect —
 * releasing the area claims.
 *
 * `branch_id` is accepted and re-scoping carries the area claims with it. The
 * service performs that inside one transaction and refuses the move with a
 * `409` when the destination scope is already served, which is a state
 * conflict rather than a malformed field.
 */
class UpdateDeliveryZoneRequest extends FormRequest
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
            'branch_id' => ['sometimes', 'nullable', 'uuid'],
            'delivery_fee_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'minimum_order_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'estimated_minutes' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * The validated body **plus** the fields the rules refuse to describe, so
     * the service can reject them explicitly.
     *
     * @return array<string, mixed>
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        foreach (['code', 'status'] as $refused) {
            if ($this->has($refused)) {
                $validated[$refused] = $this->input($refused);
            }
        }

        return $validated;
    }
}
