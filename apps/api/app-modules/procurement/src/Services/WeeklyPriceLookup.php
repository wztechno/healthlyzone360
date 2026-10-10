<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Ingredients\Contracts\IngredientWeeklyPriceLookup;
use Healthy360\Ingredients\Contracts\WeeklyIngredientPrice;
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
 */
final readonly class WeeklyPriceLookup implements IngredientWeeklyPriceLookup
{
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
