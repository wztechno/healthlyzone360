<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Ingredients\Contracts\IngredientWeeklyPriceLookup;
use Healthy360\Ingredients\Contracts\WeeklyIngredientPrice;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Procurement\Enums\WeeklyPriceSource;
use Healthy360\Procurement\Models\IngredientWeeklyPrice;
use Illuminate\Database\Eloquent\Builder;

/**
 * Procurement's answer to {@see IngredientWeeklyPriceLookup}.
 *
 * ## Standing is derived, not stored
 *
 * `ingredient_weekly_prices` is append-only, so there is no `is_standing` column
 * to keep true — clearing one would need an UPDATE the runtime role does not have.
 * The standing price is the newest row an ingredient has, and "newest" is three
 * keys deep on purpose:
 *
 * 1. `effective_from_date` — so a week published late cannot displace a newer one
 *    that was published on time;
 * 2. the publication's `published_at` — so a recompute wins over the publication
 *    it superseded;
 * 3. `id` — so the answer is deterministic when two rows share both.
 *
 * `DISTINCT ON` does the per-ingredient pick in one pass, the same shape
 * {@see LastPurchasePriceQuery} uses for the last purchase price and for the same
 * reason: a correlated subquery per ingredient would be an N+1 on the technical
 * sheet, which is the most-read cost surface in the product. PostgreSQL requires
 * the `DISTINCT ON` expression to lead the `ORDER BY`, which is why
 * `ingredient_id` is ordered first and the three ranking keys follow it.
 *
 * Rows are hydrated as models rather than read as raw `stdClass`: the model's
 * property docblock is what makes an amount a `numeric-string` and a source an
 * enum, so the mapping below is checked rather than assumed.
 *
 * ## Unpriced rows are filtered out here, once
 *
 * A row with `source = unpriced` records that an ingredient has no usable price.
 * It is real evidence — the initial-price-entry list reads exactly those — but it
 * is not a price, so it never leaves this class as one. Filtering on
 * `average_unit_amount IS NOT NULL` rather than on the source keeps that true even
 * if a fourth source is added later.
 *
 * ## A kitchen's copy borrows its original's prices
 *
 * Editing a library ingredient forks it (`IngredientCatalogueService::fork()`),
 * but the shelf, the receipts and so every price stay on the library row: the
 * kitchen still buys the original. A copy with no price of its own therefore
 * reads its original's, so a recipe that moved to the copy is not left unpriced
 * by a soy sauce somebody really did pay for. A copy's own price always wins.
 */
