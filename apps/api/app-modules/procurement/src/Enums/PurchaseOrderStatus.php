<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Enums;

/**
 * Where a purchase order has got to (§3.5).
 *
 * `draft → issued → partially_received → received`, with `cancelled` reachable
 * from the two states in which nothing has arrived yet.
 *
 * **`issued`, never `sent`** — §2's third correction, and it is about honesty
 * rather than vocabulary. Phase 1 has no dispatch channel: nobody emails,
 * messages or faxes this order anywhere. What actually happens is that a person
 * presses Issue, the lines freeze, and they print the sheet and hand it over.
 * Calling that `sent` would claim an event the system did not perform, and a
 * later dispatch phase would then have nowhere honest to put the real one.
 *
 * ## The six edges, and who drives them
 *
 * A person presses two of them. `draft → issued` and the two cancellations are
 * deliberate acts with their own endpoints and audit events.
 *
 * **Nobody presses the other three.** `issued → partially_received`,
 * `issued → received` and `partially_received → received` are all driven by a
 * goods receipt being posted (§3.5): the quantities received are summed per
 * order line, and the status is whatever that sum says it is. There is no
 * "mark as received" button and there must not be one — it would let an order
 * claim a delivery that never turned up. The one apparent exception proves the
 * rule: closing a short delivery still goes through a receipt, and what the flag
 * adds is a reason for writing off the remainder, not a status change on its own.
 *
 * **`cancelled` is deliberately absent from `PartiallyReceived`.** §3.5 is
 * explicit that an order with receipts cannot be cancelled as though nothing
 * happened. The enum expresses the ordinary case; `PurchaseOrderService::cancel`
 * adds the guard for the edge where a receipt exists but the status has not
 * caught up, refusing with `purchase_order_received_against`.
 *
 * `received` and `cancelled` are terminal and stay terminal. A delivery that
 * turned out wrong is a receipt correction or a return, which are different
 * objects with different quantities attached; making either a transition would
 * let a kitchen erase a delivery by changing a column.
 *
 * The transition rule lives on the enum rather than in the service so that a
 * second caller cannot invent a seventh edge, and the database CHECK is its
 * echo rather than its source.
 */
enum PurchaseOrderStatus: string
{
    case Draft = 'draft';

    case Issued = 'issued';

    case PartiallyReceived = 'partially_received';

    case Received = 'received';

    case Cancelled = 'cancelled';

    /**
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Draft => [self::Issued, self::Cancelled],
            // The two receiving edges are driven by a posted goods receipt, never
            // by a user action: an incomplete delivery lands on
            // `partially_received`, one that fulfils every line lands straight on
            // `received`.
            self::Issued => [self::PartiallyReceived, self::Received, self::Cancelled],
            // Cancellation is deliberately absent and stays absent: something has
            // already been delivered against this (§3.5). `received` is reached
            // either by the last outstanding line arriving or by a short delivery
            // being closed with a reason.
            self::PartiallyReceived => [self::Received],
            self::Received, self::Cancelled => [],
        };
    }

    public function canTransitionTo(self $next): bool
    {
        return in_array($next, $this->allowedTransitions(), true);
    }

    /**
     * Whether the notes and lines may still be rewritten.
     *
     * Draft alone. Issuing freezes the document because the supplier is holding
     * a copy of it, and §3.5 makes that immutability the point of the state
     * rather than a side effect.
     */
    public function linesAreEditable(): bool
    {
        return $this === self::Draft;
    }

    /** Whether this order has stopped moving. */
    public function isTerminal(): bool
    {
        return $this->allowedTransitions() === [];
    }
}
