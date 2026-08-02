<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for editing a sales channel.
 *
 * Neither `code` nor `channel_kind` is accepted. The code is what a price
 * list, an availability rule and (from C1) an order's provenance name; the
 * kind decides whether prices behind the channel are contract-private, and
 * flipping a live b2b desk to `b2c_web` would reclassify every one of them in
 * a single write with no record of what had been private. Changing either
 * means creating the new channel and deactivating the old one — which is what
 * actually happened.
 *
 * `status` **is** accepted here rather than being a POST action, and the
 * asymmetry with catalogue-item publication is deliberate: activating a
 * channel is operational configuration, not a decision about what reaches a
 * customer. Nothing a diner sees is a channel.
 */
class UpdateSalesChannelRequest extends FormRequest
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
            'name_ar' => ['sometimes', 'string', 'max:255'],
            'order_source' => ['sometimes', 'nullable', 'string', 'max:30'],
            'status' => ['sometimes', new Enum(SalesChannelStatus::class)],
        ];
    }
}
