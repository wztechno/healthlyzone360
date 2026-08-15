<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Requests;

use Healthy360\Ingredients\Enums\AvailabilityTier;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Validation for creating a tenant ingredient.
 *
 * Derived values are never client-supplied: `status`, `verification_status`,
 * `lock_version`, `organisation_id`, `source_system`/`source_ref` and
 * `seeded_at` are all absent from these rules on purpose. A client that could
 * post `verification_status: verified` could mark its own data reviewed.
 */
class StoreIngredientRequest extends FormRequest
{
    /**
     * Authorisation is the route's `permission` middleware and the service's
     * platform-row rule; a form request that also guessed would give two
     * answers to one question.
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
            'name_en' => ['required', 'string', 'max:255'],
            'name_ar' => ['nullable', 'string', 'max:255'],
            'slug' => ['nullable', 'string', 'max:110', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/'],
            'ingredient_category_id' => ['nullable', 'uuid', Rule::exists('ingredient_categories', 'id')],
            'ingredient_subcategory_id' => ['nullable', 'uuid', Rule::exists('ingredient_categories', 'id')],
            'default_unit_id' => ['required', 'uuid', Rule::exists('measurement_units', 'id')],
            'yield_factor' => ['nullable', 'numeric', 'gt:0', 'max:99.9999'],
            'availability_tier' => ['nullable', new Enum(AvailabilityTier::class)],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
