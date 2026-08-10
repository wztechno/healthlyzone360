<?php

declare(strict_types=1);

namespace Healthy360\Production\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string $recipe_version_id
 * @property string $status one of 'planned', 'in_progress', 'completed', 'cancelled'
 * @property numeric-string|null $planned_yield
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class ProductionOrder extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
