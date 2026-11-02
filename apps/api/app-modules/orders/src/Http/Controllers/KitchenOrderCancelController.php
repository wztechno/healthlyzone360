<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use Healthy360\Orders\Enums\CancellationDisposition;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Http\Concerns\ReadsPrecondition;
use Healthy360\Orders\Http\Requests\CancelOrderRequest;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderDeliveryRuns;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

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
 *
 * **Once cooking has started the question changes.** The food exists, so somebody
 * has to say whether it came back to the shelf or went in the bin, and that
 * somebody holds `order.supervise_organisation`. The owner hears about it. Both
 * checks live here rather than in `OrderLifecycle`, so nothing that cancels
 * without a screen behind it is asked a question it cannot answer.
 *
 * **Food on the road cannot be cancelled by anybody.** `OrderLifecycle::cancel()`
 * refuses it with `order.out_for_delivery`, and it ends as delivered or failed.
 */
final class KitchenOrderCancelController
{
    use ReadsPrecondition;

    private const string SUPERVISE_PERMISSION = 'order.supervise_organisation';

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderLifecycle $lifecycle,
        private readonly OrderPresenter $presenter,
        private readonly OrderDeliveryRuns $runs,
        private readonly StaffAlerts $alerts,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(CancelOrderRequest $request, string $order): JsonResponse
    {
        $payload = $request->payload();

        $record = $this->locator->sellerOrder($order);

        $late = $this->isLate($record);

        $cancelled = $this->lifecycle->cancel(
            $record,
            CancellationReason::from($payload['reason']),
            $this->requiredLockVersion($request),
            $late ? $this->disposition($payload['disposition'] ?? null) : null,
        );

        if ($late) {
            $this->alerts->send(StaffAlertType::LateCancel, $cancelled->organisation_id, (string) $cancelled->getKey(), [
                'order_number' => $cancelled->order_number,
                'total_minor' => $cancelled->total_minor,
                'currency_code' => $cancelled->currency_code,
            ]);
        }

        $lines = $cancelled->lines()->orderBy('created_at')->orderBy('id')->get();

        return ApiResponse::data(['order' => $this->presenter->kitchen($cancelled, $lines, $this->runs->forOrder((string) $cancelled->getKey()))])
            ->withHeaders(['ETag' => '"'.$cancelled->lock_version.'"']);
    }

    /**
     * Cooking has started, so the food exists. Confirmed only: on any other
     * status the state machine's refusal is a better answer than a 403.
     */
    private function isLate(Order $order): bool
    {
        return $order->status === OrderStatus::Confirmed
            && ($order->preparing_at !== null || $order->ready_at !== null);
    }

    /**
     * @throws ApiException when the caller may not cancel a started order
     * @throws ValidationException when they did not say what became of the food
     */
    private function disposition(?string $answer): CancellationDisposition
    {
        if (! Gate::allows(self::SUPERVISE_PERMISSION)) {
            throw new ApiException(
                ErrorCode::AuthzPermissionDenied,
                'Cooking has started, so cancelling this order needs a manager.',
            );
        }

        if ($answer === null) {
            throw ValidationException::withMessages([
                'disposition' => 'Say whether the food was returned or wasted.',
            ]);
        }

        return CancellationDisposition::from($answer);
    }
}
