<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\CatalogueItemAvailabilityDayFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One calendar day on which a meal may be offered.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_item_id
 * @property CarbonImmutable $date
 * @property bool $is_available
 * @property int|null $remaining_portions
 * @property string|null $order_cut_off_at
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'is_available', 'remaining_portions', 'order_cut_off_at')]
class CatalogueItemAvailabilityDay extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<CatalogueItemAvailabilityDayFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'date' => 'immutable_date',
            'is_available' => 'boolean',
            'remaining_portions' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }
}
