<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Database\Factories;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Models\PriceList;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PriceList>
 */
class PriceListFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'branch_id' => null,
            'code' => 'tariff-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => 'Web tariff',
            'name_ar' => 'تعرفة المتجر',
            'currency_code' => 'USD',
            'customer_scope' => CustomerScope::PublicTariff,
            'status' => PriceListStatus::Draft,
            'valid_from' => null,
            'valid_to' => null,
            'lock_version' => 0,
        ];
    }

    public function active(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => PriceListStatus::Active]);
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => PriceListStatus::Archived]);
    }

    public function agreement(): static
    {
        return $this->state(fn (array $attributes): array => [
            'customer_scope' => CustomerScope::Agreement,
            'name_en' => 'Negotiated tariff',
            'name_ar' => 'تعرفة متفاوض عليها',
        ]);
    }
}
