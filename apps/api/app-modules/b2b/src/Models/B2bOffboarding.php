<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A corporate relationship ending — **shell; B2 owns the behaviour**.
 *
 * No service constructs or transitions one in B1. The model exists so the
 * shape is reviewable alongside the agreement it ends, and so B2 is additive.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $b2b_agreement_id
 * @property OffboardingStatus $status
 * @property string|null $reason
 * @property string|null $reason_note
 * @property string|null $requested_by
 * @property CarbonImmutable $requested_at
 * @property int|null $notice_period_days
 * @property CarbonImmutable|null $notice_served_at
 * @property CarbonImmutable|null $effective_on
 * @property string|null $settlement_note
 * @property CarbonImmutable|null $signed_off_at
 * @property string|null $signed_off_by
 * @property CarbonImmutable|null $revocation_started_at
 * @property int|null $memberships_revoked
 * @property CarbonImmutable|null $completed_at
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'reason', 'reason_note', 'settlement_note')]
class B2bOffboarding extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => OffboardingStatus::class,
            'notice_period_days' => 'integer',
            'memberships_revoked' => 'integer',
            'lock_version' => 'integer',
            'requested_at' => 'immutable_datetime',
            'notice_served_at' => 'immutable_datetime',
            'effective_on' => 'immutable_date',
            'signed_off_at' => 'immutable_datetime',
            'revocation_started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Organisation, $this>
     */
    public function organisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class);
    }

    /**
     * @return BelongsTo<B2bAgreement, $this>
     */
    public function agreement(): BelongsTo
    {
        return $this->belongsTo(B2bAgreement::class, 'b2b_agreement_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    /**
     * @return HasMany<RecordExport, $this>
     */
    public function exports(): HasMany
    {
        return $this->hasMany(RecordExport::class, 'b2b_offboarding_id');
    }
}
