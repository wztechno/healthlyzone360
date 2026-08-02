<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Presenters\PriceListAdminPresenter;
use Healthy360\Pricing\Services\PriceListLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/price-lists/{priceList}/entries.
 *
 * **Standing rows by default** — what the tariff says today, which is what a
 * merchandiser opening it wants and what a PUT is going to be diffed against.
 * A default that returned history would make the obvious client — read, edit,
 * put back — silently resurrect closed prices.
 *
 * `include_history=1` adds the closed rows, and the ordering flips with it.
 * The current view walks oldest-first, the keyset default; history walks
 * **newest-first**, because a history is read from the most recent change
 * backwards and paging to the end to find last week's price is not a reading
 * anybody does. `CursorPage::constrain(..., newestFirst: true)` reverses both
 * halves of the keyset together, so the walk stays coherent.
 *
 * Amounts are integers of minor units with `currency_code` beside every row,
 * never formatted (see the presenter). Placeholder and market-priced rows are
 * served in full, with their status and a null amount: this is the admin
 * surface, and the person whose job is to price the unpriced rows has to be
 * able to see which ones they are.
 */
final class PriceListEntryIndexController
{
    public function __construct(
        private readonly PriceListLocator $locator,
        private readonly PriceListAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $priceList): JsonResponse
    {
        $record = $this->locator->priceList($priceList);
        $withHistory = $this->wantsHistory($request);

        $query = PriceListItem::query()->where('price_list_id', $record->getKey());

        if (! $withHistory) {
            $query->openRows();
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request), newestFirst: $withHistory);

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (PriceListItem $entry): array => $this->presenter->entry($entry, $record->currency_code))->all(),
            $page['meta'] + [
                'include_history' => $withHistory,
                'currency_code' => $record->currency_code,
                'entry_counts' => $this->entryCounts($record),
            ],
        );
    }

    /**
     * A truthy `include_history` and nothing else. Deliberately not
     * `filled()`: `include_history=0` has to mean "no", not "you mentioned it".
     */
    private function wantsHistory(Request $request): bool
    {
        $raw = $request->query('include_history');

        return is_string($raw) && in_array(mb_strtolower($raw), ['1', 'true', 'yes'], true);
    }

    /**
     * @return array{open: int, confirmed: int}
     */
    private function entryCounts(PriceList $priceList): array
    {
        $scoped = fn (): Builder => PriceListItem::query()->where('price_list_id', $priceList->getKey());

        return [
            'open' => $scoped()->openRows()->count(),
            'confirmed' => $scoped()->confirmedOpenRows()->count(),
        ];
    }
}
