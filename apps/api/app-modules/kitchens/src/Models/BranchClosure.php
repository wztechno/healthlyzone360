<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * Dates one branch is shut, on top of its weekly hours. Both ends inclusive.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property CarbonImmutable $closed_from
 * @property CarbonImmutable $closed_to
 * @property string|null $note
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'closed_from', 'closed_to')]
class BranchClosure extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'closed_from' => 'immutable_date',
            'closed_to' => 'immutable_date',
        ];
    }
}
