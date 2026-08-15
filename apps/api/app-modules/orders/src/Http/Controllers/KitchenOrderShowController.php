<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/orders/{order} — one order, as the kitchen sees it.
 *
 * Another kitchen's order is **`resource.not_found`**, the same answer as an
 * order that does not exist. There is no 403 here on purpose: this table has no
 * database policy behind it, so the only isolation is
 * `OrderQuery::forSeller()`, and a 403 would confirm to one kitchen that a
 * given identifier is another's live order.
 *
 * **Returns `ETag: "<lock_version>"`**, which the three lifecycle actions send
 * back as `If-Match`. That round trip is the whole optimistic-concurrency
 * contract for this resource, and it matters more here than almost anywhere
 * else on the platform: a kitchen screen showing an order list is stale the
 * moment it renders, and two staff members confirming the same order at once is
 * an ordinary Tuesday.
 *
 * The full delivery snapshot comes with it, street included. It is
 * `Confidential` and it is also where the food has to go; withholding it from
 * the kitchen would be privacy theatre performed on the one party that needs
 * the data to do the job.
 */
final class KitchenOrderShowController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $order): JsonResponse
    {
        $record = $this->locator->sellerOrder($order);
        $lines = $record->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->kitchen($record, $lines)])
            ->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
