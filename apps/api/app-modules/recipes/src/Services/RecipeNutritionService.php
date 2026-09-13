<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Illuminate\Database\Eloquent\Collection;
use RuntimeException;

/**
 * What a recipe is made of, expressed as nutrition.
 *
 * Every line is weighed in grams, each ingredient's per-100 g facts are scaled
 * by that weight, and the results are summed. Five rules run through all of it,
 * and each exists because the alternative produces a number that reads like an
 * answer and is not one.
 *
 * 1. **Strings and bcmath, never floats.** The same rule the costing layer runs
 *    on (`RecipeCostingService`, master plan v2 §4.4): binary floating point
 *    cannot represent `0.1`, so a float total depends on the order the lines
 *    were summed in, and a label that changes when somebody reorders a
 *    formulation is not a label. Intermediates run at {@see WORKING_SCALE}
 *    twelve places and are rounded **once**, half away from zero, at the scale
 *    the caller asks for.
 * 2. **Per-nutrient completeness.** An ingredient is usable only if it states
 *    *all seven* required nutrients, each exactly once and in its canonical
 *    unit. Null facts, a basis other than `per_100g`, a missing nutrient, a
 *    duplicate id, an unknown id, an energy figure in kJ — every one of them
 *    makes the whole ingredient unusable rather than contributing what it has.
 *    A missing nutrient summed as zero does not read as missing; it reads as
 *    "this recipe contains no sodium", which is a claim nobody made.
 * 3. **Withholding beats a partial total.** One unresolved line withholds all
 *    three figures. The same rule `RecipeRollupPreviewService::estimatedCost()`
 *    applies to money, for the same reason: a total short by exactly the
 *    ingredient nobody could weigh is indistinguishable from a correct one.
 *    {@see RecipeNutritionResult::ingredientIdsFor()} names the lines instead.
 * 4. **`saturated_fat` is all-or-nothing.** It is optional on an ingredient, so
 *    it reaches the envelope only when *every* contributing line carries it.
 *    A partial sum of saturates across some of the lines is worse than silence.
 * 5. **The mass basis is the finished mass.** `total_grams` is the version's
 *    stated yield when that yield is a mass, and Σ input grams otherwise;
 *    `calculation.notes` records which. per-100 g divides by it, and B5's
 *    `serving.grams` is derived from it, which is what keeps the kitchen's
 *    editor and the customer's meal page agreeing on the same dish.
 *
 * The precision contract: twelve places through the arithmetic,
 * {@see SNAPSHOT_SCALE} six on the stored version snapshot,
 * {@see TRANSPORT_SCALE} three on anything crossing the wire.
 */
final class RecipeNutritionService
{
    /**
     * Twelve places through the intermediate steps so a division followed by a
     * multiplication does not lose a place at each hop; six on the version
     * snapshot, which is what the column is for; three on transport, which is
     * one more than any label displays.
     */
    public const int WORKING_SCALE = 12;

    public const int SNAPSHOT_SCALE = 6;

    public const int TRANSPORT_SCALE = 3;

    public const string METHOD_FROM_INGREDIENTS = 'recipe.nutrition.from_ingredients';

    public const string METHOD_PER_SERVING = 'recipe.nutrition.per_serving';

    public const string METHOD_PER_100G = 'recipe.nutrition.per_100g';

    /**
     * A line that could not be weighed in grams: no quantity, no unit, a unit
     * the conversion service refuses, or a non-mass unit on an ingredient whose
     * `grams_per_unit` nobody has filled in.
     */
    public const string REASON_UNCONVERTIBLE_UNIT = 'unconvertible_unit';

    /** An ingredient whose per-100 g facts do not satisfy rule 2 above. */
    public const string REASON_MISSING_NUTRITION = 'missing_nutrition';

