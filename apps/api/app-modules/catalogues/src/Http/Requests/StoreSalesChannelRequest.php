<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Healthy360\Catalogues\Enums\SalesChannelKind;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for creating a sales channel.
 *
 * `status` is absent: a new channel is always active, and a channel created
 * inactive is a row nobody would notice was there.
 */
class StoreSalesChannelRequest extends FormRequest
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
            'code' => ['required', 'string', 'max:40', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/'],
            'channel_kind' => ['required', new Enum(SalesChannelKind::class)],
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['nullable', 'string', 'max:255'],
            'order_source' => ['nullable', 'string', 'max:30'],
        ];
    }
}
