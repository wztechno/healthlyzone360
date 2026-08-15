<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Database\Factories\OrganisationInvitationFactory;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An outstanding offer of membership.
 *
 * `token_hash` is hidden for the same reason `KycDocument::$path` is: it is
 * the attribute that turns a database read into an account, and the only code
 * that should ever see it is the lookup in `InvitationService`. The token
 * itself is never stored at all.
 *
 * **Status is derived, not stored.** An invitation is live, accepted, revoked
 * or expired, and three of those four are already facts on the row —
 * `accepted_at`, `revoked_at`, `expires_at`. A `status` column would be a
 * fourth copy that has to be kept in step with a clock, and the first thing to
 * drift would be expiry.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $branch_id
 * @property string $email
 * @property string $email_normalised
 * @property string $role_code
 * @property string $token_hash
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $accepted_at
 * @property string|null $accepted_by_user_id
 * @property CarbonImmutable|null $revoked_at
 * @property string|null $revoked_by
 * @property string|null $invited_by
 * @property string|null $message
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'email', 'email_normalised', 'token_hash')]
class OrganisationInvitation extends BaseModel
{
    /** @use HasFactory<OrganisationInvitationFactory> */
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $hidden = ['token_hash'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'immutable_datetime',
            'accepted_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }

    /** Still open, still in date, not withdrawn. */
    public function isLive(?CarbonImmutable $at = null): bool
    {
        return $this->accepted_at === null
            && $this->revoked_at === null
            && $this->expires_at->greaterThan($at ?? CarbonImmutable::now());
    }

    public function hasExpired(?CarbonImmutable $at = null): bool
    {
        return $this->accepted_at === null
            && $this->revoked_at === null
            && ! $this->expires_at->greaterThan($at ?? CarbonImmutable::now());
    }

    /**
     * @return BelongsTo<Organisation, $this>
     */
    public function organisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class);
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function acceptedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'accepted_by_user_id');
    }
}
