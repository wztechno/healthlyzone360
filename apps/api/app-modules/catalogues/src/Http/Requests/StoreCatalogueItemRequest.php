<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ProductionMode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for creating a catalogue item.
 *
 * Derived and server-authored values are absent by construction: `status`
 * (always `draft`), `lock_version`, `organisation_id` and the source-provenance
 * fields are not accepted, and neither are variants, ingredients, diet tags or
 * channels — each of those is its own set-replace endpoint, so a create is one
 * decision rather than five smuggled into one body.
 *
 * `name_ar` is `nullable`, and the empty result is meaningful rather than
 * tolerated: it is the "not yet translated" state the publish gate refuses.
 */
class StoreCatalogueItemRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware; a form request
     * that also guessed would give two answers to one question.
     */
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
            'item_type' => ['required', new Enum(CatalogueItemType::class)],
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['nullable', 'string', 'max:255'],
            'slug' => ['nullable', 'string', 'max:130', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/'],
            'description_en' => ['nullable', 'string', 'max:4000'],
            'description_ar' => ['nullable', 'string', 'max:4000'],
            'composition' => ['nullable', 'string', 'max:2000'],
            'kitchen_category' => ['nullable', 'string', 'max:120'],
            'kitchen_subcategory' => ['nullable', 'string', 'max:120'],

            // Existence is checked in the service rather than by an `exists`
            // rule, for the K1.2 reason: the row must be one *this
            // organisation* can use, and a bare rule would happily accept
            // another tenant's identifier.
            'catalogue_id' => ['nullable', 'uuid'],
            'product_category_id' => ['nullable', 'uuid'],
            'production_mode' => ['nullable', new Enum(ProductionMode::class)],
            'recipe_id' => ['nullable', 'uuid'],

            // Not `nullable`: the column is NOT NULL and defaults to one, so an
            // explicit null is a client saying something it cannot mean and is
            // told so. `min` is the column's own three-place precision, so a
            // value that would round to `0.000` is a named 422 here rather than
            // a 500 from the `portion_factor > 0` CHECK.
            'portion_factor' => ['sometimes', 'numeric', 'min:0.001', 'max:999.999'],
            'ingredient_id' => ['nullable', 'uuid'],
            'purchasing_unit_id' => ['nullable', 'uuid'],
            'usage_unit_id' => ['nullable', 'uuid'],
            'is_market_priced' => ['nullable', 'boolean'],
            'is_assorted' => ['nullable', 'boolean'],
            'image_placeholder_id' => ['nullable', 'string', 'max:80'],
        ];
    }
}
