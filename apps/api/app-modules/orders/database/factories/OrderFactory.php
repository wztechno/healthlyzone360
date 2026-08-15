<?php

declare(strict_types=1);

namespace Healthy360\Orders\Database\Factories;

use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\FulfilmentType;
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
            'delivery_building' => null,
            'delivery_floor' => null,
            'delivery_apartment' => null,
            'delivery_directions' => null,
            'delivery_contact_point_id' => null,
            'delivery_window_code' => null,
            'requested_delivery_date' => null,
            'payment_method' => PaymentMethod::CashOnDelivery,
            // The default the column carries and the shape every fixture built
            // before this state existed already had: a customer, an address, a
            // courier. Named rather than left to the database default so that a
            // factory-built order and a placed one are the same row.
            'fulfilment_type' => FulfilmentType::Delivery,
            'placed_at' => now(),
            'lock_version' => 0,
        ];
    }

    /**
     * An order the customer is coming to collect.
     *
     * **The address snapshot goes and the money goes with it.** The state has
     * to move three things together because two constraints say so:
     * `orders_fulfilment_shape_check` refuses a pickup carrying
     * `delivery_line_one`, and `orders_total_check` refuses a total that is not
     * the subtotal plus the fee — so a fixture that nulled the address and left
     * the five hundred minor units of delivery fee behind would be an order
     * charging somebody to carry food they came and fetched. The whole snapshot
     * goes rather than just the constrained line: a pickup has no destination,
     * and a district name on a row nobody is travelling to is a fact about
     * nothing.
     *
     * What stays is the **customer** — somebody has to be rung when it is ready
     * and handed the bag, and the shape CHECK requires it — and any promised
     * slot the caller sets. "Be here at six" is a promise whether or not the
     * food travels.
     */
    public function pickup(): static
    {
        return $this->state(fn (): array => [
            'fulfilment_type' => FulfilmentType::Pickup,
            'delivery_label' => null,
            'delivery_line_one' => null,
            'delivery_line_two' => null,
            'delivery_city' => null,
            'delivery_area_name_en' => null,
            'delivery_area_name_ar' => null,
            'delivery_area_id' => null,
            'delivery_zone_id' => null,
            'delivery_building' => null,
            'delivery_floor' => null,
            'delivery_apartment' => null,
            'delivery_directions' => null,
            'delivery_contact_point_id' => null,
            'delivery_fee_minor' => null,
            'total_minor' => 2500,
        ]);
    }

    /**
     * A walk-in sale: somebody bought lunch at the desk.
     *
     * Everything `pickup()` drops, and the customer as well. `customer_account_
     * id` is null here because the *stranger* is the case worth having a
     * fixture for — the shape CHECK leaves the customer optional on this arm,
     * so a caller who wants the regular-who-is-known variant passes an account
     * over the top of this state and the row is still legal.
     *
     * It is also the only state that produces a row the factory can build with
     * no customer account at all, which is the whole reason the migration
     * relaxed the column.
     */
    public function counter(): static
    {
        return $this->state(fn (): array => [
            'fulfilment_type' => FulfilmentType::Counter,
            'customer_account_id' => null,
            'delivery_label' => null,
            'delivery_line_one' => null,
            'delivery_line_two' => null,
            'delivery_city' => null,
            'delivery_area_name_en' => null,
            'delivery_area_name_ar' => null,
            'delivery_area_id' => null,
            'delivery_zone_id' => null,
            'delivery_building' => null,
            'delivery_floor' => null,
            'delivery_apartment' => null,
            'delivery_directions' => null,
            'delivery_contact_point_id' => null,
            'delivery_fee_minor' => null,
            'total_minor' => 2500,
            'payment_method' => PaymentMethod::CashAtCounter,
        ]);
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
