<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
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
 */
final class RecipeRollupPreviewService
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    public function __construct(
        private readonly AllergenRollupService $rollup,
        private readonly RecipeVersionReadiness $readiness,
        private readonly RecipeCostingService $costing,
        private readonly TenantContext $context,
    ) {}

    /**
     * @param  array{
     *     recipe_id: string|null,
     *     servings: float|string,
     *     waste_percent: float|string|null,
     *     lines: list<array{ingredient_id: string, quantity?: float|string|null, unit_id?: string|null, unit_cost_amount?: float|string|null, cost_currency_code?: string|null}>
     * }  $draft
     * @return array{
     *     per_recipe: null,
     *     per_serving: null,
     *     per_100g: null,
     *     allergen_sources: list<array{allergen_code: string, containment: string, ingredient_ids: list<string>}>,
     *     estimated_cost: array{amount: string, currency: string}|null,
     *     warnings: list<array{code: string, message: string, ingredient_ids?: list<string>}>
     * }
     */
    public function preview(array $draft, bool $includeCost): array
    {
        $warnings = [];
        $usableIngredientIds = [];

        foreach ($draft['lines'] as $index => $line) {
            $ingredientId = (string) $line['ingredient_id'];

            try {
                $this->usableIngredient($ingredientId, "lines.{$index}.ingredient_id");
            } catch (ApiException) {
                $warnings[] = [
                    'code' => 'rollup.unknown_ingredient',
                    'message' => 'This line points at an ingredient that is not in the library.',
                    'ingredient_ids' => [$ingredientId],
                ];

                continue;
            }

            if (isset($line['unit_id']) && trim($line['unit_id']) !== '') {
                $this->assertUnitExists(trim($line['unit_id']), "lines.{$index}.unit_id");
            }

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

        $warnings[] = [
            'code' => 'nutrition_unavailable',
            'message' => 'Nutrition figures are not computed on the server yet.',
        ];

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

        return [
            'per_recipe' => null,
            'per_serving' => null,
            'per_100g' => null,
            'allergen_sources' => $this->allergenSources($orderedIngredientIds, $effective),
            'estimated_cost' => $includeCost ? $this->estimatedCost($draft['lines'], $draft['waste_percent'], $warnings) : null,
            'warnings' => $warnings,
        ];
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
        $ingredient = Ingredient::query()->whereKey($id)->first();

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
     * @throws ApiException
     */
    private function assertUnitExists(string $id, string $field): void
    {
        if (! MeasurementUnit::query()->whereKey($id)->exists()) {
            throw $this->invalid($field, 'This measurement unit does not exist.');
        }
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
