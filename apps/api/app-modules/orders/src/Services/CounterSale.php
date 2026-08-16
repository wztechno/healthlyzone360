<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;

/**
 * A walk-in sale: placed, confirmed, paid and handed over, in one transaction.
 *
 * Every other order on this platform is four separate acts spread over an hour
 * or a day — a customer places, a kitchen confirms, a driver delivers, somebody
 * keys in the cash. A counter sale is **one act**. The customer is standing
 * there, the food is in front of them, and by the time they have walked away all
 * four have happened. Modelling it as four requests would produce an order book
 * full of counter sales stuck at `placed` because somebody's tablet lost signal
 * between step two and step three, and a till whose takings could not be
 * reconciled against the orders that produced them.
 *
 * So it is one method, one transaction, and four steps that either all happened
 * or none did.
 *
 * ## Every step goes *through* `OrderLifecycle`, never around it
 *
 * The tempting shortcut is an `UPDATE orders SET status = 'fulfilled'` — it is
 * one statement instead of two transitions and it would produce a row that looks
 * identical. It would not be identical. `OrderLifecycle` is what stamps
 * `confirmed_at` and `fulfilled_at` as separate moments, what bumps
 * `lock_version` so a screen holding the order learns it moved, what asks
 * `OrderStatus::canTransitionTo()` so no caller can invent a fifth edge, what
 * records `order.confirmed` and `order.fulfilled`, and — the one that would have
 * been noticed last — what runs `OrderStockConsumption::consume()` inside the
 * confirm. A counter sale that skipped the lifecycle would sell lunch and take
 * nothing off the shelf.
 *
 * ## The nesting, and why it is safe
 *
 * This method's `DB::transaction` is the outer one; every transaction opened
 * beneath it becomes a **savepoint** rather than a second transaction —
 * `OrderLifecycle::transition()`, `OrderPlacementService::persist()`,
 * `InventoryService::recordMovement()` and `OrderConsumptionService::
 * persistException()` all behave that way, and `OrderIdempotency::claim()`
 * already depends on it (a lost claim race must not poison the surrounding
 * work). Nothing in the chain defers anything past commit: `AuditRecorder`
 * writes synchronously, and there is no `afterCommit`, no dispatched event and
 * no queued job anywhere between here and the shelf. So there is nothing that
 * could fire against a sale that later rolls back.
 *
 * **The audit rows move, and that is a correction rather than a cost.**
 * `OrderLifecycle` deliberately records its event *after* its own transaction
 * commits; nested here, "after the inner transaction" is still inside this one,
 * so `order.placed`, `order.confirmed`, `order.payment_recorded` and
 * `order.fulfilled` all commit or roll back with the sale. That is the more
 * honest arrangement, not the less: an `order.confirmed` row for a sale that
 * never existed would be a defect in the trail, and the trail is what a shift's
 * takings are reconstructed from.
 *
 * ## Insufficient stock does **not** roll the sale back
 *
 * It is worth saying explicitly, because the atomicity above makes the opposite
 * sound likely. `OrderConsumptionService::deduct()` catches a shortfall and
 * records an `insufficient_stock` exception row instead of throwing — by design,
 * argued at length there: the food has already been cooked and handed over, and
 * refusing the sale would not put the ingredients back. The sale **completes**,
 * fulfilled, with a row on the exception ledger for somebody to reconcile. The
 * same is true of every other consumption reason — an un-recipe'd article, a
 * missing unit conversion — which is why a counter sale can be made at a kitchen
 * that has not finished setting up its inventory at all.
 *
 * ## The lock versions are stated, not omitted
 *
 * `confirm()` and `fulfil()` both take a nullable `$expectedLockVersion` and
 * both are handed one anyway. Nothing here is holding a stale view — the order
 * was created a millisecond ago inside this very transaction — so the check can
 * only fail if something impossible happened: another writer reached inside an
 * uncommitted transaction, or the version this code believes it just wrote is
 * not the version it wrote. Passing `null` would let either of those produce a
 * quietly wrong sale; passing the version turns it into a `409` and a rolled
 * back transaction. A stale hand at a counter is a bug worth crashing on.
 *
 * ## A replay answers, it does not redo
 *
 * `placeComposed()` is given the caller's idempotency key and reports through
 * `PlacementResult::$replayed` whether it placed an order or recognised one. On
 * a replay this method returns that order **untouched**, and the reason is that
 * the tail would otherwise run against an order that is already fulfilled:
 * `confirm()` would meet `OrderStatus::Fulfilled` and throw `TransitionRejected`,
 * so a double-tapped sale would answer the second tap with a 409 about an
 * illegal transition — the least useful sentence available for "you already sold
 * this".
 *
 * **`$replayed` is the discriminator, not the status.** Both work today, because
 * a freshly placed order is always `placed` and a replayed counter sale is
 * always `fulfilled`; `$replayed` is preferable because it is the placement
 * service *stating* which of the two happened rather than this class inferring
 * it from a column, and because it stays correct on the day a counter sale can
 * be cancelled after the fact — a replay would then return a `cancelled` order,
 * which a status test would have to grow a second case for and this does not.
 *
 * The first transaction is what completed the sale. The replay's job is to say
 * what it produced, not to produce it again.
 *
 * ## What this class does not do
 *
 * It resolves nothing and refuses nothing on its own account. The customer, the
 * branch, the channel and the currency are resolved by the caller and arrive on
 * the draft; the placement's own gates produce `PlacementRefused` with every
 * reason at once, exactly as they do for a delivery.
 *
 * It also composes **no slot**. `deliveryWindowCode` and `requestedDate` are not
 * on the draft and are not passed: a counter sale is handed over in the room, so
 * there is no promised moment for it to be late for — which is the same reason
 * `composeNow()` skips the cut-off gate for this fulfilment type. A pickup is
 * where a desk order carries a window, and a pickup does not come through here.
 *
 * It sets no tenant
 * context: `placeComposed()` transacts in the seller's through `SellerContext`,
 * and the confirm's stock deduction reads the ambient one — the same arrangement
 * `POST /catalogue/orders/{order}/confirm` has always run under, and the reason
 * this is called from behind `org.context`.
 */
