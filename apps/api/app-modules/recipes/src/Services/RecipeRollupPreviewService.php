<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Presenters\TechnicalSheetPresenter;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/**
 * Computes allergen, cost and nutrition figures for an unsaved recipe draft.
 *
 * Nothing here writes. The roll-up answers what a formulation would declare
 * if it were saved and published today, so a line editor can show figures on
 * every keystroke without persisting half-finished work.
 *
 * ## The nutrition figures are withheld rather than approximated
 *
 * `per_recipe`, `per_serving` and `per_100g` come from
 * {@see RecipeNutritionService}, which weighs every line in grams and scales
 * each ingredient's per-100 g facts by that weight. Any line it cannot finish —
 * an ingredient that is not in the library, one whose reference facts are
 * missing or malformed, one measured in a unit nothing can turn into a mass —
 * withholds **all three** figures and names the ingredient in `warnings`.
 *
 * That is the rule {@see estimatedCost()} already applies to money, for the
 * identical reason: a total short by exactly the ingredient nobody could weigh
 * is indistinguishable, on screen, from a correct one. A named gap is something
 * a kitchen can fix this afternoon; a quietly understated label is something
 * they find out about from a customer.
 *
 * `per_serving` has a second way of being null that is not a failure at all: a
 * draft that has not said how many servings it makes. Nothing here invents a
 * count — see {@see PreviewRecipeRollupRequest}.
 */