    /**
     * The nutrients an ingredient must state, and the unit each must be stated
     * in. The seven the platform library is seeded with, and the same pairing
     * `StoreIngredientRequest::CANONICAL_NUTRIENT_UNITS` enforces on write — the
     * validator is the trust boundary, this is the arithmetic's own check that
     * it was not bypassed by a seeder or a query-builder write.
     *
     * @var array<string, string>
     */
    private const array REQUIRED_NUTRIENTS = [
        'energy' => 'kcal',
        'protein' => 'g',
        'carbohydrate' => 'g',
        'fat' => 'g',
        'fibre' => 'g',
        'sugars' => 'g',
        'sodium' => 'mg',
    ];

    /**
     * Nutrients that may be stated and are not required. Rule 4 decides whether
     * one survives the roll-up.
     *
     * @var array<string, string>
     */
    private const array OPTIONAL_NUTRIENTS = [
        'saturated_fat' => 'g',
    ];

    /**
     * Label order, matching `CORE_NUTRIENT_DEFINITIONS` in
     * `packages/nutrition/src/facts/model.ts` so the server emits amounts in
     * the order the client already renders them.
     *
     * @var list<string>
     */
    private const array NUTRIENT_ORDER = ['energy', 'protein', 'carbohydrate', 'fat', 'fibre', 'sugars', 'saturated_fat', 'sodium'];

    /**
     * Memoised unit rows, keyed by id. One instance answers a whole preview or
     * a whole recompute, and a version with twelve lines in three units should
     * read three rows, not twelve.
     *
     * @var array<string, MeasurementUnit>
     */
    private array $units = [];

    private ?MeasurementUnit $gram = null;

    public function __construct(
        private readonly UnitConversionService $conversion,
    ) {}

    /**
     * Roll a set of prepared lines up into one result.
     *
     * The entry point for the draft path as well as the saved one: the preview
     * builds its lines from a request body that has never been persisted, which
     * is why this takes models rather than ids and never queries for a line.
     *
     * `$yieldQuantity` and `$yieldUnit` state the *finished* mass. A yield
     * stated in a non-mass unit — four pieces, six portions — is not a mass and
     * cannot become one without a density nobody supplied, so it falls back to
     * Σ input grams and says so in `mass_basis: input`. That is deliberately the
     * same refusal {@see UnitConversionService} makes rather than a silent
     * guess at what four pieces weigh.
     *
     * @param  list<array{ingredient: Ingredient, quantity: numeric-string|null, unit: MeasurementUnit|null}>  $lines
     * @param  numeric-string|null  $yieldQuantity
     */
    public function derive(
        array $lines,
        ?string $yieldQuantity = null,
        ?MeasurementUnit $yieldUnit = null,
        ?DateTimeInterface $calculatedAt = null,
    ): RecipeNutritionResult {
        /** @var array<string, array{unit: string, value: numeric-string}> $totals */
        $totals = [];

        /** @var list<array{ingredient_id: string, reason: string}> $unresolved */
        $unresolved = [];

        $inputGrams = '0';
        $everyLineSaturated = true;

        foreach ($lines as $line) {
            $ingredient = $line['ingredient'];
            $ingredientId = (string) $ingredient->getKey();

            if ($line['quantity'] === null || $line['unit'] === null) {
                $unresolved[] = ['ingredient_id' => $ingredientId, 'reason' => self::REASON_UNCONVERTIBLE_UNIT];

                continue;
            }

            $grams = $this->gramsOf($ingredient, $line['quantity'], $line['unit']);

            if ($grams === null) {
                $unresolved[] = ['ingredient_id' => $ingredientId, 'reason' => self::REASON_UNCONVERTIBLE_UNIT];

                continue;
            }

            $amounts = $this->usableAmounts($ingredient);

            if ($amounts === null) {
                $unresolved[] = ['ingredient_id' => $ingredientId, 'reason' => self::REASON_MISSING_NUTRITION];

                continue;
            }

            // The line's contributions are computed into a map of their own and
            // merged only once the whole line is known good. Every refusal above
            // returns before this point, so today the temp map changes nothing;
            // it exists so that a refusal added *below* it cannot leave half a
            // line's worth of nutrients in the totals.
            $factor = bcdiv($grams, '100', self::WORKING_SCALE);
            $contribution = [];

            foreach ($amounts as $nutrientId => $amount) {
                $contribution[$nutrientId] = [
                    'unit' => $amount['unit'],
                    'value' => bcmul($amount['value'], $factor, self::WORKING_SCALE),
                ];
            }

            foreach ($contribution as $nutrientId => $amount) {
                $totals[$nutrientId] = [
                    'unit' => $amount['unit'],
                    'value' => bcadd($totals[$nutrientId]['value'] ?? '0', $amount['value'], self::WORKING_SCALE),
                ];
            }

            $everyLineSaturated = $everyLineSaturated && isset($amounts['saturated_fat']);
            $inputGrams = bcadd($inputGrams, $grams, self::WORKING_SCALE);
        }

        // Rule 4. Dropped rather than never accumulated, because "every line
        // carried it" is only knowable once the last line has been read.
        if (! $everyLineSaturated) {
            unset($totals['saturated_fat']);
        }

        $yieldGrams = $yieldQuantity !== null && $yieldUnit !== null && $yieldUnit->dimension === 'mass'
            ? $this->conversion->convert($this->numeric($yieldQuantity), $yieldUnit, $this->gramUnit())
            : null;

        return new RecipeNutritionResult(
            service: $this,
            totals: $totals,
            totalGrams: $yieldGrams ?? $inputGrams,
            massBasis: $yieldGrams === null ? 'input' : 'yield',
            unresolved: $unresolved,
            calculatedAt: CarbonImmutable::instance($calculatedAt ?? now()),
        );
    }

