<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\ReferenceData\Exceptions\UnitConversionUnsupported;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

/**
 * What one sold pack costs — the one implementation of it (plan S5).
 *
 *     contents  = fill × production cost per yield unit (or per piece), with production waste
 *     packaging = Σ unit cost × quantity × (1 + that item's own waste ÷ 100)
 *     cost      = contents + packaging
 *
 * ## Complete or withheld
 *
 * A pack cost that quietly left out the bottle reads exactly like one that had no bottle to
 * add, so there is no partial figure. `contents_amount` is stated whenever the production half
 * is complete and the fill converts into what it is costed per; `packaging_amount` and
 * `cost_amount` are null, with the reason, whenever anything is missing. A pack with no
 * container yet — every `b2b` / `b2c` / `unit` pack that exists today — is `packaging_unknown`,
 * which is a prompt to choose one rather than a cost of zero.
 *
 * ## A volume is read as the same weight
 *
 * 1 L = 1 kg (owner ruling 4). Done through
 * {@see UnitConversionService::convertByWeight()} with a litre weighing 1000 g, so `convert()`
 * stays the strict, dimension-respecting rule everything else relies on.
 *
 * ## Packaging is priced by the rule a recipe's packaging line already uses
 *
 * {@see RecipeVersionService::packagingCostOf()} — the purchase price over the items in a
 * purchase pack — reached rather than copied. A packaging price in a currency other than the
 * production cost's is reported as `packaging_unpriced`: there is no exchange rate anywhere in
 * this system.
 *
 * Bcmath throughout, at the scales and with the half-up rounding {@see RecipeCostingService}
 * uses. Each of the three figures is rounded once, and the cost is the sum of the two rounded
 * halves, so a reader adding the columns gets the total they are shown.
 */
