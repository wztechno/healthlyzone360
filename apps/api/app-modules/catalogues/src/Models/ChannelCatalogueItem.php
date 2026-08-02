<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\ChannelCatalogueItemFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Which items a channel offers, and when.
 *
 * A row says "this channel offers this, from here, until there". Its absence
 * says nothing at all: availability and publication are different questions,
 * and an item can be a complete, published, sellable article that no channel
 * offers yet.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $sales_channel_id
 * @property string $catalogue_item_id
 * @property string|null $catalogue_item_variant_id
 * @property bool $is_available
 * @property CarbonImmutable|null $available_from
 * @property CarbonImmutable|null $available_to
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'is_available', 'available_from', 'available_to')]
class ChannelCatalogueItem extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<ChannelCatalogueItemFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_available' => 'boolean',
            'available_from' => 'immutable_date',
            'available_to' => 'immutable_date',
        ];
    }

    /**
     * @return BelongsTo<SalesChannel, $this>
     */
    public function channel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class, 'sales_channel_id');
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }

    /**
     * @return BelongsTo<CatalogueItemVariant, $this>
     */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(CatalogueItemVariant::class, 'catalogue_item_variant_id');
    }
}
