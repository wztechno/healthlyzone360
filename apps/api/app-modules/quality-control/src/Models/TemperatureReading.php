<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * One morning's or evening's reading of one unit. Written once.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $temperature_unit_id
 * @property CarbonImmutable $reading_date
 * @property string $slot `am` or `pm`
 * @property numeric-string $celsius
 * @property bool $out_of_range
 * @property string|null $note
 * @property string $recorded_by
 * @property CarbonImmutable|null $created_at
 */
class TemperatureReading extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'reading_date' => 'immutable_date',
            'celsius' => 'decimal:1',
            'out_of_range' => 'boolean',
        ];
    }
}
