<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Services\OrganisationTimezone;
use Healthy360\Procurement\Enums\WeeklyPriceCarryReason;
use Healthy360\Procurement\Enums\WeeklyPriceSource;
use Healthy360\Procurement\Models\IngredientWeeklyPrice;
use Healthy360\Procurement\Models\WeeklyPricePublication;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Illuminate\Support\Facades\DB;

/**
 * Publishes a completed purchase week's ingredient prices (PROD1).
 *
 * ## Only the ingredients the week has something to say about
 *
 * A publication holds a row for each ingredient this organisation **bought**
 * during the week — computed where the week averaged, and a carried or unpriced
 * row where it could not. It deliberately does **not** hold a row per ingredient
 * in the library. Writing three hundred "nothing happened" rows every Monday
 * would be fifteen thousand rows a year per kitchen saying nothing, and the
 * requirement's "retain its most recent available weekly price and display its
 * effective date" is already satisfied without them: the standing price is the
 * newest row an ingredient has, and its own `effective_from_date` is the date
 * displayed beside it.
 *
 * The consequence worth stating: an ingredient with **no** row anywhere has never
 * been bought at a recorded price, and that absence is exactly the "flag for
 * initial price entry" list. It is a query, not a stored flag.
 *
 * ## Carrying forward, and when carrying is refused
 *
 * A week that produced no usable average carries the ingredient's previous
 * standing price into this publication, with the reason it had to. Carrying is
 * refused in one case: the ingredient's default unit has moved since that price
 * was published and the old figure cannot be restated in the new one — a price per
 * `piece` against a shelf now counted in kilograms. Carrying it anyway would be
 * wrong by whatever a piece weighs, so the row is published `unpriced` with
 * `not_convertible`, which sends it to the initial-price-entry list where somebody
 * can put a real number on it. The same three outcomes
 * {@see IngredientCostService::rebaseHeldBalance()} distinguishes, for the same
 * reason.
 *
 * A **price** per unit converts the opposite way to a quantity: a price per
 * kilogram is a thousandth of itself per gram. That is why {@see restatePrice()}
 * multiplies by `to ÷ from` where a quantity conversion multiplies by `from ÷ to`.
 *
 * ## Atomic, and idempotent on the week
 *
 * The publication header and its price rows commit together — a header with no
 * rows would claim a week was priced when nothing was. `publishDueWeeks()` skips
 * a week that already has a publication, so a job that runs hourly publishes each
 * week exactly once and re-running it costs one indexed existence check.
 *
 * ## Recoverable
 *
 * The catch-up walks the last {@see BACKFILL_WEEKS} completed weeks oldest-first
 * rather than only asking about this Monday. A Monday-only guard loses the week
 * entirely if the system is unavailable that day, and a kitchen would find out
 * when a technical sheet quietly costed itself at a fortnight-old price. The bound
 * is what stops a long outage turning one scheduled tick into unbounded work.
 */
