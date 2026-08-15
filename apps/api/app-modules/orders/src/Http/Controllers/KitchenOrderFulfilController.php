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
 * POST /api/v1/catalogue/orders/{order}/fulfil — the food was delivered.
 *
 * **Spelled `fulfil`**, and the path spells it that way too. The platform is
 * written in British English throughout — `fulfilled_at`, `OrderStatus::
 * Fulfilled`, `OrderLifecycle::fulfil()` — and a URL that disagreed with the
 * column, the enum and the method it drives would be one spelling nobody could
 * predict from the other three. The double-l past participle is British as well,
 * so `fulfilled_at` beside `fulfil` is not an inconsistency.
 *
 * **The terminal state, and it is one-way.** A fulfilled order cannot be
 * cancelled: the food has been delivered, and whatever happens next is a refund
 * or a complaint — different objects with different money attached. Making that
 * a transition would let a kitchen erase a delivery by changing a column. The
 * rule lives on `OrderStatus`, so nothing here can invent an edge around it.
 *
 * **`If-Match` required**, for `KitchenOrderConfirmController`'s reason. It
 * matters slightly more here: the row this writes is the last word on whether a
 * customer received their food, and a lost update against it is a delivery that
 * the book says happened twice or not at all.
 */
final class KitchenOrderFulfilController
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
        $fulfilled = $this->lifecycle->fulfil($record, $this->requiredLockVersion($request));

        $lines = $fulfilled->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->kitchen($fulfilled, $lines)])
            ->withHeaders(['ETag' => '"'.$fulfilled->lock_version.'"']);
    }
}
