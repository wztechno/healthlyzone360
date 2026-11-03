<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Services\MealAvailabilityService;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Illuminate\Support\Facades\DB;

/**
 * `catalogue_item_availability_days.remaining_portions`, counted down when an
 * order takes food and back up when it gives it back.
 *
 * **The decrement is the guard.** `LineProbe` reads the figure so the customer
 * hears early, but two checkouts can read the same last portion. A single
 * `UPDATE … WHERE remaining_portions >= ?` cannot oversell: the row lock makes
 * the second statement see the first one's result, match nothing and refuse. Items
 * go in id order so that two baskets sharing two dishes cannot deadlock.
 *
 * A day with no row, or a null figure, is a dish nobody is counting, and neither
 * takes nor gives back.
 *
 * Read as a table because the row is one integer on one index, and the orders
 * module has no business loading a catalogue model for it.
 */
final readonly class CalendarPortions
{
    public function __construct(private MealAvailabilityService $calendar) {}

    /**
     * Inside the placement's transaction. A refusal rolls the order back.
     *
     * @throws PlacementRefused
     */
    public function take(Order $order): void
    {
        $day = $this->dayOf($order);

        foreach ($this->portionsByItem($order) as $itemId => $portions) {
            $taken = DB::table('catalogue_item_availability_days')
                ->where('catalogue_item_id', $itemId)
                ->where('date', $day)
                ->where('remaining_portions', '>=', $portions)
                ->decrement('remaining_portions', $portions);

            if ($taken > 0) {
                continue;
            }

            $counted = DB::table('catalogue_item_availability_days')
                ->where('catalogue_item_id', $itemId)
                ->where('date', $day)
                ->whereNotNull('remaining_portions')
                ->exists();

            if ($counted) {
                throw new PlacementRefused([[
                    'reason' => 'item_unavailable_on_date',
                    'catalogue_item_id' => $itemId,
                    'on' => $day,
                    'cause' => 'sold_out',
                ]]);
            }
        }
    }

    /** Give back what `take()` took. An order that took nothing gives nothing. */
    public function release(Order $order): void
    {
        if (! $order->portions_counted) {
            return;
        }

        $day = $this->dayOf($order);

        foreach ($this->portionsByItem($order) as $itemId => $portions) {
            DB::table('catalogue_item_availability_days')
                ->where('catalogue_item_id', $itemId)
                ->where('date', $day)
                ->whereNotNull('remaining_portions')
                ->increment('remaining_portions', $portions);
        }
    }

    /**
     * The day the order was counted against: the requested one, or for a counter
     * sale the day on the kitchen's wall when it was placed.
     */
    private function dayOf(Order $order): string
    {
        return $order->requested_delivery_date?->toDateString()
            ?? $this->calendar->dayOf($order->organisation_id, $order->placed_at ?? CarbonImmutable::now());
    }

    /**
     * Whole portions per item, in id order. A part of a portion is still a plate.
     *
     * @return array<string, int>
     */
    private function portionsByItem(Order $order): array
    {
        $portions = [];

        foreach ($order->lines()->get() as $line) {
            /** @var OrderLine $line */
            $itemId = (string) $line->catalogue_item_id;
            $portions[$itemId] = ($portions[$itemId] ?? 0) + (float) $line->quantity;
        }

        ksort($portions);

        return array_map(static fn (float $quantity): int => (int) ceil($quantity), $portions);
    }
}
