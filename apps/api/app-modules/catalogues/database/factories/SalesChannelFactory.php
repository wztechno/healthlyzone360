<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SalesChannel>
 */
class SalesChannelFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'code' => 'channel-'.fake()->unique()->numberBetween(1, 999999),
            'channel_kind' => SalesChannelKind::B2cWeb,
            'name_en' => 'Web shop',
            'name_ar' => 'المتجر الإلكتروني',
            'order_source' => null,
            'status' => SalesChannelStatus::Active,
            'lock_version' => 0,
        ];
    }

    public function wholesale(): static
    {
        return $this->state(fn (array $attributes): array => [
            'channel_kind' => SalesChannelKind::B2b,
            'name_en' => 'Wholesale',
            'name_ar' => 'البيع بالجملة',
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => SalesChannelStatus::Inactive]);
    }
}
