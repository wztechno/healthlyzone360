<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Presenters\PriceListAdminPresenter;
use Healthy360\Pricing\Services\PriceListLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/price-lists/{priceList}.
 *
 * Returns `ETag: "<lock_version>"` — the client's half of the
 * optimistic-concurrency contract: read the resource, keep the validator, send
 * it back as `If-Match` when writing. Every write in this module, entries and
 * channel assignments included, is versioned against **this** number: the
 * list's rows are one document even though they live in three tables, and two
 * merchandisers repricing the same tariff at once is exactly the race the
 * validator exists to catch.
 *
 * The channel assignments come with it — the set is at most a handful of rows
 * and "which channels quote from this" is the question anybody opening a
 * tariff asks next. The **entries do not**: a tariff runs to hundreds of rows,
 * and they have their own cursor-paginated endpoint with its own history
 * switch.
 *
 * `meta.entry_counts` says how many standing rows there are and how many of
 * them are real prices, so a merchandiser can see "312 priced, 8 owed" without
 * paging through the list to count.
 */
final class PriceListShowController
{
    public function __construct(
        private readonly PriceListLocator $locator,
        private readonly PriceListAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $priceList): JsonResponse
    {
        $record = $this->locator->priceList($priceList);

        return ApiResponse::data([
            'price_list' => $this->presenter->priceList($record),
            'channels' => $this->channels($record),
        ], ['entry_counts' => $this->entryCounts($record)])
            ->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function channels(PriceList $priceList): array
    {
        return array_values(ChannelPriceList::query()
            ->where('price_list_id', $priceList->getKey())
            ->orderBy('priority')
            ->orderBy('sales_channel_id')
            ->get()
            ->map(fn (ChannelPriceList $row): array => $this->presenter->channelAssignment($row))
            ->all());
    }

    /**
     * @return array{open: int, confirmed: int}
     */
    private function entryCounts(PriceList $priceList): array
    {
        return [
            'open' => PriceListItem::query()->where('price_list_id', $priceList->getKey())->openRows()->count(),
            'confirmed' => PriceListItem::query()->where('price_list_id', $priceList->getKey())->confirmedOpenRows()->count(),
        ];
    }
}
