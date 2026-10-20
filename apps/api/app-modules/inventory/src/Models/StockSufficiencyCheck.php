<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * One branch's weekly stock check — see the table's migration.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property CarbonImmutable $window_from
 * @property CarbonImmutable $window_to
 * @property CarbonImmutable $checked_at
 * @property int $requirement_count
 * @property int $short_count
 * @property int $not_computable_days
 * @property list<array<string, mixed>> $shortfalls
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class StockSufficiencyCheck extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'window_from' => 'immutable_date',
            'window_to' => 'immutable_date',
            'checked_at' => 'immutable_datetime',
            'requirement_count' => 'integer',
            'short_count' => 'integer',
            'not_computable_days' => 'integer',
            'shortfalls' => 'array',
        ];
    }
}
