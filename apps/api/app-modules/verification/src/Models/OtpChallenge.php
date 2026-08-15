<?php

declare(strict_types=1);

namespace Healthy360\Verification\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Verification\Database\Factories\OtpChallengeFactory;
use Healthy360\Verification\Enums\OtpChallengeStatus;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A passcode in flight.
 *
 * `code_hash` is `Restricted`: it is a credential derivative, never returned by
 * an API, never logged, never placed in audit metadata. `destination_masked`
 * is `Confidential` rather than public — a mask is less than an address but
 * still says something about a person, and it belongs to the account that owns
 * the challenge.
 *
 * @property string $id
 * @property string $contact_point_id
 * @property string|null $user_id
 * @property string|null $customer_account_id
 * @property OtpPurpose $purpose
 * @property OtpChannel $channel
 * @property string $destination_masked
 * @property string $code_hash
 * @property OtpChallengeStatus $status
 * @property int $attempts
 * @property int $max_attempts
 * @property int $resend_count
 * @property int $max_resends
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $last_sent_at
 * @property CarbonImmutable|null $resend_available_at
 * @property CarbonImmutable|null $verified_at
 * @property CarbonImmutable|null $finished_at
 * @property string|null $request_ip_hash
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read ContactPoint|null $contactPoint
 */
#[Classified(DataClassification::Restricted, 'code_hash')]
#[Classified(DataClassification::Confidential, 'destination_masked', 'request_ip_hash')]
class OtpChallenge extends BaseModel
{
    /** @use HasFactory<OtpChallengeFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'purpose' => OtpPurpose::class,
            'channel' => OtpChannel::class,
            'status' => OtpChallengeStatus::class,
            'attempts' => 'integer',
            'max_attempts' => 'integer',
            'resend_count' => 'integer',
            'max_resends' => 'integer',
            'expires_at' => 'datetime',
            'last_sent_at' => 'datetime',
            'resend_available_at' => 'datetime',
            'verified_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<ContactPoint, $this>
     */
    public function contactPoint(): BelongsTo
    {
        return $this->belongsTo(ContactPoint::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Live *and* still inside its window.
     *
     * The status column alone is not the answer: expiry is a moment, not an
     * event, so a row can be `pending` and expired at the same time until
     * something writes the transition. Every read path asks this rather than
     * the column.
     */
    public function isLive(): bool
    {
        return $this->status->isLive() && $this->expires_at->isFuture();
    }

    public function attemptsRemaining(): int
    {
        return max(0, $this->max_attempts - $this->attempts);
    }

    public function resendsRemaining(): int
    {
        return max(0, $this->max_resends - $this->resend_count);
    }
}
