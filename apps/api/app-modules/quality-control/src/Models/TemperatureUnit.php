<?php

declare(strict_types=1);

namespace Healthy360\QualityControl\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * A fridge or a freezer and the range it should hold.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string $name
 * @property string $kind `fridge` or `freezer`
 * @property numeric-string $min_c
 * @property numeric-string $max_c
 * @property bool $active
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class TemperatureUnit extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'min_c' => 'decimal:1',
            'max_c' => 'decimal:1',
            'active' => 'boolean',
        ];
    }
}
