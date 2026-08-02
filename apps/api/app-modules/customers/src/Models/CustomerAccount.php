<?php

declare(strict_types=1);

namespace Healthy360\Customers\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * The party a kitchen sells to.
 *
 * **Deliberately not `OrganisationScoped`.** The tenancy trait applies a global
 * scope keyed on the ambient organisation and fills `organisation_id` on write,
 * which is right for a kitchen's own records and wrong here: a consumer account
 * has no organisation, and a fail-closed org scope would hide every D2C row
 * from the person who owns it. Isolation for this table is the PostgreSQL
 * policy (`org-rls + user-owner`), which knows how to say "mine *or* my
 * organisation's" — something an application scope over a single column cannot.
 *
 * `display_name` is `Confidential`: for a consumer it is a person's name.
 *
 * @property string $id
 * @property string $account_number
 * @property CustomerAccountType $account_type
 * @property string|null $user_id
 * @property string|null $organisation_id
 * @property CustomerAccountStatus $status
 * @property CustomerAccountOrigin $origin
 * @property string|null $display_name
 * @property string|null $preferred_language_code
 * @property string|null $country_code
 * @property CarbonImmutable|null $activated_at
 * @property CarbonImmutable|null $suspended_at
 * @property CarbonImmutable|null $closed_at
 * @property CarbonImmutable|null $anonymised_at
 * @property CarbonImmutable|null $last_activity_at
 * @property CarbonImmutable|null $provisional_expires_at
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read User|null $user
 * @property-read Organisation|null $organisation
 * @property-read CustomerDietaryProfile|null $dietaryProfile
 * @property-read Collection<int, CustomerAddress> $addresses
 * @property-read Collection<int, ContactPoint> $contactPoints
 */
#[Classified(DataClassification::Confidential, 'display_name', 'account_number')]
class CustomerAccount extends BaseModel
{
    /** @use HasFactory<CustomerAccountFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'account_type' => CustomerAccountType::class,
            'status' => CustomerAccountStatus::class,
            'origin' => CustomerAccountOrigin::class,
            'activated_at' => 'datetime',
            'suspended_at' => 'datetime',
            'closed_at' => 'datetime',
            'anonymised_at' => 'datetime',
            'last_activity_at' => 'datetime',
            'provisional_expires_at' => 'datetime',
            'lock_version' => 'integer',
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
     * @return BelongsTo<Organisation, $this>
     */
    public function organisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class);
    }

    /**
     * @return HasMany<CustomerAddress, $this>
     */
    public function addresses(): HasMany
    {
        return $this->hasMany(CustomerAddress::class);
    }

    /**
     * @return HasOne<CustomerDietaryProfile, $this>
     */
    public function dietaryProfile(): HasOne
    {
        return $this->hasOne(CustomerDietaryProfile::class);
    }

    /**
     * Contacts owned by the account rather than by an identity — the guest
     * shape, and any number a delivery is arranged on.
     *
     * @return HasMany<ContactPoint, $this>
     */
    public function contactPoints(): HasMany
    {
        return $this->hasMany(ContactPoint::class);
    }

    public function isActive(): bool
    {
        return $this->status === CustomerAccountStatus::Active;
    }
}
