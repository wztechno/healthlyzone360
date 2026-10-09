<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of the windows a zone offers.
 *
 * `present`, not `required`: an empty array is a zone that offers no slot,
 * which a kitchen may want while it decides. Bounded because an unbounded
 * array is a request-size attack; a kitchen has a handful of windows.
 */
class ReplaceDeliveryZoneWindowsRequest extends FormRequest
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
            'delivery_window_ids' => ['present', 'array', 'max:100'],
            'delivery_window_ids.*' => ['required', 'uuid', 'distinct'],
        ];
    }

    /**
     * @return list<string>
     */
    public function windowIds(): array
    {
        /** @var list<string> $ids */
        $ids = $this->validated('delivery_window_ids') ?? [];

        return $ids;
    }
}
