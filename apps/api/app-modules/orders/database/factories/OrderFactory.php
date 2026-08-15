<?php

declare(strict_types=1);

namespace Healthy360\Orders\Database\Factories;

use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Order>
 */
class OrderFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        // No defaults for the seller, the customer or the channel: an order
        // whose kitchen does not sell through its own channel is not a state
        // any test wants to reason about, and three unrelated factories would
        // build exactly that.
        return [
            // Not `OrderNumbers`: the generator queries the table to guarantee
            // uniqueness, and a factory building two hundred rows would make
            // that two hundred round trips for a property no test asserts.
            'order_number' => 'ORD-'.Str::upper(Str::random(10)),
            'branch_id' => null,
            'status' => OrderStatus::Placed,
            'currency_code' => 'USD',
            'subtotal_minor' => 2500,
            'delivery_fee_minor' => 500,
            'total_minor' => 3000,
            'delivery_label' => 'Home',
            'delivery_line_one' => 'Rue Gouraud 12',
            'delivery_line_two' => null,
            'delivery_city' => null,
            'delivery_area_name_en' => 'Achrafieh',
            'delivery_area_name_ar' => 'الأشرفية',
            'delivery_area_id' => null,
            'delivery_zone_id' => null,
            'delivery_window_code' => null,
            'requested_delivery_date' => null,
            'payment_method' => PaymentMethod::CashOnDelivery,
            'placed_at' => now(),
            'lock_version' => 0,
        ];
    }

    public function confirmed(): static
    {
        return $this->state(fn (): array => ['status' => OrderStatus::Confirmed, 'confirmed_at' => now()]);
    }

    public function fulfilled(): static
    {
        return $this->state(fn (): array => [
            'status' => OrderStatus::Fulfilled,
            'confirmed_at' => now(),
            'fulfilled_at' => now(),
        ]);
    }

    /**
     * A cancelled order, stamped and reasoned.
     *
     * The three fields move together because `orders_cancellation_check` makes
     * any other combination illegal: the status and the timestamp are the same
     * fact stated twice, and a reason without a cancellation is a ghost the
     * CHECK refuses. A state that set only the status would fail at the
     * database rather than in the assertion, which is the sort of failure that
     * gets read as a broken fixture.
     */
    public function cancelled(): static
    {
        return $this->state(fn (): array => [
            'status' => OrderStatus::Cancelled,
            'cancelled_at' => now(),
            'cancellation_reason' => CancellationReason::CustomerRequested,
        ]);
    }
}
