<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Models;

use Carbon\CarbonImmutable;
use Healthy360\Organisations\Database\Factories\OrganisationCapabilityFactory;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * A capability enabled for an organisation (clinic_services,
 * kitchen_production, ...).
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $capability
 * @property bool $is_enabled
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class OrganisationCapability extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<OrganisationCapabilityFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_enabled' => 'boolean',
        ];
    }
}
