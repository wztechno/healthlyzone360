<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Customers\Closure\Enums\ClosureReasonCode;
use Healthy360\Customers\Closure\Enums\ClosureRequestStatus;
use Healthy360\Customers\Closure\Enums\ClosureScope;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Verification\Models\OtpChallenge;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * Somebody's request to be let go of.
 *
 * **Deliberately not `OrganisationScoped`.** A closing identity may hold no
 * organisation at all (a consumer), or memberships in several (a person who
 * cooks for two kitchens), and a fail-closed org scope would hide the request
 * from the very sweep meant to finalise it. Access is through the owning user,
 * which is the only relationship this row has that is always true.
 *
 * `reason_note` is `Confidential`: it is the one field on this table a human
 * being writes in their own words, at a moment when people say more than they
 * mean to. It is never placed in audit metadata and is deleted at finalisation.
 *
 * @property string $id
 * @property string $user_id
 * @property string|null $customer_account_id
 * @property ClosureReasonCode $reason_code
 * @property string|null $reason_note
 * @property ClosureScope $scope
 * @property ClosureRequestStatus $status
 * @property string|null $otp_challenge_id
 * @property string|null $initiated_by_user_id
 * @property CarbonImmutable $requested_at
 * @property CarbonImmutable|null $verified_at
 * @property CarbonImmutable|null $scheduled_for
 * @property CarbonImmutable|null $completed_at
 * @property CarbonImmutable|null $cancelled_at
 * @property string|null $cancelled_because
 * @property array<int, array<string, mixed>> $blockers
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read User|null $user
 * @property-read CustomerAccount|null $customerAccount
 * @property-read OtpChallenge|null $challenge
 * @property-read ClosedAccountTombstone|null $tombstone
 */
#[Classified(DataClassification::Confidential, 'reason_note')]
class AccountClosureRequest extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'reason_code' => ClosureReasonCode::class,
            'scope' => ClosureScope::class,
            'status' => ClosureRequestStatus::class,
            'requested_at' => 'datetime',
            'verified_at' => 'datetime',
            'scheduled_for' => 'datetime',
            'completed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'blockers' => 'array',
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
     * @return BelongsTo<CustomerAccount, $this>
     */
    public function customerAccount(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class);
    }

    /**
     * The challenge this request was proven with.
     *
     * Named `challenge` rather than `otpChallenge` because the column already
     * says what kind it is, and because the closure service reads it to assert
     * *this* request's proof — the binding that stops a code issued for one
     * closure finalising another.
     *
     * **Resolves to null once the closure has completed**, and that is correct
     * rather than broken: the challenge is personal data and is erased with
     * everything else, while the identifier stays on this row as the permanent
     * record of what proved it. The column carries no foreign key for exactly
     * that reason — the migration's docblock has the argument.
     *
     * @return BelongsTo<OtpChallenge, $this>
     */
    public function challenge(): BelongsTo
    {
        return $this->belongsTo(OtpChallenge::class, 'otp_challenge_id');
    }

    /**
     * @return HasOne<ClosedAccountTombstone, $this>
     */
    public function tombstone(): HasOne
    {
        return $this->hasOne(ClosedAccountTombstone::class, 'closure_request_id');
    }

    /**
     * Whether the window has run out and finalisation may proceed.
     *
     * A request with no scheduled moment is not due — it has not been verified
     * yet — which is why the null case answers false rather than treating an
     * absent deadline as an elapsed one.
     */
    public function isDue(?CarbonImmutable $now = null): bool
    {
        if ($this->status !== ClosureRequestStatus::Scheduled) {
            return false;
        }

        return $this->scheduled_for !== null
            && $this->scheduled_for->lessThanOrEqualTo($now ?? CarbonImmutable::now());
    }

    /**
     * Whether support opened this on the customer's behalf.
     */
    public function isSupportInitiated(): bool
    {
        return $this->initiated_by_user_id !== null;
    }
}