final readonly class WeeklyPricePublisher
{
    /**
     * How far back a catch-up will reach. Eight weeks is long enough to cover an
     * outage nobody noticed over a holiday and short enough that the first run on
     * a kitchen with years of receipts does not try to rebuild all of them.
     */
    public const int BACKFILL_WEEKS = 8;

    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    public function __construct(
        private WeeklyPriceCalculator $calculator,
        private UnitConversionService $conversion,
        private OrganisationTimezone $timezones,
    ) {}

    /**
     * Publish every completed week this organisation still owes, oldest first.
     *
     * @return list<WeeklyPricePublication> in publication order; empty when nothing was due
     */
    public function publishDueWeeks(string $organisationId, ?CarbonImmutable $now = null): array
    {
        $timezone = $this->timezones->forOrganisationId($organisationId);
        $localNow = ($now ?? CarbonImmutable::now())->setTimezone($timezone);

        // The most recent week that has actually finished: the Sunday before the
        // Monday of the local week we are standing in.
        $latestStart = $localNow->startOfWeek(CarbonImmutable::MONDAY)->subWeek()->startOfDay();

        $published = [];

        for ($offset = self::BACKFILL_WEEKS - 1; $offset >= 0; $offset--) {
            $weekStart = $latestStart->subWeeks($offset);

            if ($this->isPublished($organisationId, $weekStart)) {
                continue;
            }

            $publication = $this->publishWeek($organisationId, $weekStart, $now);

            if ($publication instanceof WeeklyPricePublication) {
                $published[] = $publication;
            }
        }

        return $published;
    }

    /**
     * Publish one purchase week.
     *
     * Returns null when the week bought nothing at all: a publication with no rows
     * records no fact, and inserting one would make "this week was published" and
     * "this week has prices" two different questions with the same answer stored.
     * The next run will find the week unpublished and ask again, which is correct —
     * a late receipt for it is still a receipt for it.
     */
    public function publishWeek(
        string $organisationId,
        CarbonImmutable $weekStartDate,
        ?CarbonImmutable $now = null,
        ?string $supersedesId = null,
    ): ?WeeklyPricePublication {
        $timezone = $this->timezones->forOrganisationId($organisationId);
        $weekStart = $weekStartDate->startOfDay();
        $weekEnd = $weekStart->addDays(6);
        $effectiveFrom = $weekEnd->addDay();

        $computations = $this->calculator->computeWeek($organisationId, $weekStart, $weekEnd);

        if ($computations === []) {
            return null;
        }

        $ingredients = $this->ingredientsById(array_keys($computations));
        $units = $this->unitsById();
        $publishedAt = $now ?? CarbonImmutable::now();

        return DB::transaction(function () use (
            $organisationId,
            $computations,
            $ingredients,
            $units,
            $weekStart,
            $weekEnd,
            $effectiveFrom,
            $timezone,
            $publishedAt,
            $supersedesId,
        ): WeeklyPricePublication {
            // The rows are built before the header exists, and the reason is the
            // REVOKE beside this table: `weekly_price_publications` is append-only
            // at the grant level, so the runtime role may INSERT it once and may
            // never UPDATE it. Creating the header and then writing its counts
            // back would work for the migrator that owns the table and fail for
            // the application role that does not — a bug no test running as the
            // owner could ever catch. So the counts are known first and the header
            // is written exactly once.
            $rows = [];
            $computed = 0;
            $carried = 0;
            $unpriced = 0;

            foreach ($computations as $ingredientId => $computation) {
                $ingredient = $ingredients[$ingredientId] ?? null;

                if (! $ingredient instanceof Ingredient) {
                    continue;
                }

                $row = $this->rowFor($organisationId, $weekStart, $weekEnd, $effectiveFrom, $ingredient, $computation, $units);
                $rows[] = $row;

                match ($row->source) {
                    WeeklyPriceSource::Computed => $computed++,
                    WeeklyPriceSource::CarriedForward => $carried++,
                    WeeklyPriceSource::Unpriced => $unpriced++,
                };
            }

            $publication = new WeeklyPricePublication;
            $publication->organisation_id = $organisationId;
            $publication->purchase_week_start_date = $weekStart;
            $publication->purchase_week_end_date = $weekEnd;
            $publication->effective_from_date = $effectiveFrom;
            $publication->timezone = $timezone;
            $publication->published_at = $publishedAt;
            $publication->supersedes_id = $supersedesId;
            $publication->ingredient_count = $computed + $carried + $unpriced;
            $publication->computed_count = $computed;
            $publication->carried_count = $carried;
            $publication->unpriced_count = $unpriced;
            $publication->save();

            foreach ($rows as $row) {
                $row->weekly_price_publication_id = (string) $publication->getKey();
                $row->save();
            }

            return $publication;
        });
    }

    /**
     * One ingredient's row in this publication: the computed average, or the
     * carried price, or the admission that there is neither.
     *
     * @param  array<string, MeasurementUnit>  $units
     */
    private function rowFor(
        string $organisationId,
        CarbonImmutable $weekStart,
        CarbonImmutable $weekEnd,
        CarbonImmutable $effectiveFrom,
        Ingredient $ingredient,
        WeeklyPriceComputation $computation,
        array $units,
    ): IngredientWeeklyPrice {
        $row = new IngredientWeeklyPrice;
        $row->organisation_id = $organisationId;
        $row->ingredient_id = (string) $ingredient->getKey();
        $row->purchase_week_start_date = $weekStart;
        $row->purchase_week_end_date = $weekEnd;
        $row->effective_from_date = $effectiveFrom;
        $row->receipt_line_count = $computation->receiptLineCount;
        $row->unpriced_line_count = $computation->unpricedLineCount;
        $row->has_unpriced_lines = $computation->hasUnpricedLines();

        if ($computation->isComputed()) {
            $row->source = WeeklyPriceSource::Computed;
            $row->unit_id = $computation->unitId;
            $row->average_unit_amount = $computation->averageUnitAmount;
            $row->currency_code = $computation->currencyCode;
            $row->total_quantity = $computation->totalQuantity;
            $row->total_cost_amount = $computation->totalCostAmount;

            return $row;
        }

        $row->carry_reason = $computation->blockedBy;

        $previous = $this->standingPrice($organisationId, (string) $ingredient->getKey());

        if (! $previous instanceof IngredientWeeklyPrice || $previous->average_unit_amount === null) {
            $row->source = WeeklyPriceSource::Unpriced;

            return $row;
        }

        $restated = $this->restatePrice($previous, $ingredient, $units);

        if ($restated === null) {
            // The price exists and cannot honestly be expressed in the unit this
            // ingredient stocks in today. Publishing it anyway would be wrong by
            // whatever the conversion would have been.
            $row->source = WeeklyPriceSource::Unpriced;
            $row->carry_reason = WeeklyPriceCarryReason::NotConvertible;

            return $row;
        }

        [$amount, $unitId] = $restated;

        $row->source = WeeklyPriceSource::CarriedForward;
        $row->unit_id = $unitId;
        $row->average_unit_amount = $amount;
        $row->currency_code = $previous->currency_code;
        $row->carried_from_week_start_date = $previous->purchase_week_start_date;

        // The denominator and numerator belong to the week that computed the
        // figure, not to this one. Carrying them would claim purchases this week
        // did not have.
        return $row;
    }

    /**
     * The newest price an ingredient has, whatever week it came from.
     *
     * Derived rather than flagged, because the table is append-only and a
     * `is_standing` column would need an UPDATE to clear. Ordered by the effective
     * date first so a back-published week cannot displace a newer one, then by the
     * publication instant so a recompute wins over what it superseded, then by id
     * so the answer is deterministic when two rows somehow share both.
     */
    private function standingPrice(string $organisationId, string $ingredientId): ?IngredientWeeklyPrice
    {
        /** @var IngredientWeeklyPrice|null $price */
        $price = IngredientWeeklyPrice::withoutTenancy()
            ->join('weekly_price_publications', 'weekly_price_publications.id', '=', 'ingredient_weekly_prices.weekly_price_publication_id')
            ->where('ingredient_weekly_prices.organisation_id', $organisationId)
            ->where('ingredient_weekly_prices.ingredient_id', $ingredientId)
            ->whereNotNull('ingredient_weekly_prices.average_unit_amount')
            ->orderByDesc('ingredient_weekly_prices.effective_from_date')
            ->orderByDesc('weekly_price_publications.published_at')
            ->orderByDesc('ingredient_weekly_prices.id')
            ->first(['ingredient_weekly_prices.*']);

        return $price;
    }

    /**
     * A carried price, expressed in the unit the ingredient stocks in today.
     *
     * Three outcomes, and the middle one is the whole point:
     *
     * 1. **Same unit** — the overwhelmingly common case, returned unchanged.
     * 2. **A convertible pair** (`kg` → `g`, `l` → `ml`) — restated exactly. A
     *    price is per unit, so it moves the *opposite* way to a quantity: one
     *    kilogram at 4.00 is one gram at 0.004, which is `4 × (1 ÷ 1000)`, or
     *    `price × to.base_ratio ÷ from.base_ratio`.
     * 3. **Anything else** — refused with null. `canConvert()` is asked first
     *    rather than the ratios being divided blind, because the five
     *    `package`-dimension units all carry `base_ratio` 1 and would otherwise
     *    convert one-for-one.
     *
     * @param  array<string, MeasurementUnit>  $units
     * @return array{numeric-string, string}|null the restated amount and the unit it is per
     */
    private function restatePrice(IngredientWeeklyPrice $previous, Ingredient $ingredient, array $units): ?array
    {
        $amount = $previous->average_unit_amount;

        // Guarded here rather than trusted from the caller: casting a null
        // amount to a string would produce `''`, which bcmath reads as zero and
        // would carry a free ingredient forward.
        if ($amount === null) {
            return null;
        }

        $currentUnitId = (string) $ingredient->default_unit_id;
        $heldUnitId = (string) $previous->unit_id;

        if ($heldUnitId === $currentUnitId) {
            return [$amount, $currentUnitId];
        }

        $heldUnit = $units[$heldUnitId] ?? null;
        $currentUnit = $units[$currentUnitId] ?? null;

        if (! $heldUnit instanceof MeasurementUnit || ! $currentUnit instanceof MeasurementUnit) {
            return null;
        }

        if (! $this->conversion->canConvert($heldUnit, $currentUnit)) {
            return null;
        }

        $fromRatio = (string) $heldUnit->base_ratio;
        $toRatio = (string) $currentUnit->base_ratio;

        if (! is_numeric($fromRatio) || bccomp($fromRatio, '0', 9) !== 1) {
            return null;
        }

        $restated = $this->round(bcmul($amount, bcdiv($toRatio, $fromRatio, self::WORKING_SCALE), self::WORKING_SCALE));

        return [$restated, $currentUnitId];
    }

    private function isPublished(string $organisationId, CarbonImmutable $weekStartDate): bool
    {
        return WeeklyPricePublication::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereDate('purchase_week_start_date', $weekStartDate->toDateString())
            ->exists();
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
            ->get(['id', 'default_unit_id'])
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