    /**
     * Roll a saved version up from its own lines.
     *
     * Two queries whatever the line count: the distinct ingredients with their
     * default units, and the distinct measurement units the lines and the yield
     * name between them. A per-line lookup here would be an N+1 on the publish
     * path, which runs inside a transaction.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines  pre-loaded lines, to save the publish path a second query
     */
    public function forVersion(RecipeVersion $version, Collection $lines): RecipeNutritionResult
    {
        $ingredientIds = [];
        $unitIds = [];

        foreach ($lines as $line) {
            $ingredientIds[(string) $line->ingredient_id] = true;

            if ($line->unit_id !== null) {
                $unitIds[(string) $line->unit_id] = true;
            }
        }

        if ($version->yield_unit_id !== null) {
            $unitIds[(string) $version->yield_unit_id] = true;
        }

        $this->loadUnits(array_keys($unitIds));

        // `withoutTenancy()`: a kitchen's recipe may cite a platform ingredient,
        // whose row carries no organisation and would be invisible to the
        // tenant-scoped builder.
        $ingredients = Ingredient::withoutTenancy()
            ->whereIn('id', array_keys($ingredientIds))
            ->with('defaultUnit')
            ->get()
            ->keyBy(static fn (Ingredient $ingredient): string => (string) $ingredient->getKey());

        $prepared = [];

        foreach ($lines as $line) {
            $ingredient = $ingredients->get((string) $line->ingredient_id);

            if (! $ingredient instanceof Ingredient) {
                // `recipe_version_lines.ingredient_id` is `restrictOnDelete`, so
                // this is unreachable while the foreign key stands. Not an
                // ApiException: reaching here is a schema failure, and returning
                // a nutrition label computed from the lines that *did* resolve
                // would be exactly the silent understatement rule 3 forbids.
                throw new RuntimeException("Recipe version line cites ingredient [{$line->ingredient_id}], which does not exist.");
            }

            $prepared[] = [
                'ingredient' => $ingredient,
                'quantity' => $line->quantity === null ? null : $this->numeric($line->quantity),
                'unit' => $line->unit_id === null ? null : ($this->units[(string) $line->unit_id] ?? null),
            ];
        }

        return $this->derive(
            $prepared,
            $version->yield_quantity,
            $version->yield_unit_id === null ? null : ($this->units[(string) $version->yield_unit_id] ?? null),
        );
    }

