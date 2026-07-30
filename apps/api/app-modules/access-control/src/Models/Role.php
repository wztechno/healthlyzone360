<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Models;

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Factories\RoleFactory;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A role grants permissions to memberships. Rows with organisation_id NULL
 * are platform templates (is_system) and stay visible in every tenant
 * context — the organisation scope explicitly allows NULL rows here.
 *
 * @property string $id
 * @property string|null $organisation_id null = platform template
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property bool $is_system
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class Role extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<RoleFactory> */
    use HasFactory;

    public function organisationScopeAllowsNull(): bool
    {
        return true;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_system' => 'boolean',
        ];
    }

    /**
     * @return HasMany<RolePermission, $this>
     */
    public function rolePermissions(): HasMany
    {
        return $this->hasMany(RolePermission::class);
    }

    /**
     * @return BelongsToMany<Permission, $this>
     */
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_permissions');
    }

    public function isTemplate(): bool
    {
        return $this->organisation_id === null;
    }
}
