<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Requests;

use Healthy360\Catalogues\Enums\ProductionMode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for editing a catalogue item.
 *
 * `slug` and `item_type` are deliberately **not** in these rules and are
 * refused by the service rather than stripped here. Silently dropping a field
 * a client believed it was writing is how a caller learns nothing; a 422 that
 * says "a slug is fixed when the item is created" teaches the rule once.
 *
 * `status` is absent for the §4.15 reason: publication and retirement are POST
 * sub-resource actions with their own permission and their own audit events,
 * never a status field on an update.
 */
class UpdateCatalogueItemRequest extends FormRequest
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
            'description_en' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'description_ar' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'product_category_id' => ['sometimes', 'nullable', 'uuid'],
            'production_mode' => ['sometimes', 'nullable', new Enum(ProductionMode::class)],
            'recipe_id' => ['sometimes', 'nullable', 'uuid'],
            'ingredient_id' => ['sometimes', 'nullable', 'uuid'],
            'purchasing_unit_id' => ['sometimes', 'nullable', 'uuid'],
            'usage_unit_id' => ['sometimes', 'nullable', 'uuid'],
            'is_market_priced' => ['sometimes', 'boolean'],
            'is_assorted' => ['sometimes', 'boolean'],
            'image_placeholder_id' => ['sometimes', 'nullable', 'string', 'max:80'],
        ];
    }

    /**
     * The validated body **plus** the two fields the rules refuse to describe,
     * so the service can reject them explicitly.
     *
     * Named `payload()` rather than overriding `attributes()`: that method
     * already means "human-readable field names for validation messages" on a
     * `FormRequest`, and repurposing it would break every message this class
     * produces.
     *
     * @return array<string, mixed>
     */
    public function payload(): array
    {
        /** @var array<string, mixed> $validated */
        $validated = $this->validated();

        foreach (['slug', 'item_type'] as $forbidden) {
            if ($this->has($forbidden)) {
                $validated[$forbidden] = $this->input($forbidden);
            }
        }

        return $validated;
    }
}
