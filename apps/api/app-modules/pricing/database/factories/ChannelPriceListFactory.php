<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Database\Factories;

use Healthy360\Pricing\Models\ChannelPriceList;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ChannelPriceList>
 */
class ChannelPriceListFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return ['priority' => 0];
    }

    public function atPriority(int $priority): static
    {
        return $this->state(fn (array $attributes): array => ['priority' => $priority]);
    }
}
