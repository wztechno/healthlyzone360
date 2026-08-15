<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Controllers;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Http\Concerns\ReadsPrecondition;
use Healthy360\Orders\Http\Requests\StorePaymentReceiptRequest;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Orders\Presenters\OrderPresenter;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/catalogue/orders/{order}/payments — money arrived, and this is
 * who says so.
 *
 * A sub-resource of an order, beside `confirm`, `fulfil` and `cancel` rather
 * than under `/order-desk`, and that placement is the design. A receipt is not a
 * desk artefact: a driver's cash comes back against an order the desk never
 * touched, and a WISH reconciliation will one day write here with no desk in the
 * room at all. The desk is the surface that *usually* records one; the order is
 * what a receipt is always about.
 *
 * **`method` is deliberately not constrained to the order's own
 * `payment_method`.** An order taken for cash at the counter and settled by a
 * WISH transfer is an ordinary evening, and so is a delivery meant for cash at
 * the door that the customer transferred instead while the driver waited.
 * `orders.payment_method` is the **intent** captured at placement and this is
 * how the money **arrived**; the schema states the same thing from the other
 * side, restating the vocabulary on both tables rather than making one a foreign
 * key on the other. Recording the divergence is the point of having two columns.
 * Rejecting it would push the desk into either lying in the request or editing
 * the order, and the second is a rewrite of what the customer agreed to.
 *
 * **Over-payment is permitted, and it is not an error.** A customer hands over a
 * round note and takes change from the till; the change is not a row here,
 * because this table records money arriving and nothing else. Part payment is
 * equally real — a deposit now and a balance on delivery are two rows — so the
 * receipted predicate is an inequality in both directions and no amount is
 * checked against the order's total.
 *
 * ## What refuses, and with which answer
 *
 * **A cancelled order refuses**, `409 resource.conflict`, with
 * `details.status`, `details.allowed_statuses` and
 * `details.current_lock_version`. Nobody records money arriving for an order
 * that no longer exists commercially: the kitchen is not cooking it, the
 * customer is not paying for it, and a receipt against it would put a figure
 * into the day's takings that reconciles against nothing. If a cancelled order
 * really was paid for, what happened is a refund, and refunds are the payments
 * module's act in the payments module's table.
 *
 * The shape is the house answer for an illegal-state write, borrowed from the
 * two places that already give it — `ApplicationService` and `QuotationService`
 * answer a move their state machine forbids with the state it is actually in,
 * what would have been allowed, and the current validator — and it is the same
 * **code** `TransitionRejected` uses, for the same stated reason: the request is
 * well formed and reasonable, and the state underneath it moved. A dedicated
 * `ErrorCode` was not worth minting for it; a client's branch here is "reload
 * the order and stop offering the payment button", which is exactly what it does
 * for every other 409 on this resource.
 *
 * Fulfilled orders do **not** refuse. Cash on delivery arrives when the food
 * does, and the driver's takings are keyed in afterwards; an endpoint that shut
 * at fulfilment would have no way to record the most common payment on the
 * platform.
 *
 * **`If-Match` is required**, and it guards something subtler than the lifecycle
 * routes do. Nothing about the order row is written here — the receipt is a new
 * row in another table — so the validator is not protecting against a lost
 * update to `orders`. It protects against **acting on a stale view**: the desk
 * screen that offers "take payment" was rendered before somebody cancelled the
 * order, and without the header that button would still work. For the same
 * reason `orders.lock_version` is **not** bumped: an order whose validator moved
 * every time a colleague keyed in cash would invalidate every screen holding it,
 * and nothing they were looking at would have changed.
 *
 * The state is checked before the validator, matching `OrderLifecycle`, which
 * asks the state machine first and folds the version into its `UPDATE`. Both are
 * `409`; the order between them decides only which sentence a client reads
 * first, and "this order is cancelled" is the more actionable of the two.
 *
 * ## The read, the write, and the lock between them
 *
 * The order is re-read `FOR UPDATE` inside the transaction that inserts the
 * receipt. `ReadsPrecondition` is explicit that the platform decides staleness
 * "inside the same statement as the write" so that no window exists between the
 * check and the write, and this endpoint has no `UPDATE` to fold the check into.
 * The row lock is the honest equivalent: a cancellation racing this request
 * either lands first — and is seen, because this read is inside the lock — or
 * waits behind it. Without it, a desk could record cash against an order that
 * was cancelled between the read and the insert, and the receipt would outlive
 * the check that was supposed to refuse it.
 *
 * ## Audited here, because nothing else would
 *
 * `confirm`, `fulfil` and `cancel` are audited by `OrderLifecycle` — the only
 * thing that moves an order's state — and this write moves nothing, so it goes
 * through no service that audits. It writes its own `order.payment_recorded`
 * event, through `AuditRecorder`, exactly as the other non-lifecycle writes on
 * the platform do (`ConsumptionExceptionResolveController` is the closest
 * sibling: a controller-level write, audited from the controller, subject named
 * explicitly). The subject is the **order**, not the receipt, so that an order's
 * whole trail — placed, confirmed, paid, fulfilled — is one query rather than
 * two joined on a metadata field.
 *
 * Metadata carries no key containing `code`: `AuditRecorder` redacts those by
 * substring, and a redacted payment method is an audit row that cannot say how
 * the money arrived. `currency` rather than `currency_code`, for that reason
 * alone.
 *
 * **`Idempotency-Key` is honoured** by the `idempotency` middleware, which
 * replays the original envelope — the same receipt, the same `201` — rather
 * than writing a second row. It matters more here than on most commands: a desk
 * tablet on a bad connection retrying a payment would otherwise put the same
 * money in the ledger twice, and no constraint on the table would notice,
 * because two genuine receipts for the same amount against one order is exactly
 * what a deposit and a balance look like.
 */
