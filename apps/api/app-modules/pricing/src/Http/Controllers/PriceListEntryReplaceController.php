<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Pricing\Http\Concerns\ReadsPrecondition;
use Healthy360\Pricing\Http\Requests\ReplacePriceListEntriesRequest;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Presenters\PriceListAdminPresenter;
use Healthy360\Pricing\Services\PriceEntryService;
use Healthy360\Pricing\Services\PriceListLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/price-lists/{priceList}/entries.
 *
 * The body is the desired **current** pricing state — the whole tariff, as it
 * should stand after the call. The server works out what changed and writes
 * the history: unchanged points are left entirely alone, changed ones close
 * and reopen, absent ones close. A client never sends a date and never sends a
 * supersession pointer, because both are the server's account of when it was
 * told, and a client that could write them could backdate a price change to
 * before an order was taken.
 *
 * `If-Match` carries the **price list's** lock version, not a row's. The rows
 * are one document: two merchandisers repricing the same tariff at once is the
 * race this catches, and versioning each row separately would let both writes
 * succeed and leave a tariff that is half of each.
 *
 * The response is the standing state after the write, so a client that just
 * submitted a tariff does not have to fetch it back to render it.
 */
final class PriceListEntryReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly PriceListLocator $locator,
        private readonly PriceEntryService $entries,
        private readonly PriceListAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplacePriceListEntriesRequest $request, string $priceList): JsonResponse
    {
        $record = $this->locator->priceList($priceList);
        $updated = $this->entries->replace($record, $request->entries(), $this->requiredLockVersion($request));

        $rows = PriceListItem::query()
            ->where('price_list_id', $updated->getKey())
            ->openRows()
            ->orderBy('catalogue_item_id')
            ->orderBy('min_quantity')
            ->get();

        return ApiResponse::data([
            'price_list' => $this->presenter->priceList($updated),
            'entries' => $rows->map(fn (PriceListItem $entry): array => $this->presenter->entry($entry, $updated->currency_code))->all(),
        ], ['currency_code' => $updated->currency_code])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