final readonly class CounterSale
{
    public function __construct(
        private OrderPlacementService $placement,
        private OrderLifecycle $lifecycle,
        private OrderPaymentReceipts $receipts,
    ) {}

    /**
     * Sell it, cook it, take the money, hand it over.
     *
     * Returns the fulfilled order — or, on an idempotent replay, the order the
     * first attempt produced. The two are deliberately indistinguishable to the
     * caller: a replayed counter sale and a fresh one are the same answer, and
     * over HTTP the `idempotency` middleware has already answered the replay
     * from its stored envelope before this method is reached at all.
     *
     * @throws PlacementRefused|ApiException
     */
    public function complete(CounterSaleDraft $draft): Order
    {
        return DB::transaction(function () use ($draft): Order {
            $result = $this->placement->placeComposed(
                new ComposedPlacement(
                    account: $draft->account,
                    // Forbidden on a counter sale by `orders_fulfilment_shape_
                    // check`, and there is no draft field that could supply one.
                    address: null,
                    organisationId: $draft->organisationId,
                    salesChannelId: $draft->salesChannelId,
                    branchId: $draft->branchId,
                    currencyCode: $draft->currencyCode,
                    lines: $draft->lines,
                    fulfilmentType: FulfilmentType::Counter,
                    placedOnBehalfBy: $draft->placedOnBehalfBy,
                    paymentMethod: $draft->paymentMethod,
                ),
                $draft->idempotencyKey,
            );

            if ($result->replayed) {
                return $result->order;
            }

            $order = $result->order;

            // Version 0, written by `persist()` a moment ago. The confirm is
            // also where the ingredients come off the shelf.
            $confirmed = $this->lifecycle->confirm($order, $order->lock_version);

            // Exactly the total, because that is what the till took. See
            // `CounterSaleDraft` for why there is no amount to disagree with it.
            $receipt = $this->receipts->write(
                $confirmed,
                $draft->paymentMethod,
                $confirmed->total_minor,
                $draft->placedOnBehalfBy,
                $draft->reference,
                $draft->notes,
            );

            $this->receipts->audit($receipt);

            // `transition()` refreshes the row inside its own transaction and
            // hands the same instance back, so this is the version the confirm
            // just wrote rather than one this method guessed.
            return $this->lifecycle->fulfil($confirmed, $confirmed->lock_version);
        });
    }
}
