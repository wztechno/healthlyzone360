<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/me/orders/{order} — one of the caller's own orders.
 *
 * Somebody else's order is **`resource.not_found`**, never 403. An order
 * identifier is not a secret worth defending on its own, but confirming that
 * one exists while refusing to show it tells a stranger that a given order is
 * real — and this is the resource a delivery address is snapshotted onto.
 *
 * **No `ETag`.** An order carries `lock_version` and this audience cannot write
 * it: confirm, fulfil and cancel are the kitchen's actions, behind the kitchen's
 * permission. Serving a validator to a reader with no writer would invite a
 * client to send `If-Match` at an endpoint that does not exist for it. The
 * kitchen's read of the same row does carry one.
 */
final class MyOrderShowController
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
        $account = $this->locator->shopper();
        $record = $this->locator->customerOrder($account, $order);

        $lines = $record->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->customer($record, $lines)]);
    }
}
