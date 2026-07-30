<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Models;

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Factories\MembershipRoleFactory;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Assignment of a role to an organisation membership, optionally time-bound
 * via starts_at / expires_at (plan §10).
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $membership_id
 * @property string $role_id
 * @property CarbonImmutable|null $starts_at
 * @property CarbonImmutable|null $expires_at
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class MembershipRole extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<MembershipRoleFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<OrganisationMembership, $this>
     */
    public function membership(): BelongsTo
    {
        return $this->belongsTo(OrganisationMembership::class, 'membership_id');
    }

    /**
     * @return BelongsTo<Role, $this>
     */
    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    public function isCurrentlyEffective(): bool
    {
        $now = now();

        if ($this->starts_at !== null && $this->starts_at->isAfter($now)) {
            return false;
        }

        return $this->expires_at === null || $this->expires_at->isAfter($now);
    }
}
