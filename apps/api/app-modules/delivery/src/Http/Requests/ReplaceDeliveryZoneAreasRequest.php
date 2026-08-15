<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of the areas a zone covers.
 *
 * `service_area_ids` is `present`, not `required`: an empty array is a zone
 * that covers nowhere, which is a legitimate intermediate state while a
 * kitchen redraws its map — and the only way to hand an area back so another
 * zone can take it.
 *
 * The bound of 500 is the whole Lebanese gazetteer four times over. It exists
 * because an unbounded array is a request-size attack, not because anybody
 * expects a zone that large.
 */
class ReplaceDeliveryZoneAreasRequest extends FormRequest
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
            'service_area_ids' => ['present', 'array', 'max:500'],
            'service_area_ids.*' => ['required', 'uuid'],
        ];
    }

    /**
     * @return list<string>
     */
    public function areaIds(): array
    {
        /** @var list<string> $ids */
        $ids = $this->validated('service_area_ids') ?? [];

        return $ids;
    }
}
