<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ChannelCatalogueItem>
 */
class ChannelCatalogueItemFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_id' => CatalogueItem::factory(),
            'organisation_id' => fn (array $attributes): ?string => CatalogueItem::withoutTenancy()
                ->whereKey($attributes['catalogue_item_id'] ?? null)
                ->value('organisation_id'),
            'sales_channel_id' => SalesChannel::factory(),
            'catalogue_item_variant_id' => null,
            'is_available' => true,
            'available_from' => null,
            'available_to' => null,
        ];
    }
}
