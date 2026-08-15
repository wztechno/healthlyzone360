<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * The life of one corporate quotation (B5).
 *
 * `draft → submitted → quoted → accepted|declined|expired`.
 *
 * The buyer owns `draft` and `submitted`: drafting lines and asking for
 * prices are their moves. The kitchen (or platform, on its behalf) owns the
 * transition out of `submitted` into `quoted` — naming the prices is the one
 * act neither the buyer nor the platform performs for them. From `quoted`,
 * the buyer decides again: `accepted` or `declined`, or the clock runs out
 * and a scheduled sweep moves it to `expired` seven days after `quoted_at`.
 *
 * There is deliberately no route back into `draft`. A buyer who wants to
 * change a submitted set of lines withdraws nothing here — B1's locked scope
 * has no withdrawal action — they simply let it sit, and drafting a fresh
 * quotation costs them nothing since a programme may hold many.
 */
enum QuotationStatus: string
{
    case Draft = 'draft';

    case Submitted = 'submitted';

    case Quoted = 'quoted';

    case Accepted = 'accepted';

    case Declined = 'declined';

    case Expired = 'expired';

    /**
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Draft => [self::Submitted],
            self::Submitted => [self::Quoted],
            self::Quoted => [self::Accepted, self::Declined, self::Expired],
            self::Accepted, self::Declined, self::Expired => [],
        };
    }

    public function canTransitionTo(self $next): bool
    {
        return in_array($next, $this->allowedTransitions(), true);
    }

    /** Whether the buyer may still add, change or remove lines. */
    public function linesAreEditable(): bool
    {
        return $this === self::Draft;
    }

    /** Whether this is one of the three ways a quotation stops moving. */
    public function isTerminal(): bool
    {
        return in_array($this, [self::Accepted, self::Declined, self::Expired], true);
    }
}
