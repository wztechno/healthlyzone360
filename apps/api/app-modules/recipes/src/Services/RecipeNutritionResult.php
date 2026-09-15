<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Carbon\CarbonImmutable;

/**
 * The result of rolling one recipe's lines up into nutrition — a report first,
 * a payload second.
 *
 * Deliberately the same shape of object as {@see CostComputation}, for the same
 * reason: it is possible, and normal, to hold a result that must never be
 * shown as a total. A formulation whose third line points at an ingredient
 * nobody has weighed still has a partial sum, and that sum is not a nutrition
 * label — it is a label short by exactly one ingredient, which reads
 * identically to a correct one. {@see isComplete()} is the gate and every
 * accessor here consults it.
 *
 * **The totals are unrounded, at twelve places.** They are held that way so a
 * per-serving figure divides the exact sum rather than a figure already rounded
 * for transport: rounding to three places and *then* dividing by four would
 * bake the rounding error into every serving. Each accessor scales the
 * twelve-place totals and rounds once, at the end.
 */
final readonly class RecipeNutritionResult
{
    /**
     * @param  array<string, array{unit: string, value: numeric-string}>  $totals  nutrient id => summed amount, unrounded
     * @param  numeric-string|null  $totalGrams  the finished-mass basis, unrounded
     * @param  string  $massBasis  `yield` when the version stated a mass yield, `input` when the sum of the lines is all there is
     * @param  list<array{ingredient_id: string, reason: string}>  $unresolved  the lines that contributed nothing, in line order
     */
    public function __construct(
        private RecipeNutritionService $service,
        public array $totals,
        public ?string $totalGrams,
        public string $massBasis,
        public array $unresolved,
        public CarbonImmutable $calculatedAt,
    ) {}

    /**
     * Whether these figures may be published as a label: every line resolved,
     * and at least one of them contributed.
     *
     * The second half is not pedantry. A version with no lines at all, or one
     * whose every line was skipped, produces a total of zero for all seven
     * nutrients — a perfectly well-formed envelope claiming the dish is made of
     * nothing.
     */
    public function isComplete(): bool
    {
        return $this->unresolved === [] && $this->totals !== [];
    }

    /**
     * The whole recipe's figures, or null when anything was withheld.
     *
     * @return array<string, mixed>|null
     */
    public function perRecipe(int $scale = RecipeNutritionService::TRANSPORT_SCALE): ?array
    {
        if (! $this->isComplete()) {
            return null;
        }

        return $this->scaled('1', '1', 'per_recipe', RecipeNutritionService::METHOD_FROM_INGREDIENTS, $scale);
    }

    /**
     * One serving's figures, or null.
     *
     * Null when the caller did not say how many servings there are, and that is
     * the whole point: nothing in this system knows how a recipe is portioned
     * unless a human states it, and substituting a default of one would publish
     * a per-serving label for a twelve-portion batch.
     *
     * @param  numeric-string|null  $servings
     * @return array<string, mixed>|null
     */
    public function perServing(?string $servings, int $scale = RecipeNutritionService::TRANSPORT_SCALE): ?array
    {
        if (! $this->isComplete() || $servings === null) {
            return null;
        }

        $divisor = trim($servings);

        if (! is_numeric($divisor) || bccomp($divisor, '0', RecipeNutritionService::WORKING_SCALE) <= 0) {
            return null;
        }

        return $this->scaled('1', $divisor, 'per_serving', RecipeNutritionService::METHOD_PER_SERVING, $scale);
    }

    /**
     * The comparison basis, over the finished mass — the yield when the version
     * stated one as a mass, Σ input grams otherwise.
     *
     * Multiplied by a hundred *before* dividing rather than scaled by a
     * precomputed `100 ÷ mass`: `771 × 100 ÷ 150` is exactly `514`, while
     * `771 × 0.666666666666` is not, and a comparison figure that lands a
     * ten-billionth off a round number for no reason invites somebody to
     * "fix" the arithmetic.
     *
     * @return array<string, mixed>|null
     */
    public function per100g(int $scale = RecipeNutritionService::TRANSPORT_SCALE): ?array
    {
        if (! $this->isComplete() || $this->totalGrams === null || bccomp($this->totalGrams, '0', RecipeNutritionService::WORKING_SCALE) <= 0) {
            return null;
        }

        return $this->scaled('100', $this->totalGrams, 'per_100g', RecipeNutritionService::METHOD_PER_100G, $scale);
    }

    /**
     * The same per-100 g figures in the **slim** shape an ingredient stores —
     * `{basis, amounts[{nutrient_id, unit, value}]}`, the one
     * `StoreIngredientRequest::nutritionRules()` validates — or null.
     *
     * What a version's outputs are given: an intermediate's facts are per 100 g
     * of its *finished* mass, which is exactly the basis {@see per100g()}
     * already divides by, so this is that envelope with the transport
     * decoration dropped rather than a second computation of the same numbers.
     * Null for the same two reasons it is: nothing may be published as a label
     * unless every line resolved, and a mass basis of zero has no per-100 g.
     *
     * @return array{basis: string, amounts: list<array{nutrient_id: string, unit: string, value: float}>}|null
     */
    public function per100gSlim(int $scale = RecipeNutritionService::SNAPSHOT_SCALE): ?array
    {
        $facts = $this->per100g($scale);

        if ($facts === null) {
            return null;
        }

        $amounts = [];

        /** @var array{nutrient_id: string, unit: string, value: float} $amount */
        foreach (is_array($facts['amounts']) ? $facts['amounts'] : [] as $amount) {
            $amounts[] = [
                'nutrient_id' => $amount['nutrient_id'],
                'unit' => $amount['unit'],
                'value' => $amount['value'],
            ];
        }

        return ['basis' => 'per_100g', 'amounts' => $amounts];
    }

    /**
     * The per-recipe envelope at snapshot precision, encoded — what the publish
     * and recompute paths write to `recipe_versions.nutrition_facts`.
     *
     * A JSON **string**, because both writes go through the query builder to get
     * their optimistic-lock compare-and-swap, and the query builder bypasses the
     * model's `array` cast. Handing it an array would store PostgreSQL's idea of
     * a stringified PHP array.
     */
    public function snapshotJson(): ?string
    {
        $facts = $this->perRecipe(RecipeNutritionService::SNAPSHOT_SCALE);

        return $facts === null ? null : (string) json_encode($facts, JSON_THROW_ON_ERROR);
    }

    /**
     * The ingredients behind one kind of refusal, deduplicated and in the order
     * their lines were read — what a warning names so a kitchen can go and fix
     * the right row rather than hunting for the gap.
     *
     * @return list<string>
     */
    public function ingredientIdsFor(string $reason): array
    {
        $ids = [];

        foreach ($this->unresolved as $entry) {
            if ($entry['reason'] === $reason) {
                $ids[$entry['ingredient_id']] = true;
            }
        }

        return array_keys($ids);
    }

    /**
     * `totals × multiplier ÷ divisor`, at twelve places, handed to the envelope
     * builder to be rounded once.
     *
     * `total_grams` takes the same factor as the amounts, which is what makes
     * the three bases coherent: the per-100 g envelope reports a hundred grams,
     * the per-serving one reports what a serving weighs, and B5's
     * `serving.grams` is that same figure scaled again.
     *
     * @param  numeric-string  $multiplier
     * @param  numeric-string  $divisor
     * @return array<string, mixed>
     */
    private function scaled(string $multiplier, string $divisor, string $basis, string $method, int $scale): array
    {
        $scaledTotals = [];

        foreach ($this->totals as $nutrientId => $amount) {
            $scaledTotals[$nutrientId] = [
                'unit' => $amount['unit'],
                'value' => bcdiv(
                    bcmul($amount['value'], $multiplier, RecipeNutritionService::WORKING_SCALE),
                    $divisor,
                    RecipeNutritionService::WORKING_SCALE,
                ),
            ];
        }

        return $this->service->envelope(
            $scaledTotals,
            $this->totalGrams === null ? null : bcdiv(
                bcmul($this->totalGrams, $multiplier, RecipeNutritionService::WORKING_SCALE),
                $divisor,
                RecipeNutritionService::WORKING_SCALE,
            ),
            $basis,
            $method,
            $this->massBasis,
            $this->calculatedAt,
            $scale,
        );
    }
}
