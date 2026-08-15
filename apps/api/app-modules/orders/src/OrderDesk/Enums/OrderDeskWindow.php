<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Enums;

/**
 * Which slice of the open book the desk is looking at.
 *
 * **Three windows, and they are three questions somebody at a desk actually
 * asks**, not three arbitrary date ranges. `today` is "what am I working on
 * now"; `overdue` is "what have we let slip"; `next_7` is "what is coming, and
 * do we have the hands". A single `from`/`to` pair could express all three and
 * would express a hundred others nobody asks, each one a page the kitchen pays
 * to compute.
 *
 * **`today` includes orders with no requested date at all**, and that inclusion
 * is the whole reason this is a vocabulary rather than a range. An order whose
 * customer named no day is not scheduled for nothing — it is scheduled for *as
 * soon as possible*, which is today until somebody works it. A window
 * expressed as `requested_delivery_date BETWEEN x AND y` would silently drop
 * every one of them, and the orders that fell out of the queue would be exactly
 * the ones nobody had committed to a day yet.
 *
 * `overdue` deliberately does **not** inherit that rule. A dateless order is
 * never late, because there is no day it has missed.
 */
enum OrderDeskWindow: string
{
    case Today = 'today';
    case Overdue = 'overdue';
    case Next7 = 'next_7';

    /**
     * How far past `today` the window reaches, in days. Only `next_7` looks
     * forward; the other two are answered against a single date.
     */
    public function forwardDays(): int
    {
        return match ($this) {
            self::Today, self::Overdue => 0,
            self::Next7 => 7,
        };
    }

    /**
     * @return list<string>
     */
    public static function codes(): array
    {
        return array_map(static fn (self $window): string => $window->value, self::cases());
    }
}
