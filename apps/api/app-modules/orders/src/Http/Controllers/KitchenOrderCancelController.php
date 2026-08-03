<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Http\Concerns\ReadsPrecondition;
use Healthy360\Orders\Http\Requests\CancelOrderRequest;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/orders/{order}/cancel.
 *
 * **A POST action, never a DELETE.** A cancelled order is not a removed one:
 * it stays in the book, keeps its number, keeps its lines and keeps the price
 * they were sold at, because a kitchen reconciling a week needs to know what it
 * did not sell as much as what it did. DELETE would promise an erasure this
 * platform will not perform.
 *
 * **The reason is required**, which is the one thing worth arguing about here.
 * A nullable reason would be honoured by roughly every client that is in a
 * hurry, and one order cancelled "for no stated reason" is the row that makes
 * every count wrong — a kitchen cannot tell stock problems from changes of mind
 * from a column that is sometimes empty. A fixed vocabulary rather than free
 * text for the second reason: free text turns a count into a search problem,
 * and it is also how a customer's name ends up in a column nobody classified.
 *
 * Reachable from `placed` and `confirmed` and from nowhere else. A fulfilled
 * order is terminal — see `KitchenOrderFulfilController`.
 *
 * **`If-Match` required.** Cancelling something a colleague confirmed one
 * second ago is exactly the lost update the validator exists to catch, and it
 * is the transition where getting it wrong costs a customer their dinner.
 */
final class KitchenOrderCancelController
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
    public function __invoke(CancelOrderRequest $request, string $order): JsonResponse
    {
        $payload = $request->payload();

        $record = $this->locator->sellerOrder($order);

        $cancelled = $this->lifecycle->cancel(
            $record,
            CancellationReason::from($payload['reason']),
            $this->requiredLockVersion($request),
        );

        $lines = $cancelled->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->kitchen($cancelled, $lines)])
            ->withHeaders(['ETag' => '"'.$cancelled->lock_version.'"']);
    }
}
