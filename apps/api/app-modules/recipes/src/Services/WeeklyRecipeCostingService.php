<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Contracts\IngredientWeeklyPriceLookup;
use Healthy360\Ingredients\Contracts\WeeklyIngredientPrice;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Exceptions\MixedCostCurrency;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Illuminate\Database\Eloquent\Collection;

/**
 * What a recipe version costs at the prices the kitchen is **actually paying**
 * (PROD1) — the estimating figure, beside the frozen one the lines carry.
 *
 * ## Nothing here computes a total
 *
 * The arithmetic is {@see RecipeCostingService}'s, unchanged, reached the way
 * {@see DraftCostService} reaches it: this class resolves a unit cost per line,
 * hangs it on an **unsaved** clone of that line, and hands the collection to the
 * costing service. Two implementations of one sum is how a sheet ends up
 * disagreeing with itself, and the source workbook's drift between its own two
 * tables is the evidence for how that ends.
 *
 * So the saved `unit_cost_amount` on the real rows is never touched. A sheet
 * costed in March still says what it said in March; this answers the different
 * question beside it.
 *
 * ## Four sources, tried in this order
 *
 * 1. **The published weekly price.** What was really paid, averaged over the last
 *    completed week. Converted into the line's own unit — a price per unit moves
 *    the *opposite* way to a quantity, and only after `canConvert()` says the
 *    pair is convertible at all.
 * 2. **The recipe that makes it.** A line naming something the kitchen produces
 *    is costed from that recipe's own cost per unit of what it outputs. This is
 *    the rule that stops a dressing's olive oil being counted once inside the
 *    dressing and a second time inside the salad — the same double count
 *    `OrderConsumptionService` avoids at sale time by drawing a sauce off its own
 *    shelf instead of exploding it.
 * 3. **The ingredient's typed purchase price.** Somebody's estimate of what they
 *    expect to pay. Real, weaker, and reported as such so the initial-price-entry
 *    list can name it.
 * 4. **Nothing.** The line stays uncosted and the total is withheld. Never zero:
 *    a free ingredient and an unpriced one must not cost a recipe the same.
 *
 * A purchase beats a derivation deliberately. An item the kitchen both makes and
 * buys (`production_mode = both`, which exists precisely because several articles
 * are produced when volume allows and bought in when it does not) has a real
 * price somebody really paid, and a derived figure would be this system's opinion
 * of what it should have cost instead.
 *
 * ## Which recipe costs a produced component
 *
 * The one that already claims the ingredient's nutrition —
 * `ingredients.nutrition_derived_from_version_id`, written by
 * {@see RecipeOutputNutritionWriter} and exclusive by construction. Following the
 * same claim for cost is what keeps cost and nutrition from naming two different
 * versions of the same component, which is the kind of disagreement nobody finds
 * until the two figures are on one page.
 *
 * A component contributes its **formulation** cost only. Its packaging belongs to
 * it as a thing that is sold, not as a thing that is poured into a salad: a
 * bottled dressing measured out by the 30 ml does not bring a bottle with it.
 *
 * ## The walk terminates
 *
 * A visited set and a depth cap, the discipline
 * {@see RecomputeRecipeDerivations} already runs on the
 * same output→line graph. Two versions each producing what the other consumes is
 * a real shape in an imported catalogue, and a costing pass that recursed into it
 * would never return.
 */
