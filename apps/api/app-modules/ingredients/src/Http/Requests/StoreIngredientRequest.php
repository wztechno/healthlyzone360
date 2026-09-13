<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Requests;

use Closure;
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
     * The one unit each nutrient is stored in.
     *
     * The roll-up sums per-100 g amounts across the ingredients of a recipe, and
     * a sum is only a sum when every term is denominated the same way. Rather
     * than convert on read — which means every reader carrying a kJ→kcal factor
     * and one of them eventually not — the write refuses anything but the
     * canonical unit, so the column holds one denomination per nutrient and the
     * question never reaches the reader.
     *
     * `kJ` stays in the schema enum because the envelope shape is shared with
     * `catalogue_items.nutrition_facts`, where a kitchen-recorded label may
     * legitimately quote it. Nothing on an *ingredient* does.
     */
    private const CANONICAL_NUTRIENT_UNITS = [
        'energy' => 'kcal',
        'protein' => 'g',
        'carbohydrate' => 'g',
        'fat' => 'g',
        'fibre' => 'g',
        'sugars' => 'g',
        'saturated_fat' => 'g',
        'sodium' => 'mg',
    ];

    /**
     * The per-100 g nutrition facts payload — the same envelope
     * `catalogue_items.nutrition_facts` uses, restricted to the eight core
     * nutrient ids.
     *
     * Shallow on purpose in one direction and strict in another. A **partial**
     * set stays legal: an ingredient nobody has measured fat on is a real row,
     * and the roll-up — not the validator — is what decides whether a set is
     * complete enough to sum. What is refused is anything that would make two
     * legal-looking rows unsummable: a nutrient stated twice (which term is the
     * total?) and a nutrient stated in a unit no other row uses.
     *
     * @return array<string, mixed>
     */
    public static function nutritionRules(): array
    {
        return [
            'nutrition_per_100g' => ['sometimes', 'nullable', 'array'],
            'nutrition_per_100g.basis' => ['required_with:nutrition_per_100g', 'in:per_100g'],
            'nutrition_per_100g.amounts' => ['required_with:nutrition_per_100g', 'array', 'max:20'],
            // The amount as a whole, because the pairing rule needs both halves:
            // a closure on `*.unit` alone cannot see the `nutrient_id` beside it.
            'nutrition_per_100g.amounts.*' => ['array', self::canonicalUnitRule()],
            'nutrition_per_100g.amounts.*.nutrient_id' => ['required', 'distinct', 'in:energy,protein,carbohydrate,fat,fibre,sugars,saturated_fat,sodium'],
            'nutrition_per_100g.amounts.*.unit' => ['required', 'in:kcal,kJ,g,mg'],
            'nutrition_per_100g.amounts.*.value' => ['required', 'numeric', 'min:0'],
        ];
    }

    /**
     * Asserts one amount states its nutrient in {@see CANONICAL_NUTRIENT_UNITS}.
     *
     * Says nothing about a malformed amount: an unknown id or a missing unit is
     * already the business of the two per-key rules beside it, and a second
     * complaint about the same cell is noise, not information.
     */
    private static function canonicalUnitRule(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            if (! is_array($value)) {
                return;
            }

            $nutrientId = $value['nutrient_id'] ?? null;
            $unit = $value['unit'] ?? null;

            if (! is_string($nutrientId) || ! is_string($unit)) {
                return;
            }

            $canonical = self::CANONICAL_NUTRIENT_UNITS[$nutrientId] ?? null;

            if ($canonical === null || $unit === $canonical) {
                return;
            }

            $fail(sprintf('The %s amount must be stated in %s.', $nutrientId, $canonical));
        };
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
            // `min` at the column's own precision rather than `gt:0`: the column
            // is `decimal(12,4)` under a `> 0` CHECK, so `0.00001` would round
            // to `0.0000` on the way in and trip the constraint as a 500. The
            // smallest value the column can actually hold is the smallest value
            // the validator accepts.
            'grams_per_unit' => ['nullable', 'numeric', 'min:0.0001', 'max:99999999.9999'],
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