    /**
     * Restate an existing envelope at a different basis — the one scaler.
     *
     * B5 divides a stored per-recipe snapshot by its piece count to reach a
     * per-sold-unit figure, and does it through here rather than through its own
     * arithmetic: two implementations of one multiplication is two answers, and
     * the one a customer sees would depend on which path last touched the row.
     *
     * `source` is carried through untouched — scaling a figure does not change
     * where it came from — and so is `calculation.notes`, which still records
     * the mass basis the snapshot was computed on. `rounding` *is* rewritten,
     * because the values really were rounded again at `$scale` and a label
     * saying otherwise would be a lie about this very payload.
     *
     * @param  array<string, mixed>  $facts  a previously built envelope, typically decoded from `recipe_versions.nutrition_facts`
     * @param  numeric-string  $factor
     * @param  array<string, mixed>|null  $serving
     * @return array<string, mixed>
     */
    public function scale(array $facts, string $factor, string $basis, string $method, ?array $serving, int $scale): array
    {
        $rawAmounts = $facts['amounts'] ?? [];
        $amounts = [];

        foreach (is_array($rawAmounts) ? $rawAmounts : [] as $amount) {
            if (! is_array($amount)) {
                throw new RuntimeException('Nutrition scaling received an amount that is not an object.');
            }

            $nutrientId = $amount['nutrient_id'] ?? null;
            $unit = $amount['unit'] ?? null;

            if (! is_string($nutrientId) || ! is_string($unit)) {
                throw new RuntimeException('Nutrition scaling received an amount with no nutrient id or unit.');
            }

            $value = $this->decimalString($amount['value'] ?? null)
                ?? throw new RuntimeException("Nutrition scaling received a non-numeric value for [{$nutrientId}].");

            $amounts[] = [
                'nutrient_id' => $nutrientId,
                'unit' => $unit,
                'value' => (float) $this->round(bcmul($value, $factor, self::WORKING_SCALE), $scale),
                'kind' => 'planned',
                'tolerance' => null,
            ];
        }

        $totalGrams = $this->decimalString($facts['total_grams'] ?? null);
        $calculation = is_array($facts['calculation'] ?? null) ? $facts['calculation'] : [];

        return [
            'basis' => $basis,
            'kind' => 'planned',
            'serving' => $serving,
            'total_grams' => $totalGrams === null ? null : (float) $this->round(bcmul($totalGrams, $factor, self::WORKING_SCALE), $scale),
            'amounts' => $amounts,
            'source' => $facts['source'] ?? null,
            'calculation' => [
                'method' => $method,
                'basis' => $basis,
                'calculated_at' => $calculation['calculated_at'] ?? null,
                'prototype' => false,
                'rounding' => 'half_away_from_zero_'.$scale.'dp',
                'notes' => $calculation['notes'] ?? [],
            ],
        ];
    }

