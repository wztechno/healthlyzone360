<?php

declare(strict_types=1);

namespace Healthy360\Identity\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Identity\Database\Factories\ContactPointFactory;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A destination a person can be reached at, and whether that has been proven.
 *
 * `value_normalised` is `Confidential` — it is personal data and is redacted
 * in logs — while `value_hash` is `Restricted`: it is a credential-shaped
 * derivative and must never leave the server, because publishing it would turn
 * the duplicate-detection index into an oracle for "does this address have an
 * account here".
 *
 * The owner is exactly one of `user_id` / `customer_account_id`, enforced by a
 * database CHECK rather than by this class. `customer_account_id` has no
 * relation declared here on purpose: the dependency edge runs Customers →
 * Identity, and a `belongsTo(CustomerAccount::class)` would reverse it.
 *
 * @property string $id
 * @property string|null $user_id
 * @property string|null $customer_account_id
 * @property ContactChannel $channel
 * @property string $value_normalised
 * @property string $value_hash
 * @property string|null $label
 * @property bool $is_login_identity
 * @property bool $is_primary
 * @property CarbonImmutable|null $verified_at
 * @property CarbonImmutable|null $retired_at
 * @property string $source
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read User|null $user
 */
#[Classified(DataClassification::Confidential, 'value_normalised', 'label')]
#[Classified(DataClassification::Restricted, 'value_hash')]
class ContactPoint extends BaseModel
{
    /** @use HasFactory<ContactPointFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'channel' => ContactChannel::class,
            'is_login_identity' => 'boolean',
            'is_primary' => 'boolean',
            'verified_at' => 'datetime',
            'retired_at' => 'datetime',
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
     * Whether this destination may currently be sent to and relied upon.
     *
     * A retired contact keeps its `verified_at` — it *was* proven, and the
     * tombstone policy needs to know that — so "verified" alone is not the
     * question anything downstream should ask.
     */
    public function isUsable(): bool
    {
        return $this->retired_at === null;
    }

    public function isVerified(): bool
    {
        return $this->verified_at !== null && $this->retired_at === null;
    }
}
