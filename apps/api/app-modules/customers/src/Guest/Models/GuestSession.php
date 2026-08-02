<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Models;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Database\Factories\Guest\GuestSessionFactory;
use Healthy360\Customers\Guest\Enums\GuestSessionGrade;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A guest's bearer credential.
 *
 * `token_hash` is `Restricted`: it is the credential's own digest, and while a
 * 384-bit token cannot be recovered from it, publishing the digest would let
 * anybody holding it confirm a token they already possess — which is exactly the
 * check `resolve()` performs. The two hashed fingerprints are `Confidential`:
 * they are pseudonymous, not anonymous, and an IP digest plus a timestamp is a
 * person in most investigations.
 *
 * The model carries no query scopes for "live". `isLive()` is a predicate on a
 * row the service already holds, and the service resolves by digest — a scope
 * would invite a listing path over other people's credentials, which is the read
 * shape this table records having refused.
 *
 * @property string $id
 * @property string $customer_account_id
 * @property string $token_hash
 * @property GuestSessionGrade $grade
 * @property CarbonImmutable|null $contact_verified_at
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $last_used_at
 * @property CarbonImmutable|null $revoked_at
 * @property string|null $ip_hash
 * @property string|null $user_agent_hash
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read CustomerAccount $customerAccount
 */
#[Classified(DataClassification::Restricted, 'token_hash')]
#[Classified(DataClassification::Confidential, 'ip_hash', 'user_agent_hash')]
class GuestSession extends BaseModel
{
    /** @use HasFactory<GuestSessionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'grade' => GuestSessionGrade::class,
            'contact_verified_at' => 'datetime',
            'expires_at' => 'datetime',
            'last_used_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<CustomerAccount, $this>
     */
    public function customerAccount(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class);
    }

    /**
     * Whether this token may still be used.
     *
     * Expiry is a moment rather than an event — a row can be unrevoked and past
     * its window — so the question is asked of the clock, not of a status
     * column. `PurgeExpiredGuestSessions` cleans up afterwards; nothing depends
     * on it having run.
     */
    public function isLive(): bool
    {
        return $this->revoked_at === null && $this->expires_at->isFuture();
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    public function hasVerifiedContact(): bool
    {
        return $this->contact_verified_at !== null;
    }

    public function permits(GuestSessionGrade $required): bool
    {
        return $this->isLive() && $this->grade->permits($required);
    }

    /**
     * The module lives at `Healthy360\Customers\Guest\Models`, one level deeper
     * than the modular package's resolver expects, so the mapping is stated
     * rather than guessed.
     */
    protected static function newFactory(): GuestSessionFactory
    {
        return GuestSessionFactory::new();
    }
}
