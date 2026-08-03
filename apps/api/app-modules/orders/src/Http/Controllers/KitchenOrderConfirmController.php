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
 * POST /api/v1/catalogue/orders/{order}/confirm — the kitchen accepts the
 * order.
 *
 * Its own route and its own audit action, never a `PATCH status` (master plan
 * v2 §4.15). The three lifecycle actions are three decisions with three
 * different consequences and three separate timestamps; a status field would
 * make them one write that a client could aim anywhere, and `placed →
 * fulfilled` would become expressible by typing.
 *
 * **`If-Match` required.** The validator is checked inside the same conditional
 * `UPDATE` that performs the transition, so there is no window between reading
 * the version and writing the row. The state machine refuses an illegal move
 * anyway — this guards against a *lost update*, not against an impossible one:
 * two staff confirming the same order at once is an ordinary Tuesday, and
 * without the header the second one silently overwrites the first's moment.
 *
 * A header that is present but is not a Healthy360 validator is **400**, not
 * 409: the client has not lost a race, it has sent nonsense. A stale one is
 * `resource.conflict`, and the honest instruction is "reload and look again",
 * because the order may have been cancelled rather than merely confirmed by
 * somebody else.
 *
 * `order.manage_organisation` rather than the read code: seeing the book and
 * committing the kitchen to cook are different authorities.
 */
final class KitchenOrderConfirmController
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
        $confirmed = $this->lifecycle->confirm($record, $this->requiredLockVersion($request));

        $lines = $confirmed->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->kitchen($confirmed, $lines)])
            ->withHeaders(['ETag' => '"'.$confirmed->lock_version.'"']);
    }
}
