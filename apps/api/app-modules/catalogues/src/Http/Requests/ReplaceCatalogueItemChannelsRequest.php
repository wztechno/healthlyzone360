<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a full replacement of an item's channel availability.
 *
 * `channels` is `present`, not `required`: an empty array withdraws the item
 * from every channel, which is a decision a kitchen makes and not a field it
 * forgot.
 *
 * Dates are dates, not timestamps: a kitchen decides "from Monday", not "from
 * 00:00:00+04 on Monday", and storing a precision nobody supplied only invites
 * a timezone bug at the boundary.
 */
class ReplaceCatalogueItemChannelsRequest extends FormRequest
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
            'channels' => ['present', 'array', 'max:50'],
            'channels.*.sales_channel_id' => ['required', 'uuid'],
            'channels.*.catalogue_item_variant_id' => ['nullable', 'uuid'],
            'channels.*.is_available' => ['nullable', 'boolean'],
            'channels.*.available_from' => ['nullable', 'date_format:Y-m-d'],
            'channels.*.available_to' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * @return list<array{sales_channel_id: string, catalogue_item_variant_id?: string|null, is_available?: bool|null, available_from?: string|null, available_to?: string|null}>
     */
    public function assignments(): array
    {
        /** @var list<array{sales_channel_id: string, catalogue_item_variant_id?: string|null, is_available?: bool|null, available_from?: string|null, available_to?: string|null}> $channels */
        $channels = $this->validated('channels') ?? [];

        return $channels;
    }
}
