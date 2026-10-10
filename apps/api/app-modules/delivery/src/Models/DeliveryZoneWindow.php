<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * One window offered in one zone. Written by `ZoneWindowService` and nothing
 * else at runtime; the set is replaced whole under the zone's validator.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $delivery_zone_id
 * @property string $delivery_window_id
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 */
#[Classified(DataClassification::Internal, 'delivery_window_id')]
class DeliveryZoneWindow extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    public const UPDATED_AT = null;
}
