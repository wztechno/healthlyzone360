<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Pricing\Http\Concerns\ReadsPrecondition;
use Healthy360\Pricing\Http\Requests\ReplacePriceListChannelsRequest;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Presenters\PriceListAdminPresenter;
use Healthy360\Pricing\Services\ChannelPriceListService;
use Healthy360\Pricing\Services\PriceListLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/price-lists/{priceList}/channels.
 *
 * The complete set of channels that quote from this list, lock-versioned,
 * applied at once. The array order is the priority — index 0 is consulted
 * first — so listing a negotiated sheet above a standing tariff states the
 * override rather than requiring somebody to invent integers for it.
 *
 * An empty array detaches the list from every channel, which is how a tariff
 * is withdrawn and the step `archive` insists on first.
 */
final class PriceListChannelReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly PriceListLocator $locator,
        private readonly ChannelPriceListService $channels,
        private readonly PriceListAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplacePriceListChannelsRequest $request, string $priceList): JsonResponse
    {
        $record = $this->locator->priceList($priceList);
        $updated = $this->channels->replace($record, $request->assignments(), $this->requiredLockVersion($request));

        $rows = ChannelPriceList::query()
            ->where('price_list_id', $updated->getKey())
            ->orderBy('priority')
            ->orderBy('sales_channel_id')
            ->get();

        return ApiResponse::data([
            'price_list' => $this->presenter->priceList($updated),
            'channels' => $rows->map(fn (ChannelPriceList $row): array => $this->presenter->channelAssignment($row))->all(),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
