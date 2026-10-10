<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Procurement\Models\IngredientWeeklyPrice;
use Healthy360\Procurement\Models\WeeklyPricePublication;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;

/**
 * Reading the published weekly prices, for the people who have to look at them
 * (PROD1).
 *
 * ## Why this is not {@see WeeklyPriceLookup}
 *
 * That class answers "what does this ingredient cost", and it is right to filter
 * `average_unit_amount IS NOT NULL`: a row recording that nobody could price an
 * ingredient is evidence, not a price, and it must never leave as one.
 *
 * This answers "what did we publish", and the unpriced rows are **the most
 * important rows in the answer**. The requirement asks for ingredients with no
 * purchase history to be flagged; the flag is exactly a row whose source is
 * `unpriced`, and a surface that inherited the lookup's filter would show a clean
 * list and hide the thing it was built to show.
 *
 * ## Standing is derived here too, and by the same three keys
 *
 * `ingredient_weekly_prices` is append-only, so there is no standing flag to
 * read. The newest row per ingredient is `effective_from_date`, then the
 * publication's `published_at`, then `id` — a week published late cannot displace
 * a newer one that was published on time, a recompute wins over what it
 * superseded, and ties resolve deterministically. Two derivations of one idea is
 * one too many, so if a third appears it belongs in a shared scope; two is where
 * the filters genuinely differ.
 *
 * Paging is offset-based with `has_more` **stated** rather than inferred from a
 * short page: a pager that offers a page it cannot fetch is worse than one that
 * stops.
 */
final readonly class WeeklyPriceQuery
{
    /**
     * The standing row per ingredient, newest first by effective date.
     *
     * @return array{rows: list<IngredientWeeklyPrice>, has_more: bool}
     */
    public function standing(string $organisationId, int $page, int $perPage): array
    {
        $inner = IngredientWeeklyPrice::withoutTenancy()
            ->join('weekly_price_publications', 'weekly_price_publications.id', '=', 'ingredient_weekly_prices.weekly_price_publication_id')
            ->where('ingredient_weekly_prices.organisation_id', $organisationId)
            ->selectRaw('DISTINCT ON (ingredient_weekly_prices.ingredient_id) ingredient_weekly_prices.id')
            ->orderBy('ingredient_weekly_prices.ingredient_id')
            ->orderByDesc('ingredient_weekly_prices.effective_from_date')
            ->orderByDesc('weekly_price_publications.published_at')
            ->orderByDesc('ingredient_weekly_prices.id');

        $standingIds = $inner->pluck('ingredient_weekly_prices.id')->all();

        if ($standingIds === []) {
            return ['rows' => [], 'has_more' => false];
        }

        return $this->paged(
            IngredientWeeklyPrice::withoutTenancy()
                ->whereIn('ingredient_weekly_prices.id', $standingIds)
                ->with(['ingredient:id,name_en', 'unit:id,code'])
                ->orderByDesc('ingredient_weekly_prices.effective_from_date')
                ->orderBy('ingredient_weekly_prices.ingredient_id')
                ->offset(($page - 1) * $perPage)
                ->limit($perPage + 1)
                ->get(),
            $perPage,
        );
    }

    /**
     * Every row one publication carried, in ingredient order.
     *
     * @return array{rows: list<IngredientWeeklyPrice>, has_more: bool}
     */
    public function forPublication(string $organisationId, string $publicationId, int $page, int $perPage): array
    {
        return $this->paged(
            IngredientWeeklyPrice::withoutTenancy()
                ->where('ingredient_weekly_prices.organisation_id', $organisationId)
                ->where('ingredient_weekly_prices.weekly_price_publication_id', $publicationId)
                ->with(['ingredient:id,name_en', 'unit:id,code'])
                ->orderBy('ingredient_weekly_prices.ingredient_id')
                ->offset(($page - 1) * $perPage)
                ->limit($perPage + 1)
                ->get(),
            $perPage,
        );
    }

    /**
     * Publications newest first — the run history a manager checks after an outage.
     *
     * @return array{rows: list<WeeklyPricePublication>, has_more: bool}
     */
    public function publications(string $organisationId, int $page, int $perPage): array
    {
        return $this->paged(
            WeeklyPricePublication::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->orderByDesc('purchase_week_start_date')
                ->orderByDesc('published_at')
                ->offset(($page - 1) * $perPage)
                ->limit($perPage + 1)
                ->get(),
            $perPage,
        );
    }

    /**
     * One page, plus the extra row the caller fetched so `has_more` is a fact
     * rather than a guess from a short page.
     *
     * The query runs at the call site, where its concrete model type is known,
     * and only the slicing is shared: a generic that took the builder lost the
     * element type through `get()` and the promise in this signature stopped
     * being checkable.
     *
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  EloquentCollection<int, TModel>  $fetched  `perPage + 1` rows
     * @return array{rows: list<TModel>, has_more: bool}
     */
    private function paged(EloquentCollection $fetched, int $perPage): array
    {
        return [
            'rows' => array_values($fetched->take($perPage)->all()),
            'has_more' => $fetched->count() > $perPage,
        ];
    }
}
