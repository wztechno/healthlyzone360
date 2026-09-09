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
     * The per-100 g nutrition facts payload — the same envelope
     * `catalogue_items.nutrition_facts` uses, restricted to the eight core
     * nutrient ids. Validation is deliberately shallow (shape, ids, numbers);
     * the recipe-rollup phase owns anything deeper.
     *
     * @return array<string, mixed>
     */
    public static function nutritionRules(): array
    {
        return [
            'nutrition_per_100g' => ['sometimes', 'nullable', 'array'],
            'nutrition_per_100g.basis' => ['required_with:nutrition_per_100g', 'in:per_100g'],
            'nutrition_per_100g.amounts' => ['required_with:nutrition_per_100g', 'array', 'max:20'],
            'nutrition_per_100g.amounts.*.nutrient_id' => ['required', 'in:energy,protein,carbohydrate,fat,fibre,sugars,saturated_fat,sodium'],
            'nutrition_per_100g.amounts.*.unit' => ['required', 'in:kcal,kJ,g,mg'],
            'nutrition_per_100g.amounts.*.value' => ['required', 'numeric', 'min:0'],
        ];
    }

    /**
     * The three prices and the currency they are quoted in.
     *
     * `price_currency_code` is `required_with` **every** amount rather than
     * merely optional, because the database CHECK refuses an amount with no
     * currency — a caller that omitted it would otherwise learn about the
     * rule as a 500 instead of a 422. The list must name all three: when
     * `unit_price_amount` was added, leaving it off here would have reopened
     * exactly that hole for the new column.
     *
     * One currency covers all three: an article quoted in two currencies is a
     * price list, not a column.
     *
     * @return array<string, mixed>
     */
    public static function priceRules(): array
    {
        return [
            'b2b_price_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:999999999999.999999'],
            'b2c_price_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:999999999999.999999'],
            'unit_price_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:999999999999.999999'],
            'price_currency_code' => ['required_with:b2b_price_amount,b2c_price_amount,unit_price_amount', 'nullable', 'string', 'size:3', Rule::exists('currencies', 'code')],
        ];
    }

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
            'purchase_unit_id' => ['nullable', 'uuid', Rule::exists('measurement_units', 'id')],
            'composition' => ['nullable', 'string', 'max:2000'],
            'items_per_unit' => ['nullable', 'numeric', 'gt:0', 'max:99999999.99'],
            'yield_factor' => ['nullable', 'numeric', 'gt:0', 'max:99.9999'],
            'availability_tier' => ['nullable', new Enum(AvailabilityTier::class)],
            // Not nullable: the column is `default(false)`, so "absent" means
            // false rather than unknown, and an explicit null would be a third
            // state the schema cannot hold.
            'is_sellable' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:2000'],
            ...self::priceRules(),
            ...self::nutritionRules(),
        ];
    }
}
