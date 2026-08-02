<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Database\Factories\B2bAgreementFactory;
use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\PaymentTerms;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One version of the terms between the platform and a corporate buyer.
 *
 * Classified `Confidential`: the credit limit and the price list this points
 * at are a negotiated commercial position, which K1.5 established is the most
 * competitively sensitive thing the platform stores.
 *
 * The signature attributes are click-wrap evidence. `hasSignatureEvidence()`
 * is the same rule the database CHECK enforces, expressed once more in PHP so
 * the service can refuse before the write rather than surface a constraint
 * violation — belt and braces, and the braces are the database's.
 *
 * @property string $id
 * @property string $b2b_application_id
 * @property int $version
 * @property string|null $supersedes_agreement_id
 * @property AgreementStatus $status
 * @property string $title
 * @property string|null $currency_code
 * @property string|null $price_list_id
 * @property PaymentTerms|null $payment_terms
 * @property int|null $credit_limit_minor
 * @property int|null $minimum_order_minor
 * @property int|null $delivery_lead_time_days
 * @property int|null $notice_period_days
 * @property CarbonImmutable|null $starts_on
 * @property CarbonImmutable|null $ends_on
 * @property bool $auto_renews
 * @property string|null $terms_summary
 * @property string|null $signature_document_sha256
 * @property string|null $signatory_name
 * @property string|null $signatory_title
 * @property string|null $signatory_user_id
 * @property string|null $signature_consent_statement
 * @property string|null $signature_ip_hash
 * @property string|null $signature_user_agent_hash
 * @property string|null $signature_otp_challenge_id
 * @property CarbonImmutable|null $signed_at
 * @property CarbonImmutable|null $activated_at
 * @property CarbonImmutable|null $suspended_at
 * @property CarbonImmutable|null $terminated_at
 * @property string|null $termination_reason
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'credit_limit_minor', 'minimum_order_minor', 'signatory_name', 'terms_summary')]
class B2bAgreement extends BaseModel
{
    /** @use HasFactory<B2bAgreementFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => AgreementStatus::class,
            'payment_terms' => PaymentTerms::class,
            'version' => 'integer',
            'credit_limit_minor' => 'integer',
            'minimum_order_minor' => 'integer',
            'delivery_lead_time_days' => 'integer',
            'notice_period_days' => 'integer',
            'auto_renews' => 'boolean',
            'lock_version' => 'integer',
            'starts_on' => 'immutable_date',
            'ends_on' => 'immutable_date',
            'signed_at' => 'immutable_datetime',
            'activated_at' => 'immutable_datetime',
            'suspended_at' => 'immutable_datetime',
            'terminated_at' => 'immutable_datetime',
        ];
    }

    /**
     * Whether this row carries everything a click-wrap acceptance has to
     * carry to be worth anything: which bytes, who, in what capacity, and the
     * wording they agreed to.
     */
    public function hasSignatureEvidence(): bool
    {
        return $this->signature_document_sha256 !== null
            && $this->signatory_name !== null
            && $this->signatory_title !== null
            && $this->signature_consent_statement !== null;
    }

    public function isEditable(): bool
    {
        return $this->status->isEditable();
    }

    /**
     * @return BelongsTo<B2bApplication, $this>
     */
    public function application(): BelongsTo
    {
        return $this->belongsTo(B2bApplication::class, 'b2b_application_id');
    }

    /**
     * @return BelongsTo<self, $this>
     */
    public function supersedes(): BelongsTo
    {
        return $this->belongsTo(self::class, 'supersedes_agreement_id');
    }

    /**
     * @return BelongsTo<PriceList, $this>
     */
    public function priceList(): BelongsTo
    {
        return $this->belongsTo(PriceList::class, 'price_list_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function signatory(): BelongsTo
    {
        return $this->belongsTo(User::class, 'signatory_user_id');
    }
}
