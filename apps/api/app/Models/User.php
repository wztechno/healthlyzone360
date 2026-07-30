<?php

declare(strict_types=1);

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\UserFactory;
use Healthy360\Identity\Models\UserDevice;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Concerns\HasUuidV7Key;
use Healthy360\Support\Enums\DataClassification;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Fortify\TwoFactorAuthenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * The global Healthy360 identity: one person, one account, many organisation
 * memberships. Person data (names, locale, timezone) lives on the profile.
 *
 * The two_factor_secret and two_factor_recovery_codes columns are encrypted
 * at rest by Fortify's own encrypter (see EnableTwoFactorAuthentication);
 * adding a model-level `encrypted` cast would double-encrypt, so they are
 * deliberately not cast here.
 *
 * @property string $id
 * @property string $email
 * @property CarbonImmutable|null $email_verified_at
 * @property string $password
 * @property string|null $two_factor_secret
 * @property string|null $two_factor_recovery_codes
 * @property CarbonImmutable|null $two_factor_confirmed_at
 * @property string|null $remember_token
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read UserProfile|null $profile
 * @property-read Collection<int, UserDevice> $devices
 * @property-read Collection<int, OrganisationMembership> $memberships
 */
#[Fillable(['email', 'password'])]
#[Hidden(['password', 'two_factor_secret', 'two_factor_recovery_codes', 'remember_token'])]
#[Classified(DataClassification::Restricted, 'password', 'two_factor_secret', 'two_factor_recovery_codes', 'remember_token')]
#[Classified(DataClassification::Confidential, 'email', 'email_verified_at', 'two_factor_confirmed_at')]
class User extends Authenticatable implements MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasUuidV7Key, Notifiable, TwoFactorAuthenticatable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'two_factor_confirmed_at' => 'datetime',
        ];
    }

    /**
     * @return HasOne<UserProfile, $this>
     */
    public function profile(): HasOne
    {
        return $this->hasOne(UserProfile::class);
    }

    /**
     * @return HasMany<UserDevice, $this>
     */
    public function devices(): HasMany
    {
        return $this->hasMany(UserDevice::class);
    }

    /**
     * @return HasMany<OrganisationMembership, $this>
     */
    public function memberships(): HasMany
    {
        return $this->hasMany(OrganisationMembership::class);
    }
}
