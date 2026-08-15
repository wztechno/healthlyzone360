<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Models;

use Carbon\CarbonImmutable;
use Healthy360\Delivery\Database\Factories\DeliveryZoneAreaFactory;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One area claimed by one zone.
 *
 * `branch_id` is a **copy of the zone's**, written by `ZoneAreaService` and by
 * nothing else. It exists because the "one area per branch" unique index
 * cannot reach through a join to read the parent's scope, and it is the single
 * place in this module where a denormalisation has to be kept honest — which
 * is why exactly one service writes it and a test asserts the two agree.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $delivery_zone_id
 * @property string $delivery_area_id
 * @property string|null $branch_id
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'delivery_area_id')]
class DeliveryZoneArea extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<DeliveryZoneAreaFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<DeliveryZone, $this>
     */
    public function zone(): BelongsTo
    {
        return $this->belongsTo(DeliveryZone::class, 'delivery_zone_id');
    }

    /**
     * @return BelongsTo<DeliveryArea, $this>
     */
    public function area(): BelongsTo
    {
        return $this->belongsTo(DeliveryArea::class, 'delivery_area_id');
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }
}