final class RecipeRollupPreviewService
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    public function __construct(
        private readonly AllergenRollupService $rollup,
        private readonly RecipeVersionReadiness $readiness,
        private readonly RecipeCostingService $costing,
        private readonly DraftCostService $draftCost,
        private readonly RecipeNutritionService $nutrition,
        private readonly TechnicalSheetPresenter $sheet,
        private readonly TenantContext $context,
    ) {}

    /**
     * @param  array{
     *     recipe_id: string|null,
     *     servings: float|string|null,
     *     waste_percent: float|string|null,
     *     lines: list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null}>,
     *     yield_quantity?: string|null,
     *     yield_unit_id?: string|null,
     *     yield_piece_count?: int|null,
     *     packaging_waste_percent?: string|null,
     *     packaging?: list<array{ingredient_id: string, basis: string, quantity?: float|string|null}>
     * }  $draft
     * @return array{
     *     per_recipe: array<string, mixed>|null,
     *     per_serving: array<string, mixed>|null,
     *     per_100g: array<string, mixed>|null,
     *     allergen_sources: list<array{allergen_code: string, containment: string, ingredient_ids: list<string>}>,
     *     estimated_cost: array{amount: string, currency: string}|null,
     *     computed_cost: array<string, mixed>|null,
     *     warnings: list<array{code: string, message: string, ingredient_ids?: list<string>}>
     * }
     */
    public function preview(array $draft, bool $includeCost): array
    {
        $warnings = [];
        $usableIngredientIds = [];

        /** @var list<array{ingredient: Ingredient, quantity: numeric-string|null, unit: MeasurementUnit|null}> $prepared */
        $prepared = [];

        // An unknown ingredient is a warning rather than a refusal, but it is
        // still a line whose contribution nobody knows — so it withholds the
        // nutrition figures exactly as an unweighable one does. Tracked here
        // because the line never reaches `$prepared` to say so for itself.
        $hasUnknownLine = false;

        foreach ($draft['lines'] as $index => $line) {
            $ingredientId = (string) $line['ingredient_id'];

            try {
                $ingredient = $this->usableIngredient($ingredientId, "lines.{$index}.ingredient_id");
            } catch (ApiException) {
                $warnings[] = [
                    'code' => 'rollup.unknown_ingredient',
                    'message' => 'This line points at an ingredient that is not in the library.',
                    'ingredient_ids' => [$ingredientId],
                ];

                $hasUnknownLine = true;

                continue;
            }

            $unit = isset($line['unit_id']) && trim($line['unit_id']) !== ''
                ? $this->resolveUnit(trim($line['unit_id']), "lines.{$index}.unit_id")
                : null;

            // Validated `numeric` already, and still re-checked after the cast:
            // bcmath handed a non-number returns zero instead of complaining,
            // so a slip here would weigh the line at nothing rather than fail.
            $quantity = isset($line['quantity']) ? (string) $line['quantity'] : null;

            $prepared[] = [
                'ingredient' => $ingredient,
                'quantity' => $quantity !== null && is_numeric($quantity) ? $quantity : null,
                'unit' => $unit,
            ];

            $unitCost = $line['unit_cost_amount'] ?? null;
            $currency = isset($line['cost_currency_code']) ? mb_strtoupper(trim((string) $line['cost_currency_code'])) : null;

            if ($unitCost !== null && $currency === null) {
                throw $this->invalid("lines.{$index}.cost_currency_code", 'A cost must say which currency it is in.');
            }

            if ($unitCost === null && $currency !== null) {
                throw $this->invalid("lines.{$index}.unit_cost_amount", 'A currency without an amount is not a cost.');
            }

            $usableIngredientIds[] = $ingredientId;
        }

        $orderedIngredientIds = $usableIngredientIds;
        $organisationId = $this->context->organisationId();

        $effective = $this->rollup->effectiveFor(array_values(array_unique($orderedIngredientIds)), $organisationId);
        $undetermined = $this->readiness->undeterminedIngredientIds($orderedIngredientIds, $effective);

        if ($undetermined !== []) {
            $warnings[] = [
                'code' => 'rollup.missing_facts',
                'message' => 'Some ingredients carry no allergen assessment yet.',
                'ingredient_ids' => $undetermined,
            ];
        }

        $yieldQuantity = $draft['yield_quantity'] ?? null;

        $nutrition = $this->nutrition->derive(
            $prepared,
            $yieldQuantity !== null && is_numeric($yieldQuantity) ? $yieldQuantity : null,
            isset($draft['yield_unit_id'])
                ? $this->resolveUnit($draft['yield_unit_id'], 'yield_unit_id')
                : null,
        );

        foreach ([
            RecipeNutritionService::REASON_MISSING_NUTRITION => 'Some ingredients carry no usable reference nutrition, so the figures are withheld.',
            RecipeNutritionService::REASON_UNCONVERTIBLE_UNIT => 'Some lines cannot be weighed in grams, so the figures are withheld.',
        ] as $reason => $message) {
            $ingredientIds = $nutrition->ingredientIdsFor($reason);

            if ($ingredientIds === []) {
                continue;
            }

            $warnings[] = [
                'code' => 'rollup.'.$reason,
                'message' => $message,
                'ingredient_ids' => $ingredientIds,
            ];
        }

        $servings = isset($draft['servings']) ? (string) $draft['servings'] : null;
        $servings = $servings !== null && is_numeric($servings) ? $servings : null;

        return [
            'per_recipe' => $hasUnknownLine ? null : $nutrition->perRecipe(),
            'per_serving' => $hasUnknownLine ? null : $nutrition->perServing($servings),
            'per_100g' => $hasUnknownLine ? null : $nutrition->per100g(),
            'allergen_sources' => $this->allergenSources($orderedIngredientIds, $effective),
            'estimated_cost' => $includeCost ? $this->estimatedCost($draft['lines'], $draft['waste_percent'], $warnings) : null,
            'computed_cost' => $includeCost ? $this->computedCost($draft) : null,
            'warnings' => $warnings,
        ];
    }

    /**
     * The source workbook's whole cost block over the draft — production over
     * the yield, packaging over the same yield, and the two added.
     *
     * The technical sheet's `computed` block for a version that does not exist
     * yet, presented through {@see TechnicalSheetPresenter::computed()} so the
     * two are the same shape as well as the same arithmetic. A recipe editor
     * can therefore render one panel from either source and a person filling in
     * the create form sees the figures they will see after saving.
     *
     * `null` when the draft states no yield, which is every existing caller:
     * the older roll-up carries a summed line total in `estimated_cost` and
     * nothing else, and it stays exactly as it was.
     *
     * @param  array{lines: list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null}>, waste_percent: float|string|null, yield_quantity?: string|null, yield_unit_id?: string|null, yield_piece_count?: int|null, packaging_waste_percent?: string|null, packaging?: list<array{ingredient_id: string, basis: string, quantity?: float|string|null}>}  $draft
     * @return array<string, mixed>|null
     */
    private function computedCost(array $draft): ?array
    {
        $costed = $this->draftCost->cost(
            $draft['lines'],
            $draft['packaging'] ?? [],
            $draft['yield_quantity'] ?? null,
            $draft['yield_unit_id'] ?? null,
            $draft['yield_piece_count'] ?? null,
            $draft['waste_percent'] === null ? null : (string) $draft['waste_percent'],
            $draft['packaging_waste_percent'] ?? null,
        );

        if ($costed === null) {
            return null;
        }

        return $this->sheet->computed($costed['production'], $costed['packaging'], $costed['total']);
    }

    /**
     * @param  list<string>  $orderedIngredientIds
     * @param  array<string, array<string, array{containment: AllergenContainment, market_scopes: list<string>}>>  $effective
     * @return list<array{allergen_code: string, containment: string, ingredient_ids: list<string>}>
     */
    private function allergenSources(array $orderedIngredientIds, array $effective): array
    {
        /** @var array<string, array{allergen_code: string, containment: string, ingredient_ids: list<string>}> $grouped */
        $grouped = [];

        foreach ($orderedIngredientIds as $ingredientId) {
            foreach ($effective[$ingredientId] ?? [] as $code => $mapping) {
                $key = $code.'|'.$mapping['containment']->value;

                if (! isset($grouped[$key])) {
                    $grouped[$key] = [
                        'allergen_code' => $code,
                        'containment' => $mapping['containment']->value,
                        'ingredient_ids' => [],
                    ];
                }

                if (! in_array($ingredientId, $grouped[$key]['ingredient_ids'], true)) {
                    $grouped[$key]['ingredient_ids'][] = $ingredientId;
                }
            }
        }

        ksort($grouped);

        return array_values($grouped);
    }

    /**
     * @param  list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null}>  $lines
     * @param  list<array{code: string, message: string, ingredient_ids?: list<string>}>  $warnings
     * @return array{amount: string, currency: string}|null
     */
    private function estimatedCost(array $lines, mixed $wastePercent, array &$warnings): ?array
    {
        $total = '0';
        $currencies = [];
        $hasCostedLine = false;
        $hasUncostedLine = false;

        foreach ($lines as $line) {
            $quantity = $line['quantity'] ?? null;
            $unitCost = $line['unit_cost_amount'] ?? null;
            $currency = isset($line['cost_currency_code']) ? mb_strtoupper(trim((string) $line['cost_currency_code'])) : null;

            if (
                $quantity === null || ! is_numeric($quantity)
                || $unitCost === null || ! is_numeric($unitCost)
                || $currency === null
            ) {
                if ($unitCost !== null || $currency !== null) {
                    $hasUncostedLine = true;
                }

                continue;
            }

            $hasCostedLine = true;
            $currencies[$currency] = true;
            $total = bcadd(
                $total,
                $this->costing->lineCost((string) $quantity, (string) $unitCost),
                self::WORKING_SCALE,
            );
        }

        if (! $hasCostedLine) {
            return null;
        }

        $currencyCodes = array_keys($currencies);

        if (count($currencyCodes) > 1) {
            $warnings[] = [
                'code' => 'rollup.mixed_cost_currency',
                'message' => 'The costed lines are not all in one currency, so no total is shown.',
            ];

            return null;
        }

        if ($hasUncostedLine) {
            $warnings[] = [
                'code' => 'rollup.missing_cost',
                'message' => 'At least one line has no recorded cost, so no total is shown.',
            ];

            return null;
        }

        $roundedTotal = $this->round($total);
        $waste = $wastePercent === null ? '0' : (string) $wastePercent;
        $factor = bcadd('1', bcdiv($waste, '100', self::WORKING_SCALE), self::WORKING_SCALE);

        return [
            'amount' => $this->round(bcmul($roundedTotal, $factor, self::WORKING_SCALE)),
            'currency' => $currencyCodes[0],
        ];
    }

    /**
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function round(string $value): string
    {
        $half = '0.'.str_repeat('0', self::SCALE).'5';
        $negative = str_starts_with($value, '-');

        return bcadd($value, $negative ? '-'.$half : $half, self::SCALE);
    }

    /**
     * @throws ApiException
     */
    private function usableIngredient(string $id, string $field): Ingredient
    {
        /*
         * Food only.
         *
         * Packaging shares this table — a recipe has to be able to cost the box its meal
         * ships in — but a roll-up line names a raw material. Without the scope a
         * bin liner is a legal answer here, and the roll-up would then be asked to derive
         * nutrition and allergens from it.
         */
        // `defaultUnit` eagerly: a non-mass line is weighed through the
        // ingredient's own `grams_per_unit`, which is a mass *per default unit*
        // and therefore meaningless without the unit beside it.
        $ingredient = Ingredient::query()->excludingPackaging()->with('defaultUnit')->whereKey($id)->first();

        if (! $ingredient instanceof Ingredient) {
            throw $this->invalid($field, 'This ingredient does not exist, or is not one you can use.');
        }

        if ($ingredient->status === IngredientStatus::Archived) {
            throw $this->invalid($field, 'This ingredient is archived and cannot be added to a recipe.');
        }

        // Inactive is the operator's "do not use this" switch: the row stays
        // visible (greyed) in the kitchen tables, but nothing new may be
        // built on it until somebody flips it back.
        if ($ingredient->status === IngredientStatus::Inactive) {
            throw $this->invalid($field, 'This ingredient is inactive and cannot be added to a recipe until it is reactivated.');
        }

        return $ingredient;
    }

    /**
     * The unit row behind an id, or `422`.
     *
     * It used to be an existence check, and the 422 is unchanged. The row
     * itself is now needed rather than just its presence: nutrition weighs
     * every line in grams, which takes the unit's dimension and its conversion
     * factor, and a second read per line to fetch what this call already had in
     * hand would be an N+1 on a request the editor makes on every edit.
     *
     * @throws ApiException
     */
    private function resolveUnit(string $id, string $field): MeasurementUnit
    {
        $unit = MeasurementUnit::query()->whereKey($id)->first();

        if (! $unit instanceof MeasurementUnit) {
            throw $this->invalid($field, 'This measurement unit does not exist.');
        }

        return $unit;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