final class OrderPaymentReceiptStoreController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly OrderPresenter $presenter,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StorePaymentReceiptRequest $request, string $order): JsonResponse
    {
        $payload = $request->payload();

        $record = $this->locator->sellerOrder($order);
        $expected = $this->requiredLockVersion($request);
        $confirmedBy = $this->confirmedBy($request);

        $receipt = DB::transaction(function () use ($record, $payload, $expected, $confirmedBy): OrderPaymentReceipt {
            $locked = Order::query()->whereKey($record->getKey())->lockForUpdate()->first();

            // Unreachable behind the locator, which has just resolved the same
            // row inside this kitchen's book. Present so that a row deleted
            // between the two reads fails closed rather than writing a receipt
            // against nothing.
            if (! $locked instanceof Order) {
                throw new ApiException(ErrorCode::ResourceNotFound);
            }

            $this->refuseCancelled($locked);
            $this->refuseStale($locked, $expected);

            $receipt = new OrderPaymentReceipt;
            $receipt->organisation_id = $locked->organisation_id;
            $receipt->order_id = (string) $locked->getKey();
            $receipt->method = PaymentMethod::from($payload['method']);
            $receipt->amount_minor = $payload['amount_minor'];
            // The order's currency, never the request's: a receipt in another
            // currency is not a receipt for this order.
            $receipt->currency_code = $locked->currency_code;
            $receipt->reference = $payload['reference'];
            $receipt->confirmed_by = (string) $confirmedBy->getKey();
            // Stamped by the server rather than taken from the body. A desk
            // that could name the moment could also name a moment in another
            // shift, and `confirmed_at` is what a day's takings are cut on.
            $receipt->confirmed_at = CarbonImmutable::now();
            $receipt->notes = $payload['notes'];
            $receipt->save();

            return $receipt;
        });

        $this->audit->record(
            'order.payment_recorded',
            actorUserId: (string) $confirmedBy->getKey(),
            subjectType: 'order',
            subjectId: (string) $record->getKey(),
            metadata: [
                'receipt_id' => (string) $receipt->getKey(),
                'method' => $receipt->method->value,
                'amount_minor' => $receipt->amount_minor,
                'currency' => $receipt->currency_code,
            ],
        );

        return ApiResponse::data([
            'receipt' => $this->presenter->paymentReceipt($receipt),
            'payment' => $this->presenter->paymentSummary($record, $this->receivedMinor($record)),
        ], status: 201);
    }

    /**
     * @throws ApiException
     */
    private function refuseCancelled(Order $order): void
    {
        if ($order->status !== OrderStatus::Cancelled) {
            return;
        }

        // Built by walking the enum rather than by listing three strings, so
        // that a fifth status would have to be excluded here on purpose to be
        // left out of the answer.
        $allowed = [];

        foreach (OrderStatus::cases() as $status) {
            if ($status !== OrderStatus::Cancelled) {
                $allowed[] = $status->value;
            }
        }

        throw new ApiException(
            ErrorCode::ResourceConflict,
            'An order that is cancelled cannot be receipted.',
            [
                'status' => $order->status->value,
                'allowed_statuses' => $allowed,
                'current_lock_version' => $order->lock_version,
            ],
        );
    }

    /**
     * @throws ApiException
     */
    private function refuseStale(Order $order, int $expected): void
    {
        if ($order->lock_version === $expected) {
            return;
        }

        throw new ApiException(
            ErrorCode::ResourceConflict,
            'This order changed while you were working on it. Reload it and try again.',
            ['current_lock_version' => $order->lock_version],
        );
    }

    /**
     * What this order has been paid so far, receipts included.
     *
     * Read after the insert and inside no transaction of its own: the row is
     * committed by now, and the figure a client is owed is the one that includes
     * what it has just recorded.
     */
    private function receivedMinor(Order $order): int
    {
        return (int) OrderPaymentReceipt::query()
            ->where('order_id', $order->getKey())
            ->sum('amount_minor');
    }

    /**
     * The person who says the money arrived.
     *
     * Narrowed from the guard's `Authenticatable` to this platform's identity,
     * because `confirmed_by` is a foreign key and the assertion is the whole
     * control on a WISH receipt. The failure branch is unreachable behind
     * `auth:sanctum` and `permission:` — it exists so that a routing mistake
     * fails closed rather than as a type error.
     *
     * @throws ApiException
     */
    private function confirmedBy(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $user;
    }
}
