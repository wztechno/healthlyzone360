<?php

declare(strict_types=1);

namespace Healthy360\Production\Enums;

/**
 * Where a batch has got to (PROD1).
 *
 * **Six states, one forward path and two different exits.**
 * `draft → confirmed → in_production → completed`, with `cancelled` reachable
 * while nothing has been taken off a shelf and `abandoned` reachable once
 * something has.
 *
 * ## Why cancelled and abandoned are two words
 *
 * They are the same button to a manager and opposite facts to anybody reading
 * the ledger afterwards. **`cancelled` never carries stock movements and
 * `abandoned` always may** — that is the whole distinction, and it is what lets
 * a reader trust the status without opening the movement ledger to check.
 *
 * A batch that was confirmed and then called off released its claims and took
 * nothing: `cancelled`. A batch that was started, ate four kilos of flour and
 * then went wrong did not un-happen, and recording it as cancelled would leave
 * four kilos missing from a shelf with nothing on the order to explain it:
 * `abandoned`, which runs the same completion transaction so the consumption,
 * any recoverable output and the loss are all written down.
 *
 * `in_production → cancelled` is therefore permitted **only** when the request
 * explicitly declares that nothing was used and nothing was produced, and the
 * service verifies that against the ledger before believing it.
 *
 * ## What the states used to be
 *
 * The table shipped with `planned | in_progress | completed | cancelled`.
 * `planned` becomes `draft` and `in_progress` becomes `in_production`: the old
 * words described a schedule, and these describe a commitment. Nothing was
 * reserved under `planned`, which is exactly what `draft` now says out loud.
 *
 * The transition rule lives on the enum rather than in the service, so a second
 * caller cannot invent a seventh edge.
 */
enum ProductionOrderStatus: string
{
    /** Being written. Nothing is claimed and nothing is owed. */
    case Draft = 'draft';

    /** The kitchen has committed: inputs are reserved, nothing has moved. */
    case Confirmed = 'confirmed';

    /** Somebody is cooking. Stock may move from here on. */
    case InProduction = 'in_production';

    /** Finished. Inputs consumed, output on the shelf, claims closed. */
    case Completed = 'completed';

    /** Called off with nothing taken. Never carries a stock movement. */
    case Cancelled = 'cancelled';

    /** Gone wrong after something was taken. Carries whatever actually moved. */
    case Abandoned = 'abandoned';

    public function canTransitionTo(self $next): bool
    {
        return in_array($next, $this->allowedTransitions(), true);
    }

    /**
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Draft => [self::Confirmed, self::Cancelled],
            self::Confirmed => [self::InProduction, self::Cancelled],
            // `Cancelled` is on this list because a batch may be called off
            // before anything was taken; the service still proves that against
            // the ledger rather than taking the request's word for it.
            self::InProduction => [self::Completed, self::Abandoned, self::Cancelled],
            self::Completed, self::Cancelled, self::Abandoned => [],
        };
    }

    /** Whether the batch is still moving — what the desk queue asks. */
    public function isOpen(): bool
    {
        return ! $this->isTerminal();
    }

    public function isTerminal(): bool
    {
        return $this->allowedTransitions() === [];
    }

    /** Whether a claim on stock should exist in this state. */
    public function holdsReservations(): bool
    {
        return $this === self::Confirmed || $this === self::InProduction;
    }

    /**
     * Whether stock may legitimately have moved against a batch in this state.
     *
     * The inverse of the cancelled/abandoned distinction, stated once so a
     * report and a guard cannot disagree about it.
     */
    public function mayCarryMovements(): bool
    {
        return $this === self::InProduction || $this === self::Completed || $this === self::Abandoned;
    }

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(static fn (self $case): string => $case->value, self::cases());
    }
}
