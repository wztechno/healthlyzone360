<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Organisations\Database\Factories\OrganisationFactory;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\ReferenceData\Models\Language;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The tenant unit (plan §9). Not itself organisation-scoped: tenant scoping
 * applies to organisation-owned rows; access to the organisation row is
 * governed by policies and the six-step RBAC decision.
 *
 * @property string $id
 * @property string $organisation_type_id
 * @property string $name
 * @property string $slug
 * @property string $country_code
 * @property string $default_currency_code
 * @property string $default_language_code
 * @property OrganisationStatus $status
 * @property CarbonImmutable|null $suspended_at
 * @property string|null $suspension_reason
 * @property string|null $suspended_by
 * @property string|null $created_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class Organisation extends BaseModel
{
    /** @use HasFactory<OrganisationFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => OrganisationStatus::class,
            'suspended_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function suspendedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'suspended_by');
    }

    /**
     * @return BelongsTo<OrganisationType, $this>
     */
    public function type(): BelongsTo
    {
        return $this->belongsTo(OrganisationType::class, 'organisation_type_id');
    }

    /**
     * @return BelongsTo<Country, $this>
     */
    public function country(): BelongsTo
    {
        return $this->belongsTo(Country::class, 'country_code', 'code');
    }

    /**
     * @return BelongsTo<Currency, $this>
     */
    public function defaultCurrency(): BelongsTo
    {
        return $this->belongsTo(Currency::class, 'default_currency_code', 'code');
    }

    /**
     * @return BelongsTo<Language, $this>
     */
    public function defaultLanguage(): BelongsTo
    {
        return $this->belongsTo(Language::class, 'default_language_code', 'code');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return HasMany<OrganisationCapability, $this>
     */
    public function capabilities(): HasMany
    {
        return $this->hasMany(OrganisationCapability::class);
    }

    /**
     * @return HasMany<OrganisationBranch, $this>
     */
    public function branches(): HasMany
    {
        return $this->hasMany(OrganisationBranch::class);
    }

    /**
     * @return HasMany<OrganisationMembership, $this>
     */
    public function memberships(): HasMany
    {
        return $this->hasMany(OrganisationMembership::class);
    }
}
