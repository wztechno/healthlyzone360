<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Database\Factories;

use Carbon\CarbonImmutable;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceListItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A standing, confirmed price by default — the shape almost every test starts
 * from.
 *
 * The unpriced states are states rather than defaults for a reason: they clear
 * the amount as they set the status, so a test cannot accidentally build the
 * combination the database CHECK exists to refuse and then wonder why the
 * insert failed.
 *
 * @extends Factory<PriceListItem>
 */
class PriceListItemFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_variant_id' => null,
            'min_quantity' => null,
            'unit_amount_minor' => 1500,
            'price_status' => PriceStatus::Confirmed,
            'effective_from' => CarbonImmutable::now()->startOfDay(),
            'effective_to' => null,
            'superseded_by_id' => null,
        ];
    }

    public function placeholder(): static
    {
        return $this->state(fn (array $attributes): array => [
            'price_status' => PriceStatus::Placeholder,
            'unit_amount_minor' => null,
        ]);
    }

    public function marketPriced(): static
    {
        return $this->state(fn (array $attributes): array => [
            'price_status' => PriceStatus::MarketPriced,
            'unit_amount_minor' => null,
        ]);
    }

    public function tier(float $minQuantity, int $amountMinor): static
    {
        return $this->state(fn (array $attributes): array => [
            'min_quantity' => number_format($minQuantity, 4, '.', ''),
            'unit_amount_minor' => $amountMinor,
            'price_status' => PriceStatus::Confirmed,
        ]);
    }

    /**
     * A closed row: it governed `[from, to)` and nothing since.
     */
    public function closed(CarbonImmutable $from, CarbonImmutable $to): static
    {
        return $this->state(fn (array $attributes): array => [
            'effective_from' => $from,
            'effective_to' => $to,
        ]);
    }
}
