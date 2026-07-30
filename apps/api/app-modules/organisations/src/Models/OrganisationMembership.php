<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Organisations\Database\Factories\OrganisationMembershipFactory;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The link between a global user identity and an organisation. Roles are
 * assigned to memberships, never to users directly (plan §9).
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $user_id
 * @property string|null $branch_id null = organisation-wide
 * @property MembershipStatus $status
 * @property CarbonImmutable|null $joined_at
 * @property string|null $created_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class OrganisationMembership extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<OrganisationMembershipFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => MembershipStatus::class,
            'joined_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }

    public function isActive(): bool
    {
        return $this->status === MembershipStatus::Active;
    }
}
