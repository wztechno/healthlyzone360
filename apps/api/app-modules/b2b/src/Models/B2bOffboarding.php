<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Enums\OffboardingStatus;
use Healthy360\B2b\Enums\OffboardingTrigger;
use Healthy360\B2b\Enums\SettlementStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A corporate relationship ending.
 *
 * B1 shipped this as a shell and said B2 owned the behaviour; it does now.
 * `OffboardingService` is the only thing that transitions one, and every
 * transition it makes is checked against `OffboardingStatus::allowedTransitions()`
 * before it is written.
 *
 * The sign-off block mirrors `B2bAgreement`'s signature block deliberately
 * rather than sharing it. Both are click-wrap evidence and both must record
 * the same five things, but an agreement is signed by an incoming buyer and an
 * offboarding is signed off by an outgoing one, and a shared parent would tie
 * two lifecycles together that only happen to look alike.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $b2b_agreement_id
 * @property OffboardingStatus $status
 * @property OffboardingTrigger|null $trigger
 * @property string|null $reason
 * @property string|null $reason_note
 * @property string|null $requested_by
 * @property CarbonImmutable $requested_at
 * @property int|null $notice_period_days
 * @property CarbonImmutable|null $notice_served_at
 * @property CarbonImmutable|null $effective_on
 * @property string|null $settlement_note
 * @property SettlementStatus $settlement_status
 * @property list<array{check: string, outcome: string, reason: string|null, detail: string|null}>|null $settlement_checks
 * @property CarbonImmutable|null $settlement_started_at
 * @property CarbonImmutable|null $settlement_resolved_at
 * @property string|null $settlement_waived_by
 * @property string|null $settlement_waiver_reason
 * @property CarbonImmutable|null $awaiting_signoff_at
 * @property CarbonImmutable|null $signed_off_at
 * @property string|null $signed_off_by
 * @property string|null $signoff_challenge_id
 * @property string|null $signoff_signatory_name
 * @property string|null $signoff_signatory_title
 * @property string|null $signoff_document_sha256
 * @property string|null $signoff_consent_statement
 * @property string|null $signoff_ip_hash
 * @property string|null $signoff_user_agent_hash
 * @property CarbonImmutable|null $revocation_started_at
 * @property int|null $memberships_revoked
 * @property CarbonImmutable|null $revocation_completed_at
 * @property int|null $tokens_deleted
 * @property CarbonImmutable|null $archiving_started_at
 * @property array<string, int>|null $archive_summary
 * @property CarbonImmutable|null $completed_at
 * @property CarbonImmutable|null $cancelled_at
 * @property string|null $cancelled_by
 * @property string|null $cancellation_reason
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'reason', 'reason_note', 'settlement_note', 'settlement_waiver_reason', 'cancellation_reason')]
#[Classified(DataClassification::Confidential, 'signoff_signatory_name', 'signoff_ip_hash', 'signoff_user_agent_hash')]
class B2bOffboarding extends BaseModel
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => OffboardingStatus::class,
            'trigger' => OffboardingTrigger::class,
            'settlement_status' => SettlementStatus::class,
            'settlement_checks' => 'array',
            'archive_summary' => 'array',
            'notice_period_days' => 'integer',
            'memberships_revoked' => 'integer',
            'tokens_deleted' => 'integer',
            'lock_version' => 'integer',
            'requested_at' => 'immutable_datetime',
            'notice_served_at' => 'immutable_datetime',
            'effective_on' => 'immutable_date',
            'settlement_started_at' => 'immutable_datetime',
            'settlement_resolved_at' => 'immutable_datetime',
            'awaiting_signoff_at' => 'immutable_datetime',
            'signed_off_at' => 'immutable_datetime',
            'revocation_started_at' => 'immutable_datetime',
            'revocation_completed_at' => 'immutable_datetime',
            'archiving_started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
        ];
    }

    /**
     * Whether sign-off evidence is complete — the same rule the database
     * CHECK states, expressed once more in PHP so the service can refuse
     * before the write rather than surface a constraint violation.
     */
    public function hasSignoffEvidence(): bool
    {
        return $this->signoff_challenge_id !== null
            && $this->signoff_signatory_name !== null
            && $this->signoff_consent_statement !== null;
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
