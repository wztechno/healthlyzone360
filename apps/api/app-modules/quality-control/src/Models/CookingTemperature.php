<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * A batch's core temperature, as measured. Several readings on a batch are fine: a
 * probe that reads low is cooked on and read again.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $production_order_id
 * @property numeric-string $celsius
 * @property string|null $note
 * @property string $recorded_by
 * @property CarbonImmutable|null $created_at
 */
class CookingTemperature extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['celsius' => 'decimal:1'];
    }
}