final readonly class WeeklyPriceLookup implements IngredientWeeklyPriceLookup
{
    public function __construct(private LastPurchasePriceQuery $lastPurchases) {}

    public function standing(string $organisationId, string $ingredientId): ?WeeklyIngredientPrice
    {
        $prices = $this->standingFor($organisationId, [$ingredientId]);

        return $prices[$ingredientId] ?? null;
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice>
     */
    public function standingFor(string $organisationId, array $ingredientIds): array
    {
        $ingredientIds = array_values(array_unique($ingredientIds));

        return $this->withOriginals(
            $organisationId,
            $ingredientIds,
            fn (array $ids): array => $this->ownStanding($organisationId, $ids),
        );
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice>
     */
    private function ownStanding(string $organisationId, array $ingredientIds): array
    {
        if ($ingredientIds === []) {
            return [];
        }

        /** @var list<IngredientWeeklyPrice> $rows */
        $rows = $this->base($organisationId)
            ->whereIn('ingredient_weekly_prices.ingredient_id', $ingredientIds)
            ->selectRaw('DISTINCT ON (ingredient_weekly_prices.ingredient_id) ingredient_weekly_prices.*')
            ->orderBy('ingredient_weekly_prices.ingredient_id')
            ->orderByDesc('ingredient_weekly_prices.effective_from_date')
            ->orderByDesc('weekly_price_publications.published_at')
            ->orderByDesc('ingredient_weekly_prices.id')
            ->get()
            ->all();

        return $this->map($rows);
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice>
     */
    public function atPublication(string $organisationId, string $publicationId, array $ingredientIds): array
    {
        $ingredientIds = array_values(array_unique($ingredientIds));

        return $this->withOriginals(
            $organisationId,
            $ingredientIds,
            fn (array $ids): array => $this->ownAtPublication($organisationId, $publicationId, $ids),
        );
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice>
     */
    private function ownAtPublication(string $organisationId, string $publicationId, array $ingredientIds): array
    {
        if ($ingredientIds === []) {
            return [];
        }

        /** @var list<IngredientWeeklyPrice> $rows */
        $rows = $this->base($organisationId)
            ->where('ingredient_weekly_prices.weekly_price_publication_id', $publicationId)
            ->whereIn('ingredient_weekly_prices.ingredient_id', $ingredientIds)
            ->select('ingredient_weekly_prices.*')
            ->get()
            ->all();

        return $this->map($rows);
    }

    /**
     * The newest priced receipt line of each ingredient, read through its stock
     * items (a resold product shares its ingredient's anchor, so the newest across
     * them wins) by {@see LastPurchasePriceQuery}, the same read the stock screen's
     * "last bought" column uses. A line with no unit or currency is not a price.
     *
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice>
     */
    public function latestPurchaseFor(string $organisationId, array $ingredientIds): array
    {
        $ingredientIds = array_values(array_unique($ingredientIds));

        return $this->withOriginals(
            $organisationId,
            $ingredientIds,
            fn (array $ids): array => $this->ownLatestPurchase($organisationId, $ids),
        );
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return array<string, WeeklyIngredientPrice>
     */
    private function ownLatestPurchase(string $organisationId, array $ingredientIds): array
    {
        if ($ingredientIds === []) {
            return [];
        }

        /** @var array<string, string> $ingredientOf stock item id => ingredient id */
        $ingredientOf = StockItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('ingredient_id', $ingredientIds)
            ->pluck('ingredient_id', 'id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        $newest = [];

        foreach ($this->lastPurchases->perItem($organisationId, array_map(strval(...), array_keys($ingredientOf))) as $stockItemId => $line) {
            $ingredientId = $ingredientOf[$stockItemId] ?? null;

            if ($ingredientId === null || $line['unit_id'] === null || $line['cost_currency_code'] === null || $line['received_at'] === null) {
                continue;
            }

            if (isset($newest[$ingredientId]) && $newest[$ingredientId]['received_at'] >= $line['received_at']) {
                continue;
            }

            $newest[$ingredientId] = $line;
        }

        $prices = [];

        foreach ($newest as $ingredientId => $line) {
            $day = substr((string) $line['received_at'], 0, 10);

            $prices[$ingredientId] = new WeeklyIngredientPrice(
                $ingredientId,
                $line['unit_price_amount'],
                (string) $line['cost_currency_code'],
                (string) $line['unit_id'],
                $day,
                $day,
                'latest_purchase',
                null,
            );
        }

        return $prices;
    }

    /**
     * `$read` for the ingredients asked about, then — for each of this kitchen's
     * copies it found nothing for — `$read` once more for the originals, with the
     * answer re-keyed to the copy that asked.
     *
     * One extra pair of queries per batch at most, and none when nothing asked
     * about is an unpriced copy.
     *
     * @param  list<string>  $ingredientIds
     * @param  callable(list<string>): array<string, WeeklyIngredientPrice>  $read
     * @return array<string, WeeklyIngredientPrice>
     */
    private function withOriginals(string $organisationId, array $ingredientIds, callable $read): array
    {
        $prices = $read($ingredientIds);
        $unpriced = array_values(array_diff($ingredientIds, array_keys($prices)));

        if ($unpriced === []) {
            return $prices;
        }

        /** @var array<string, string> $originalOf copy id => original id */
        $originalOf = Ingredient::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('id', $unpriced)
            ->whereNotNull('forked_from_ingredient_id')
            ->pluck('forked_from_ingredient_id', 'id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        if ($originalOf === []) {
            return $prices;
        }

        $borrowed = $read(array_values(array_unique($originalOf)));

        foreach ($originalOf as $copyId => $originalId) {
            $price = $borrowed[$originalId] ?? null;

            if (! $price instanceof WeeklyIngredientPrice) {
                continue;
            }

            $prices[(string) $copyId] = new WeeklyIngredientPrice(
                (string) $copyId,
                $price->amount,
                $price->currencyCode,
                $price->unitId,
                $price->effectiveFrom,
                $price->purchaseWeekStartDate,
                $price->source,
                $price->publicationId,
            );
        }

        return $prices;
    }

    /**
     * Every priced row for this organisation, joined to the publication that
     * carries the tie-breaking instant.
     *
     * Scoped explicitly on `organisation_id` rather than through the model's
     * tenancy scope: the callers include a scheduled publisher and an order confirm
     * running inside a job whose ambient tenant is not the seller, and a read that
     * depended on request context would quietly find nothing.
     *
     * @return Builder<IngredientWeeklyPrice>
     */
    private function base(string $organisationId): Builder
    {
        return IngredientWeeklyPrice::withoutTenancy()
            ->join('weekly_price_publications', 'weekly_price_publications.id', '=', 'ingredient_weekly_prices.weekly_price_publication_id')
            ->where('ingredient_weekly_prices.organisation_id', $organisationId)
            ->whereNotNull('ingredient_weekly_prices.average_unit_amount');
    }

    /**
     * @param  list<IngredientWeeklyPrice>  $rows
     * @return array<string, WeeklyIngredientPrice>
     */
    private function map(array $rows): array
    {
        $prices = [];

        foreach ($rows as $row) {
            $amount = $row->average_unit_amount;
            $currency = $row->currency_code;
            $unitId = $row->unit_id;

            // The three travel together by database CHECK, so all-or-nothing here
            // is the same invariant read from this side rather than a second rule.
            if ($amount === null || $currency === null || $unitId === null) {
                continue;
            }

            $ingredientId = (string) $row->ingredient_id;

            $prices[$ingredientId] = new WeeklyIngredientPrice(
                $ingredientId,
                $amount,
                $currency,
                $unitId,
                $row->effective_from_date->toDateString(),
                $row->purchase_week_start_date->toDateString(),
                $row->source === WeeklyPriceSource::CarriedForward ? 'carried_forward' : 'computed',
                (string) $row->weekly_price_publication_id,
            );
        }

        return $prices;
    }
}