    /**
     * Build the `MarketplaceNutritionFacts` envelope from totals that have
     * already been scaled to the basis they describe.
     *
     * Public only because {@see RecipeNutritionResult} calls it: the result
     * holds the unrounded twelve-place totals and this holds the shape, the
     * nutrient order and the one rounding rule, and splitting the shape across
     * both classes is how two payloads end up disagreeing about a key name.
     *
     * @param  array<string, array{unit: string, value: numeric-string}>  $totals
     * @param  numeric-string|null  $totalGrams
     * @return array<string, mixed>
     */
    public function envelope(
        array $totals,
        ?string $totalGrams,
        string $basis,
        string $method,
        string $massBasis,
        CarbonImmutable $calculatedAt,
        int $scale,
    ): array {
        $at = $calculatedAt->toIso8601String();
        $amounts = [];

        foreach (self::NUTRIENT_ORDER as $nutrientId) {
            $amount = $totals[$nutrientId] ?? null;

            if ($amount === null) {
                continue;
            }

            $amounts[] = [
                'nutrient_id' => $nutrientId,
                'unit' => $amount['unit'],
                // JSON numbers, cast from the rounded decimal string. The cast
                // is the last step on purpose: a float that entered the sum
                // would have made the sum order-dependent.
                'value' => (float) $this->round($amount['value'], $scale),
                'kind' => 'planned',
                'tolerance' => null,
            ];
        }

        return [
            'basis' => $basis,
            'kind' => 'planned',
            'serving' => null,
            'total_grams' => $totalGrams === null ? null : (float) $this->round($totalGrams, $scale),
            'amounts' => $amounts,
            'source' => [
                'kind' => 'ingredient_derived',
                'label' => 'Derived from ingredient reference facts',
                'version' => '1',
                'calculated_at' => $at,
            ],
            'calculation' => [
                'method' => $method,
                'basis' => $basis,
                'calculated_at' => $at,
                'prototype' => false,
                'rounding' => 'half_away_from_zero_'.$scale.'dp',
                'notes' => ['mass_basis: '.$massBasis],
            ],
        ];
    }

    /**
     * Round half away from zero to `$scale` places.
     *
     * Copied deliberately from {@see RecipeCostingService::round()}: bcmath
     * truncates, which would bias every figure downwards by up to a unit in the
     * last place and make a total disagree with the sum a human adds up by
     * hand. Adding half a unit in the last place before truncating is the
     * standard correction, and it is done exactly once per figure.
     *
     * The scale is a parameter here, where the costing service has a constant,
     * because one set of totals is rounded to six places for the version
     * snapshot and to three for every payload that crosses the wire.
     *
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function round(string $value, int $scale): string
    {
        // `±5 ÷ 10^(scale+1)` — half a unit in the last place, carrying the
        // value's own sign so the correction pushes away from zero. The costing
        // service writes the same number as `'0.'.str_repeat('0', SCALE).'5'`,
        // which it can because its scale is a constant; a scale that arrives at
        // runtime makes that a concatenation nothing can prove is a number, and
        // bcmath handed a non-number rounds by zero rather than complaining.
        $half = bcdiv(
            str_starts_with($value, '-') ? '-5' : '5',
            bcpow('10', (string) ($scale + 1)),
            $scale + 1,
        );

        return bcadd($value, $half, $scale);
    }

    /**
     * What one line weighs, in grams, or null when nothing can weigh it.
     *
     * A mass unit converts outright. Anything else — a volume, a count, a
     * package — needs the ingredient's own `grams_per_unit`, which is the mass
     * of *one default unit*: convert the line into that default unit first, then
     * multiply. A litre of tahini and a litre of vinegar weigh different
     * amounts, which is exactly why the factor lives on the ingredient and why
     * {@see UnitConversionService} refuses to invent one.
     *
     * @param  numeric-string  $quantity
     * @return numeric-string|null
     */
    private function gramsOf(Ingredient $ingredient, string $quantity, MeasurementUnit $unit): ?string
    {
        try {
            if ($unit->dimension === 'mass') {
                return $this->conversion->convert($this->numeric($quantity), $unit, $this->gramUnit());
            }

            $defaultUnit = $ingredient->defaultUnit;

            if ($ingredient->grams_per_unit === null || $defaultUnit === null) {
                return null;
            }

            return bcmul(
                $this->conversion->convert($this->numeric($quantity), $unit, $defaultUnit),
                $this->numeric($ingredient->grams_per_unit),
                self::WORKING_SCALE,
            );
        } catch (UnitConversionUnsupported) {
            // The line names two units with no ratio between them — a volume
            // against a count, or a pair inside a dimension this system has
            // deliberately not given factors. Unresolved, never guessed.
            return null;
        }
    }

