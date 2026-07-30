<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Models;

use Carbon\CarbonImmutable;
use Healthy360\Organisations\Database\Factories\OrganisationBranchFactory;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An organisation subdivision; branch selection is part of the working
 * context where applicable.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $name
 * @property string $country_code
 * @property string|null $city
 * @property string|null $address
 * @property string $timezone
 * @property BranchStatus $status
 * @property string|null $created_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class OrganisationBranch extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<OrganisationBranchFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => BranchStatus::class,
        ];
    }

    /**
     * @return BelongsTo<Country, $this>
     */
    public function country(): BelongsTo
    {
        return $this->belongsTo(Country::class, 'country_code', 'code');
    }

    /**
     * @return HasMany<OrganisationMembership, $this>
     */
    public function memberships(): HasMany
    {
        return $this->hasMany(OrganisationMembership::class, 'branch_id');
    }
}
