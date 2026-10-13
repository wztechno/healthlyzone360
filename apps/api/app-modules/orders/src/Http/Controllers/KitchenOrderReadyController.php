<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Http\Concerns\ReadsPrecondition;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/orders/{order}/ready — the kitchen finished it.
 *
 * The order stays confirmed; handing it over is `/fulfil`. The fulfil
 * controller's shape exactly, so the board reads one answer for either press.
 */
final class KitchenOrderReadyController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderLifecycle $lifecycle,
        private readonly OrderPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $order): JsonResponse
    {
        $record = $this->locator->sellerOrder($order);
        $ready = $this->lifecycle->markReady($record, $this->requiredLockVersion($request));

        $lines = $ready->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->kitchen($ready, $lines)])
            ->withHeaders(['ETag' => '"'.$ready->lock_version.'"']);
    }
}