final readonly class PackCost
{
    public const string PRODUCTION_INCOMPLETE = 'production_incomplete';

    public const string NO_YIELD = 'no_yield';

    public const string NO_PIECE_COUNT = 'no_piece_count';

    public const string UNIT_UNSUPPORTED = 'unit_unsupported';

    public const string PACKAGING_UNKNOWN = 'packaging_unknown';

    public const string PACKAGING_UNPRICED = 'packaging_unpriced';

    private const string PIECE = 'piece';

    /** What a litre weighs under owner ruling 4, in grams. */
    private const string GRAMS_PER_LITRE = '1000';

    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    public function __construct(
        private RecipeVersionService $versions,
        private WeeklyRecipeCostingService $weekly,
        private UnitConversionService $conversion,
    ) {}

    /**
     * Pack costs over a **saved, published** version, its production costed at the live source
     * — paid, then the recipe that makes it, then typed — exactly as Dish margins reads it.
     *
     * The entry point for callers outside this module holding saved packs: they pass the packs
     * as plain arrays, and nothing here reads a catalogue table.
     *
     * @param  list<array{key: string, fill_quantity: float|int|string, fill_unit: string, components: list<array{ingredient_id: string, quantity: float|int|string, is_container: bool}>}>  $packs
     * @return list<array{key: string, contents_amount: numeric-string|null, packaging_amount: numeric-string|null, cost_amount: numeric-string|null, withheld_reason: string|null}>
     */
    public function forVersion(RecipeVersion $version, array $packs): array
    {
        if ($packs === []) {
            return [];
        }

        $organisationId = (string) $version->organisation_id;

        // Formulation only: a pack brings its own packaging, never the version's.
        $production = $this->weekly->cost($organisationId, $version, null, new Collection)->production;

        return $this->of($organisationId, $production, $packs);
    }

    /**
     * Pack costs over a production cost already in hand — the draft preview's path.
     *
     * One query for the units and one for every component of every pack.
     *
     * @param  list<array{key: string, fill_quantity: float|int|string, fill_unit: string, components: list<array{ingredient_id: string, quantity: float|int|string, is_container: bool}>}>  $packs
     * @return list<array{key: string, contents_amount: numeric-string|null, packaging_amount: numeric-string|null, cost_amount: numeric-string|null, withheld_reason: string|null}>
     */
    public function of(string $organisationId, CostComputation $production, array $packs): array
    {
        if ($packs === []) {
            return [];
        }

        $units = MeasurementUnit::query()->get();
        $unitsByCode = $units->keyBy(static fn (MeasurementUnit $unit): string => (string) $unit->code);
        $unitsById = $units->keyBy(static fn (MeasurementUnit $unit): string => (string) $unit->getKey());

        $ingredientIds = [];

        foreach ($packs as $pack) {
            foreach ($pack['components'] as $component) {
                $ingredientIds[(string) $component['ingredient_id']] = true;
            }
        }

        /** @var array<string, Ingredient> $items */
        $items = $ingredientIds === [] ? [] : Ingredient::withoutTenancy()
            ->onlyPackaging()
            ->whereIn('id', array_keys($ingredientIds))
            ->where(static fn (Builder $query) => $query
                ->where('organisation_id', $organisationId)
                ->orWhereNull('organisation_id'))
            ->get()
            ->keyBy(static fn (Ingredient $item): string => (string) $item->getKey())
            ->all();

        $yieldUnit = $production->yieldUnitId === null ? null : $unitsById->get($production->yieldUnitId);
        $litre = $unitsByCode->get('l');

        $results = [];

        foreach ($packs as $pack) {
            $key = (string) $pack['key'];
            $contents = $this->contents($production, $pack, $unitsByCode->get((string) $pack['fill_unit']), $yieldUnit, $litre);

            if (! is_string($contents)) {
                $results[] = $this->withheld($key, null, $contents['reason']);

                continue;
            }

            $packaging = $this->packaging($pack['components'], $items, (string) $production->currencyCode);

            if (is_array($packaging)) {
                $results[] = $this->withheld($key, $contents, $packaging['reason']);

                continue;
            }

            $results[] = [
                'key' => $key,
                'contents_amount' => $contents,
                'packaging_amount' => $packaging,
                'cost_amount' => $this->round(bcadd($contents, $packaging, self::WORKING_SCALE)),
                'withheld_reason' => null,
            ];
        }

        return $results;
    }

    /**
     * The fill at the production cost, or why it cannot be stated.
     *
     * @param  array{fill_quantity: float|int|string, fill_unit: string, ...}  $pack
     * @return numeric-string|array{reason: string}
     */
    private function contents(
        CostComputation $production,
        array $pack,
        ?MeasurementUnit $fillUnit,
        ?MeasurementUnit $yieldUnit,
        ?MeasurementUnit $litre,
    ): string|array {
        if (! $production->isComplete()) {
            return ['reason' => self::PRODUCTION_INCOMPLETE];
        }

        $fill = (string) $pack['fill_quantity'];

        if (! is_numeric($fill)) {
            return ['reason' => self::UNIT_UNSUPPORTED];
        }

        if ($pack['fill_unit'] === self::PIECE) {
            $perPiece = $production->costPerPieceWithWasteAmount;

            return $perPiece === null || ! is_numeric($perPiece)
                ? ['reason' => self::NO_PIECE_COUNT]
                : $this->round(bcmul($fill, $perPiece, self::WORKING_SCALE));
        }

        $perYieldUnit = $production->costPerYieldUnitWithWasteAmount;

        if ($perYieldUnit === null || ! is_numeric($perYieldUnit) || ! $yieldUnit instanceof MeasurementUnit) {
            return ['reason' => self::NO_YIELD];
        }

        if (! $fillUnit instanceof MeasurementUnit) {
            return ['reason' => self::UNIT_UNSUPPORTED];
        }

        try {
            $held = $this->conversion->convertByWeight($fill, $fillUnit, $yieldUnit, self::GRAMS_PER_LITRE, $litre);
        } catch (UnitConversionUnsupported) {
            return ['reason' => self::UNIT_UNSUPPORTED];
        }

        return $this->round(bcmul($held, $perYieldUnit, self::WORKING_SCALE));
    }

    /**
     * Every packaging item at its own waste rate, or why the sum cannot be stated.
     *
     * @param  list<array{ingredient_id: string, quantity: float|int|string, is_container: bool}>  $components
     * @param  array<string, Ingredient>  $items
     * @return numeric-string|array{reason: string}
     */
    private function packaging(array $components, array $items, string $currency): string|array
    {
        $hasContainer = false;

        foreach ($components as $component) {
            $hasContainer = $hasContainer || $component['is_container'];
        }

        if (! $hasContainer) {
            return ['reason' => self::PACKAGING_UNKNOWN];
        }

        $total = '0';

        foreach ($components as $component) {
            $item = $items[(string) $component['ingredient_id']] ?? null;
            $quantity = (string) $component['quantity'];

            if (! $item instanceof Ingredient || ! is_numeric($quantity)) {
                return ['reason' => self::PACKAGING_UNPRICED];
            }

            [$unitCost, $itemCurrency] = $this->versions->packagingCostOf($item);

            if ($unitCost === null || $itemCurrency !== $currency) {
                return ['reason' => self::PACKAGING_UNPRICED];
            }

            $waste = $item->waste_percent === null ? '0' : (string) $item->waste_percent;
            $waste = is_numeric($waste) ? $waste : '0';

            $total = bcadd(
                $total,
                bcmul(
                    bcmul($unitCost, $quantity, self::WORKING_SCALE),
                    bcadd('1', bcdiv($waste, '100', self::WORKING_SCALE), self::WORKING_SCALE),
                    self::WORKING_SCALE,
                ),
                self::WORKING_SCALE,
            );
        }

        return $this->round($total);
    }

    /**
     * @param  numeric-string|null  $contents
     * @return array{key: string, contents_amount: numeric-string|null, packaging_amount: null, cost_amount: null, withheld_reason: string}
     */
    private function withheld(string $key, ?string $contents, string $reason): array
    {
        return [
            'key' => $key,
            'contents_amount' => $contents,
            'packaging_amount' => null,
            'cost_amount' => null,
            'withheld_reason' => $reason,
        ];
    }

    /**
     * Round half away from zero to six places — {@see RecipeCostingService}'s rule.
     *
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
