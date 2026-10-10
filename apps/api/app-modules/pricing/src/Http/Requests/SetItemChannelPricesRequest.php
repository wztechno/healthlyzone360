<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * An article's B2B and/or B2C offer: the pack weight and the price it sells at.
 *
 * Each channel key is optional, and absent is not null: a channel left out is
 * untouched, a channel sent as `null` stops being sold there. Inside one, the
 * weight is required and the price is not — a pack can be sized before anybody
 * has priced it.
 */
class SetItemChannelPricesRequest extends FormRequest
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
        $rules = [];

        foreach (['b2b', 'b2c'] as $code) {
            $rules[$code] = ['sometimes', 'nullable', 'array'];
            $rules["{$code}.quantity"] = ["required_with:{$code}", 'numeric', 'gt:0', 'max:99999999'];
            $rules["{$code}.unit"] = ["required_with:{$code}", 'string', 'max:20'];
            $rules["{$code}.amount_minor"] = ['nullable', 'integer', 'min:1', 'max:2147483647'];
        }

        return $rules;
    }

    /**
     * Only the channels the body names, keyed by code.
     *
     * @return array<string, array{quantity: string, unit: string, amount_minor: int|null}|null>
     */
    public function channels(): array
    {
        $out = [];

        foreach (['b2b', 'b2c'] as $code) {
            if (! array_key_exists($code, $this->all())) {
                continue;
            }

            /** @var array{quantity: int|float|string, unit: string, amount_minor?: int|string|null}|null $offer */
            $offer = $this->input($code);

            $out[$code] = $offer === null ? null : [
                // The column's scale, so 0.3 and "0.30" are one weight.
                'quantity' => number_format((float) $offer['quantity'], 4, '.', ''),
                'unit' => trim((string) $offer['unit']),
                'amount_minor' => isset($offer['amount_minor']) ? (int) $offer['amount_minor'] : null,
            ];
        }

        return $out;
    }
}