final readonly class WeeklyRecipeCostingService
{
    /**
     * How many component hops a costing will follow. Matches the derivation
     * job's cap: a chain deeper than this is a data problem rather than a recipe,
     * and costing it is not the place to discover that.
     */
    private const int MAX_DEPTH = 5;

    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    public function __construct(
        private RecipeCostingService $costing,
        private IngredientWeeklyPriceLookup $weeklyPrices,
        private UnitConversionService $conversion,
    ) {}

    /**
     * Cost one version at this week's prices.
     *
     * `$publicationId` pins the answer to one publication rather than to whatever
     * is standing now — what a completed production batch reads back, so that
     * next Monday cannot move last month's estimate.
     *
     * @param  Collection<int, RecipeVersionLine>|null  $lines  pre-loaded, to save a query
     * @param  Collection<int, RecipeVersionPackaging>|null  $packaging  pre-loaded, to save a query
     */
    public function cost(
        string $organisationId,
        RecipeVersion $version,
        ?Collection $lines = null,
        ?Collection $packaging = null,
        ?string $publicationId = null,
    ): WeeklyCostComputation {
        return $this->costVersion($organisationId, $version, $lines, $packaging, $publicationId, []);
    }

    /**
     * The costing itself, carrying the chain of versions already being costed
     * above it.
     *
     * Separate from {@see cost()} so the visited set is threaded rather than
     * restarted: a public entry point that reset it on every hop would leave the
     * cycle guard looking present and doing nothing, which is worse than not
     * having one.
     *
     * @param  Collection<int, RecipeVersionLine>|null  $lines
     * @param  Collection<int, RecipeVersionPackaging>|null  $packaging
     * @param  list<string>  $visitedVersionIds
     */
    private function costVersion(
        string $organisationId,
        RecipeVersion $version,
        ?Collection $lines,
        ?Collection $packaging,
        ?string $publicationId,
        array $visitedVersionIds,
    ): WeeklyCostComputation {
        $lines ??= $this->costing->linesOf($version);
        $packaging ??= RecipeVersionPackaging::query()
            ->where('recipe_version_id', $version->getKey())
            ->orderBy('line_number')
            ->get();

        $sources = $this->resolveLines($organisationId, $lines, $publicationId, $visitedVersionIds);
        $pricedLines = $this->applyTo($lines, $sources);
        $pricedPackaging = $this->applyToPackaging($organisationId, $packaging, $publicationId);

        try {
            $production = $this->costing->computeRecalculated($version, $pricedLines);
        } catch (MixedCostCurrency) {
            /*
             * Reported as "nothing is costed" rather than thrown, for the reason
             * `DraftCostService` gives: this is a read on a page somebody is
             * looking at, not a write. A formulation whose ingredients are priced
             * in two currencies has no total in a system with no exchange rate,
             * and saying so is better than turning the whole cost block into an
             * error.
             */
            return new WeeklyCostComputation(
                $this->costing->computeRecalculated($version, new Collection),
                $this->costing->computePackaging($version, new Collection),
                null,
                $sources,
                $publicationId,
            );
        }

        $packagingCost = $this->costing->computePackaging($version, $pricedPackaging);

        return new WeeklyCostComputation(
            $production,
            $packagingCost,
            $this->costing->totalCostPerYieldUnit($production, $packagingCost),
            $sources,
            $publicationId,
        );
    }

    /**
     * Where each line's figure comes from.
     *
     * One batched price read for the whole formulation rather than one per line:
     * the technical sheet is the most-read cost surface in the product and an
     * N+1 on it would be felt.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines
     * @param  list<string>  $visitedVersionIds  the component chain above this call
     * @return array<int, WeeklyLineCost>
     */
    private function resolveLines(string $organisationId, Collection $lines, ?string $publicationId, array $visitedVersionIds): array
    {
        $ingredientIds = array_values(array_unique(
            $lines->map(static fn (RecipeVersionLine $line): string => (string) $line->ingredient_id)->all()
        ));

        $prices = $this->pricesFor($organisationId, $ingredientIds, $publicationId);
        $ingredients = $this->ingredientsById($ingredientIds);
        $units = $this->unitsById();

        $sources = [];

        foreach ($lines as $line) {
            $sources[$line->line_number] = $this->resolveLine(
                $organisationId,
                $line->line_number,
                (string) $line->ingredient_id,
                $line->unit_id,
                $prices[(string) $line->ingredient_id] ?? null,
                $ingredients[(string) $line->ingredient_id] ?? null,
                $units,
                $publicationId,
                $visitedVersionIds,
            );
        }

        return $sources;
    }

    /**
     * The four sources, in order, for one ingredient wanted in one unit.
     *
     * Takes the three fields it needs rather than a {@see RecipeVersionLine},
     * because a production batch asks the same question about a *stock item*
     * rather than a formulation line (PROD1) and two implementations of "where
     * does this ingredient's price come from" would drift on exactly the
     * ingredients that are hardest to price.
     *
     * @param  array<string, MeasurementUnit>  $units
     * @param  list<string>  $visitedVersionIds
     */
    private function resolveLine(
        string $organisationId,
        int $lineNumber,
        string $ingredientId,
        ?string $lineUnitId,
        ?WeeklyIngredientPrice $price,
        ?Ingredient $ingredient,
        array $units,
        ?string $publicationId,
        array $visitedVersionIds,
    ): WeeklyLineCost {
        if ($lineUnitId === null || ! $ingredient instanceof Ingredient) {
            return WeeklyLineCost::none($lineNumber, $ingredientId);
        }

        // 1. What was actually paid.
        if ($price instanceof WeeklyIngredientPrice) {
            $restated = $this->pricePerUnit($price->amount, $price->unitId, $lineUnitId, $units);

            if ($restated !== null) {
                return new WeeklyLineCost(
                    $lineNumber,
                    $ingredientId,
                    WeeklyLineCost::SOURCE_WEEKLY,
                    $restated,
                    $price->currencyCode,
                    $price->effectiveFrom,
                    null,
                    $price->isCarriedForward(),
                    $price->publicationId,
                );
            }
        }

        // 2. What it costs to make.
        $component = $this->componentCost($organisationId, $ingredient, $lineUnitId, $units, $publicationId, $visitedVersionIds);

        if ($component !== null) {
            return new WeeklyLineCost(
                $lineNumber,
                $ingredientId,
                WeeklyLineCost::SOURCE_COMPONENT,
                $component['amount'],
                $component['currency'],
                null,
                $component['version_id'],
            );
        }

        // 3. What somebody typed.
        $typed = $this->typedPrice($ingredient, $lineUnitId, $units);

        if ($typed !== null) {
            return new WeeklyLineCost(
                $lineNumber,
                $ingredientId,
                WeeklyLineCost::SOURCE_FALLBACK,
                $typed['amount'],
                $typed['currency'],
                null,
            );
        }

        return WeeklyLineCost::none($lineNumber, $ingredientId);
    }

    /**
     * One unit cost per ingredient, each in the unit the caller names (PROD1).
     *
     * The production planner's entry point. It asks the same question a
     * formulation line asks — what does one unit of this ingredient cost, and on
     * whose authority — but about a **stock item's** unit rather than a recipe
     * line's, and about a set of ingredients that came out of an explosion rather
     * than off one version.
     *
     * Batched for the same reason {@see resolveLines()} is: a batch of ninety
     * shelves must cost a handful of reads.
     *
     * `$publicationId` pins the answer to one published week, which is what a
     * confirmed batch stores so that next Monday cannot move its estimate.
     *
     * @param  array<string, string>  $unitByIngredient  ingredient id => the unit the cost is wanted in
     * @return array<string, WeeklyLineCost> keyed by ingredient id; `lineNumber` is not meaningful here and is always zero
     */
    public function unitCostsFor(
        string $organisationId,
        array $unitByIngredient,
        ?string $publicationId = null,
    ): array {
        if ($unitByIngredient === []) {
            return [];
        }

        $ingredientIds = array_map(strval(...), array_keys($unitByIngredient));

        $prices = $this->pricesFor($organisationId, $ingredientIds, $publicationId);
        $ingredients = $this->ingredientsById($ingredientIds);
        $units = $this->unitsById();

        $costs = [];

        foreach ($unitByIngredient as $ingredientId => $unitId) {
            $costs[(string) $ingredientId] = $this->resolveLine(
                $organisationId,
                0,
                (string) $ingredientId,
                $unitId,
                $prices[(string) $ingredientId] ?? null,
                $ingredients[(string) $ingredientId] ?? null,
                $units,
                $publicationId,
                [],
            );
        }

        return $costs;
    }

    /**
     * The cost of one unit of a produced component, from the recipe that makes it.
     *
     * Null whenever the chain cannot be followed honestly: nothing claims the
     * ingredient, the claiming version is no longer published, the version states
     * no output of this ingredient, the cycle guard has already seen it, or the
     * depth cap is reached.
     *
     * @param  array<string, MeasurementUnit>  $units
     * @param  list<string>  $visitedVersionIds
     * @return array{amount: numeric-string, currency: string, version_id: string}|null
     */
    private function componentCost(
        string $organisationId,
        Ingredient $ingredient,
        string $lineUnitId,
        array $units,
        ?string $publicationId,
        array $visitedVersionIds,
    ): ?array {
        $versionId = $ingredient->nutrition_derived_from_version_id;

        if ($versionId === null || in_array($versionId, $visitedVersionIds, true) || count($visitedVersionIds) >= self::MAX_DEPTH) {
            return null;
        }

        /** @var RecipeVersion|null $version */
        $version = RecipeVersion::withoutTenancy()
            ->whereKey($versionId)
            ->where('organisation_id', $organisationId)
            ->where('status', RecipeVersionStatus::Published->value)
            ->first();

        if (! $version instanceof RecipeVersion) {
            return null;
        }

        /** @var RecipeVersionOutput|null $output */
        $output = RecipeVersionOutput::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->where('ingredient_id', $ingredient->getKey())
            ->first();

        if (! $output instanceof RecipeVersionOutput) {
            return null;
        }

        $outputQuantity = (string) $output->output_quantity;

        if (! is_numeric($outputQuantity) || bccomp($outputQuantity, '0', self::SCALE) !== 1) {
            return null;
        }

        $inner = $this->costVersion(
            $organisationId,
            $version,
            null,
            new Collection, // formulation only: a component brings no packaging with it
            $publicationId,
            [...$visitedVersionIds, $versionId],
        );

        // Withheld rather than approximated. A component whose own formulation is
        // part-priced would otherwise contribute a total that silently omits
        // whatever it could not cost, and the parent would read as complete.
        if (! $inner->production->isComplete() || $inner->production->currencyCode === null) {
            return null;
        }

        $perOutputUnit = $this->round(bcdiv(
            $inner->production->totalInputCostAmount,
            $outputQuantity,
            self::WORKING_SCALE,
        ));

        $restated = $this->pricePerUnit($perOutputUnit, (string) $output->unit_id, $lineUnitId, $units);

        if ($restated === null) {
            return null;
        }

        return [
            'amount' => $restated,
            'currency' => $inner->production->currencyCode,
            'version_id' => (string) $version->getKey(),
        ];
    }

    /**
     * The operator's typed purchase price, per the line's unit.
     *
     * The same resolution `RecipeVersionService::ingredientCostFor()` performs at
     * write time — priced per the purchase unit where one is recorded, per the
     * issue unit otherwise — so a line that falls back here costs exactly what
     * saving it would have frozen.
     *
     * @param  array<string, MeasurementUnit>  $units
     * @return array{amount: numeric-string, currency: string}|null
     */
    private function typedPrice(Ingredient $ingredient, string $lineUnitId, array $units): ?array
    {
        $amount = $ingredient->purchase_price_amount;
        $currency = $ingredient->purchase_price_currency;

        if ($amount === null || $currency === null) {
            return null;
        }

        $pricedIn = (string) ($ingredient->purchase_unit_id ?? $ingredient->default_unit_id);
        $restated = $this->pricePerUnit((string) $amount, $pricedIn, $lineUnitId, $units);

        return $restated === null ? null : ['amount' => $restated, 'currency' => mb_strtoupper($currency)];
    }

    /**
     * A price restated per another unit, or null when that cannot be done honestly.
     *
     * A price is per unit, so it converts the **opposite** way to a quantity: four
     * dollars a kilogram is four thousandths of a dollar a gram, which is
     * `price × to.base_ratio ÷ from.base_ratio`.
     *
     * `canConvert()` is asked first and never worked around, because the five
     * `package`-dimension units all carry `base_ratio` 1 and a bare ratio division
     * across two of them would quietly price a bag as a can.
     *
     * @param  array<string, MeasurementUnit>  $units
     * @return numeric-string|null
     */
    private function pricePerUnit(string $amount, string $fromUnitId, string $toUnitId, array $units): ?string
    {
        if (! is_numeric($amount)) {
            return null;
        }

        if ($fromUnitId === $toUnitId) {
            return $this->round($amount);
        }

        $from = $units[$fromUnitId] ?? null;
        $to = $units[$toUnitId] ?? null;

        if (! $from instanceof MeasurementUnit || ! $to instanceof MeasurementUnit) {
            return null;
        }

        if (! $this->conversion->canConvert($from, $to)) {
            return null;
        }

        $fromRatio = (string) $from->base_ratio;
        $toRatio = (string) $to->base_ratio;

        if (! is_numeric($fromRatio) || bccomp($fromRatio, '0', 9) !== 1) {
            return null;
        }

        return $this->round(bcmul($amount, bcdiv($toRatio, $fromRatio, self::WORKING_SCALE), self::WORKING_SCALE));
    }

    /**
     * The formulation, with each line's resolved cost hung on an unsaved clone.
     *
     * `replicate()` rather than a fresh model so nothing a line carries is lost on
     * the way — and unsaved so the real rows keep the figures they were saved
     * with. Costing reads attributes and never the database, which is the door
     * `DraftCostService` already uses.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines
     * @param  array<int, WeeklyLineCost>  $sources
     * @return Collection<int, RecipeVersionLine>
     */
    private function applyTo(Collection $lines, array $sources): Collection
    {
        /** @var Collection<int, RecipeVersionLine> $priced */
        $priced = new Collection;

        foreach ($lines as $line) {
            $source = $sources[$line->line_number] ?? null;

            $clone = $line->replicate();
            $clone->unit_cost_amount = $source?->isCosted() === true ? $source->unitCostAmount : null;
            $clone->cost_currency_code = $source?->isCosted() === true ? $source->currencyCode : null;
            $clone->line_number = $line->line_number;
            $clone->quantity = $line->quantity;
            $clone->unit_id = $line->unit_id;
            $clone->ingredient_id = $line->ingredient_id;

            $priced->push($clone);
        }

        return $priced;
    }

    /**
     * The packaging rows, priced the same way.
     *
     * Packaging is an ingredient filed under `packaging-disposables`, so it has a
     * weekly price like anything else the kitchen buys. It never has a component
     * recipe — nobody cooks a box — so the resolution is the weekly price or the
     * typed one.
     *
     * @param  Collection<int, RecipeVersionPackaging>  $packaging
     * @return Collection<int, RecipeVersionPackaging>
     */
    private function applyToPackaging(string $organisationId, Collection $packaging, ?string $publicationId): Collection
    {
        /** @var Collection<int, RecipeVersionPackaging> $priced */
        $priced = new Collection;

        if ($packaging->isEmpty()) {
            return $priced;
        }

        $ingredientIds = array_values(array_unique(
            $packaging->map(static fn (RecipeVersionPackaging $row): string => (string) $row->ingredient_id)->all()
        ));

        $prices = $this->pricesFor($organisationId, $ingredientIds, $publicationId);
        $ingredients = $this->ingredientsById($ingredientIds);
        $units = $this->unitsById();

        foreach ($packaging as $row) {
            $ingredientId = (string) $row->ingredient_id;
            $unitId = $row->unit_id;
            $amount = null;
            $currency = null;

            if ($unitId !== null) {
                $price = $prices[$ingredientId] ?? null;

                if ($price instanceof WeeklyIngredientPrice) {
                    $amount = $this->pricePerUnit($price->amount, $price->unitId, $unitId, $units);
                    $currency = $amount === null ? null : $price->currencyCode;
                }

                if ($amount === null) {
                    $typed = ($ingredients[$ingredientId] ?? null) instanceof Ingredient
                        ? $this->typedPrice($ingredients[$ingredientId], $unitId, $units)
                        : null;

                    $amount = $typed['amount'] ?? null;
                    $currency = $typed['currency'] ?? null;
                }
            }

            $clone = $row->replicate();
            $clone->line_number = $row->line_number;
            $clone->ingredient_id = $row->ingredient_id;
            $clone->basis = $row->basis;
            $clone->quantity = $row->quantity;
            $clone->unit_id = $row->unit_id;
            $clone->unit_cost_amount = $amount;
            $clone->cost_currency_code = $currency;

            $priced->push($clone);
        }

        return $priced;
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice>
     */
    private function pricesFor(string $organisationId, array $ingredientIds, ?string $publicationId): array
    {
        return $publicationId === null
            ? $this->weeklyPrices->standingFor($organisationId, $ingredientIds)
            : $this->weeklyPrices->atPublication($organisationId, $publicationId, $ingredientIds);
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return array<string, Ingredient>
     */
    private function ingredientsById(array $ingredientIds): array
    {
        /** @var array<string, Ingredient> $ingredients */
        $ingredients = Ingredient::withoutTenancy()
            ->whereIn('id', $ingredientIds)
            ->get()
            ->keyBy(static fn (Ingredient $ingredient): string => (string) $ingredient->getKey())
            ->all();

        return $ingredients;
    }

    /**
     * @return array<string, MeasurementUnit>
     */
    private function unitsById(): array
    {
        /** @var array<string, MeasurementUnit> $units */
        $units = MeasurementUnit::query()
            ->get()
            ->keyBy(static fn (MeasurementUnit $unit): string => (string) $unit->getKey())
            ->all();

        return $units;
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
}
