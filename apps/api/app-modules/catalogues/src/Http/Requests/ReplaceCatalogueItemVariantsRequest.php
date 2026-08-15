<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Healthy360\Catalogues\Enums\PackFormat;
use Healthy360\Catalogues\Enums\VariantStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for a full replacement of an item's variants.
 *
 * `variants` is `present`, not `required`: an empty array is the legitimate
 * statement "this item has no variants", and `required` would reject it as if
 * the field had been forgotten.
 *
 * `variant_type` is **not** a field. It is derived from the item's own type —
 * a product has packs, a plan has configurations, a meal has neither — and a
 * derived value a client can supply is a derived value that can disagree with
 * its source (appendix C).
 */
class ReplaceCatalogueItemVariantsRequest extends FormRequest
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
            'variants' => ['present', 'array', 'max:100'],

            // Optional, and checked against this item in the service: a
            // caller that holds one may send it, and one that does not
            // addresses the row by its code.
            'variants.*.id' => ['nullable', 'uuid'],
            'variants.*.code' => ['required', 'string', 'max:60'],
            'variants.*.name_en' => ['nullable', 'string', 'max:255'],
            'variants.*.name_ar' => ['nullable', 'string', 'max:255'],
            'variants.*.is_default' => ['nullable', 'boolean'],
            'variants.*.status' => ['nullable', new Enum(VariantStatus::class)],

            'variants.*.pack' => ['nullable', 'array'],
            'variants.*.pack.pack_quantity' => ['nullable', 'numeric', 'gt:0', 'max:99999999.9999'],
            'variants.*.pack.pack_unit_id' => ['nullable', 'uuid'],
            'variants.*.pack.pack_piece_count' => ['nullable', 'integer', 'gt:0'],
            'variants.*.pack.pack_format' => ['nullable', new Enum(PackFormat::class)],
            'variants.*.pack.net_weight_grams' => ['nullable', 'integer', 'gt:0'],
        ];
    }

    /**
     * @return list<array{code: string, id?: string|null, name_en?: string|null, name_ar?: string|null, is_default?: bool|null, status?: string|null, pack?: array<string, mixed>|null}>
     */
    public function variants(): array
    {
        /** @var list<array{code: string, id?: string|null, name_en?: string|null, name_ar?: string|null, is_default?: bool|null, status?: string|null, pack?: array<string, mixed>|null}> $variants */
        $variants = $this->validated('variants') ?? [];

        return $variants;
    }
}