    /**
     * An ingredient's per-100 g facts, keyed by nutrient, or null when the set
     * cannot be used at all.
     *
     * Rule 2 in one method. Every refusal returns null for the *whole*
     * ingredient rather than dropping one amount, because a set missing sodium
     * and a set stating zero sodium are different claims and only one of them
     * was made.
     *
     * @return array<string, array{unit: string, value: numeric-string}>|null
     */
    private function usableAmounts(Ingredient $ingredient): ?array
    {
        $facts = $ingredient->nutrition_per_100g;

        if ($facts === null || ($facts['basis'] ?? null) !== 'per_100g' || ! is_array($facts['amounts'] ?? null)) {
            return null;
        }

        $found = [];

        foreach ($facts['amounts'] as $amount) {
            if (! is_array($amount)) {
                return null;
            }

            $nutrientId = $amount['nutrient_id'] ?? null;

            if (! is_string($nutrientId)) {
                return null;
            }

            $canonical = self::REQUIRED_NUTRIENTS[$nutrientId] ?? self::OPTIONAL_NUTRIENTS[$nutrientId] ?? null;

            // An unknown nutrient, a nutrient stated twice, or energy in kJ
            // beside seven figures in kcal. Each one says the payload was not
            // written by the validator, and a figure this system cannot place
            // is not a figure it may quietly ignore.
            if ($canonical === null || ($amount['unit'] ?? null) !== $canonical || isset($found[$nutrientId])) {
                return null;
            }

            $value = $this->decimalString($amount['value'] ?? null);

            if ($value === null || bccomp($value, '0', self::WORKING_SCALE) < 0) {
                return null;
            }

            $found[$nutrientId] = ['unit' => $canonical, 'value' => $value];
        }

        foreach (array_keys(self::REQUIRED_NUTRIENTS) as $nutrientId) {
            if (! isset($found[$nutrientId])) {
                return null;
            }
        }

        return $found;
    }

    /**
     * The gram row, read once per instance. Every line's mass lands in grams,
     * so a version with twenty lines would otherwise read it twenty times.
     */
    private function gramUnit(): MeasurementUnit
    {
        return $this->gram ??= MeasurementUnit::query()->where('code', 'g')->sole();
    }

    /**
     * @param  list<string>  $ids
     */
    private function loadUnits(array $ids): void
    {
        $missing = array_values(array_diff($ids, array_keys($this->units)));

        if ($missing === []) {
            return;
        }

        foreach (MeasurementUnit::query()->whereIn('id', $missing)->get() as $unit) {
            $this->units[(string) $unit->getKey()] = $unit;
        }
    }

    /**
     * A bcmath-safe decimal string for a number that arrived as JSON.
     *
     * Null rather than an exception, because the two callers disagree about
     * what a malformed number means: an ingredient's stored facts are operator
     * data, and an unusable set is a *result* (`missing_nutrition`), while a
     * snapshot being rescaled is this system's own output and a bad number in
     * one is a bug. Each applies its own policy to the null.
     *
     * Floats are rendered rather than cast: `(string) 1.0E-7` is `1.0E-7`, and
     * bcmath reads that as zero — the silent-zero failure mode this whole class
     * exists to avoid.
     *
     * @return numeric-string|null
     */
    private function decimalString(mixed $value): ?string
    {
        if (is_int($value)) {
            return (string) $value;
        }

        if (is_float($value)) {
            return sprintf('%.'.self::WORKING_SCALE.'F', $value);
        }

        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        if (! is_numeric($trimmed)) {
            return null;
        }

        return str_contains(mb_strtolower($trimmed), 'e')
            ? sprintf('%.'.self::WORKING_SCALE.'F', (float) $trimmed)
            : $trimmed;
    }

    /**
     * Narrow a stored decimal to the numeric string bcmath requires.
     *
     * The columns are decimals and Eloquent casts them to strings, so in
     * practice every value reaching here is numeric. "In practice" is not a
     * type, and the failure mode is the reason this is a real check rather than
     * a cast: bcmath handed a non-numeric string yields **zero**, not an error,
     * so a malformed quantity would not blow up — it would quietly weigh an
     * ingredient at nothing and understate the whole label.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Nutrition arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
