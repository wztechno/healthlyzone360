<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Models;

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Factories\RolePermissionFactory;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Grant of a permission to a role. organisation_id is denormalised for RLS
 * and NULL for platform template grants (visible in every context).
 *
 * @property string $id
 * @property string|null $organisation_id
 * @property string $role_id
 * @property string $permission_id
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 */
class RolePermission extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<RolePermissionFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    public function organisationScopeAllowsNull(): bool
    {
        return true;
    }

    /**
     * @return BelongsTo<Role, $this>
     */
    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    /**
     * @return BelongsTo<Permission, $this>
     */
    public function permission(): BelongsTo
    {
        return $this->belongsTo(Permission::class);
    }
}
