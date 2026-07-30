<?php

declare(strict_types=1);

namespace Healthy360\Identity\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Identity\Database\Factories\UserProfileFactory;
use Healthy360\ReferenceData\Models\Country;
use Healthy360\ReferenceData\Models\Language;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Person data for a global user identity: names live here, not on users.
 *
 * @property string $id
 * @property string $user_id
 * @property string $given_name
 * @property string $family_name
 * @property string $preferred_language_code
 * @property string|null $country_code
 * @property string $timezone
 * @property string $numbering_system latn | arab (default per OQ-001)
 * @property CarbonImmutable|null $date_of_birth
 * @property string|null $created_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class UserProfile extends BaseModel
{
    /** @use HasFactory<UserProfileFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date',
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
     * @return BelongsTo<Language, $this>
     */
    public function preferredLanguage(): BelongsTo
    {
        return $this->belongsTo(Language::class, 'preferred_language_code', 'code');
    }

    /**
     * @return BelongsTo<Country, $this>
     */
    public function country(): BelongsTo
    {
        return $this->belongsTo(Country::class, 'country_code', 'code');
    }
}
