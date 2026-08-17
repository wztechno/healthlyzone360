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
 * ## What this slice permits, and what it does not
 *
 * Slice 4 owns exactly three edges: `draft → issued`, `draft → cancelled` and
 * `issued → cancelled`. The two receiving statuses exist in this enum and in the
 * database CHECK from the same migration, but **nothing can reach them yet** —
 * they are driven by goods receipts, which is slice 5's subject. Encoding them
 * as not-yet-allowed rather than leaving them out is what makes this file the
 * one place slice 5 edits: the constraint, the presenter, the wire contract and
 * the client's capability tables are all already five-valued.
 *
 * When slice 5 lands, `Issued` gains `PartiallyReceived` and `Received`, and
 * `PartiallyReceived` gains `Received` — every one of them driven by a receipt
 * being posted rather than by a button. `Cancelled` is **not** among them:
 * §3.5 is explicit that an order with receipts cannot be cancelled as though
 * nothing happened, so cancellation stays reachable only from the two states in
 * which nothing has been delivered.
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
            // Slice 5 adds self::PartiallyReceived and self::Received here, both
            // driven by a posted goods receipt rather than by a user action.
            self::Issued => [self::Cancelled],
            // Slice 5 adds self::Received here (and the close-short path that
            // reaches it with a reason). Cancellation is deliberately absent and
            // stays absent: something has already been delivered against this.
            self::PartiallyReceived => [],
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
