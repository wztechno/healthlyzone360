<?php

declare(strict_types=1);

namespace Healthy360\Consent\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Consent\Database\Factories\ConsentGrantFactory;
use Healthy360\Consent\Enums\ConsentStatus;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A user's grant (or withdrawal) of a consent definition. Platform-level
 * consents (terms, privacy) carry a NULL organisation and remain visible in
 * any tenant context; organisation-contextual consents are tenant-scoped.
 *
 * @property string $id
 * @property string $user_id
 * @property string $consent_definition_id
 * @property string|null $organisation_id
 * @property ConsentStatus $status
 * @property CarbonImmutable $granted_at
 * @property CarbonImmutable|null $withdrawn_at
 * @property string $channel web | ios | android
 * @property CarbonImmutable|null $created_at
 */
#[Classified(DataClassification::SpecialCategory, 'user_id', 'consent_definition_id', 'status', 'granted_at', 'withdrawn_at')]
#[Classified(DataClassification::Internal, 'organisation_id', 'channel')]
class ConsentGrant extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<ConsentGrantFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

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
            'status' => ConsentStatus::class,
            'granted_at' => 'datetime',
            'withdrawn_at' => 'datetime',
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
     * @return BelongsTo<ConsentDefinition, $this>
     */
    public function definition(): BelongsTo
    {
        return $this->belongsTo(ConsentDefinition::class, 'consent_definition_id');
    }
}
