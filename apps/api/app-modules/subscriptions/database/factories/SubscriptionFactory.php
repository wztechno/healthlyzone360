<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Database\Factories;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Enums\SubscriptionStatus;
use Healthy360\Subscriptions\Models\Subscription;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A subscription row, for the tests that need one to exist rather than one to
 * have been *sold*.
 *
 * It deliberately fills none of the foreign keys. A subscription points at a
 * kitchen, a channel, a plan, a configuration cell, a duration, a customer and
 * an address, and every one of them has to be consistent with the others — a
 * factory that invented seven unrelated rows would produce a subscription that
 * cannot be generated from, and a test asserting against it would be asserting
 * about a shape the platform never creates. `SubscriptionWorld` builds the real
 * thing through `SubscriptionService::create()`, which is where the invariants
 * live; this fills in only what has no relationships to keep straight.
 *
 * @extends Factory<Subscription>
 */
class SubscriptionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'status' => SubscriptionStatus::Active,
            'weekdays' => [1, 3, 5],
            'balance_days_total' => 20,
            'balance_days_consumed' => 0,
            'no_substitutions' => false,
            'pause_count' => 0,
            'captured_unit_price_minor' => 2000,
            'captured_discount_percent' => null,
            'effective_day_price_minor' => 2000,
            'captured_at' => CarbonImmutable::now(),
            'lock_version' => 0,
        ];
    }

    public function paused(): static
    {
        return $this->state(fn (array $attributes): array => [
            'status' => SubscriptionStatus::Paused,
            'paused_at' => CarbonImmutable::now(),
            'next_generation_date' => null,
            'pause_count' => 1,
        ]);
    }

    /** A balance with nothing left on it — the shape a renewal is offered on. */
    public function exhausted(): static
    {
        return $this->state(fn (array $attributes): array => [
            'balance_days_consumed' => $attributes['balance_days_total'] ?? 20,
        ]);
    }
}
