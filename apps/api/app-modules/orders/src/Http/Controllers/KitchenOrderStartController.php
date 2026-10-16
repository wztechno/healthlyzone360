<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Http\Concerns\ReadsPrecondition;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderDeliveryRuns;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/orders/{order}/start — the kitchen started cooking it (HA-24).
 *
 * Stamps `preparing_at`; a placed order is confirmed first (see
 * `OrderLifecycle::start()`). The ready controller's shape exactly, so the board
 * reads one answer for any press.
 */
final class KitchenOrderStartController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderLifecycle $lifecycle,
        private readonly OrderPresenter $presenter,
        private readonly OrderDeliveryRuns $runs,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $order): JsonResponse
    {
        $record = $this->locator->sellerOrder($order);
        $started = $this->lifecycle->start($record, $this->requiredLockVersion($request));

        $lines = $started->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->kitchen($started, $lines, $this->runs->forOrder((string) $started->getKey()))])
            ->withHeaders(['ETag' => '"'.$started->lock_version.'"']);
    }
}
