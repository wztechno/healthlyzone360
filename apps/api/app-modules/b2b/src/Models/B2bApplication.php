<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Database\Factories\B2bApplicationFactory;
use Healthy360\B2b\Enums\ApplicationSection;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Enums\PaymentTerms;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A company's request to become a corporate buyer.
 *
 * **Not an `OrganisationScoped` model, and it never will be.** Every other
 * business record in the platform belongs to a tenant; this one exists in
 * order that a tenant may. There is no `BelongsToOrganisation` trait here and
 * no global scope, so the service is the only boundary — which is why every
 * method on `ApplicationService` takes an explicit actor rather than reading
 * one from a context that would be empty.
 *
 * Classified `Confidential`: a legal name, a registration number and a
 * signatory's contact details are a company's and a person's identity, and the
 * redaction rules key off this declaration.
 *
 * @property string $id
 * @property string $reference
 * @property string $applicant_user_id
 * @property ApplicationStatus $status
 * @property string|null $legal_name
 * @property string|null $legal_name_ar
 * @property string|null $trading_name
 * @property string|null $business_type
 * @property string|null $country_code
 * @property string|null $commercial_registration_number
 * @property string|null $commercial_registration_normalised
 * @property string|null $tax_registration_number
 * @property string|null $tax_registration_normalised
 * @property CarbonImmutable|null $incorporated_on
 * @property string|null $website
 * @property string|null $signatory_name
 * @property string|null $signatory_title
 * @property string|null $signatory_email
 * @property string|null $signatory_phone
 * @property PaymentTerms|null $requested_payment_terms
 * @property int|null $requested_credit_limit_minor
 * @property string|null $currency_code
 * @property string|null $expected_volume_band
 * @property string|null $expected_order_frequency
 * @property list<string>|null $product_categories
 * @property string|null $preferred_delivery_window
 * @property int|null $lead_time_days
 * @property bool $requires_invoice_per_location
 * @property string|null $delivery_notes
 * @property list<string> $completed_sections
 * @property CarbonImmutable|null $submitted_at
 * @property CarbonImmutable|null $review_started_at
 * @property string|null $reviewed_by
 * @property CarbonImmutable|null $decided_at
 * @property string|null $decision_note
 * @property string|null $applicant_message
 * @property CarbonImmutable|null $information_requested_at
 * @property string|null $information_request
 * @property list<string>|null $information_requested_sections
 * @property CarbonImmutable|null $withdrawn_at
 * @property string|null $duplicate_of_application_id
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(
    DataClassification::Confidential,
    'legal_name',
    'legal_name_ar',
    'trading_name',
    'commercial_registration_number',
    'tax_registration_number',
    'signatory_name',
    'signatory_email',
    'signatory_phone',
)]
class B2bApplication extends BaseModel
{
    /** @use HasFactory<B2bApplicationFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => ApplicationStatus::class,
            'requested_payment_terms' => PaymentTerms::class,
            'incorporated_on' => 'immutable_date',
            'product_categories' => 'array',
            'completed_sections' => 'array',
            'information_requested_sections' => 'array',
            'requires_invoice_per_location' => 'boolean',
            'requested_credit_limit_minor' => 'integer',
            'lead_time_days' => 'integer',
            'lock_version' => 'integer',
            'submitted_at' => 'immutable_datetime',
            'review_started_at' => 'immutable_datetime',
            'decided_at' => 'immutable_datetime',
            'information_requested_at' => 'immutable_datetime',
            'withdrawn_at' => 'immutable_datetime',
        ];
    }

    /**
     * The sections the applicant may write to right now.
     *
     * In `draft`, all of them. In `info_requested`, only the ones the reviewer
     * named — the narrowing is the point of the state, and an empty or absent
     * list means the reviewer asked for documents rather than for answers.
     *
     * @return list<ApplicationSection>
     */
    public function writableSections(): array
    {
        if ($this->status === ApplicationStatus::Draft) {
            return ApplicationSection::cases();
        }

        if ($this->status !== ApplicationStatus::InfoRequested) {
            return [];
        }

        $named = $this->information_requested_sections ?? [];

        return array_values(array_filter(
            array_map(ApplicationSection::tryFrom(...), $named),
        ));
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function applicant(): BelongsTo
    {
        return $this->belongsTo(User::class, 'applicant_user_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    /**
     * @return BelongsTo<self, $this>
     */
    public function duplicateOf(): BelongsTo
    {
        return $this->belongsTo(self::class, 'duplicate_of_application_id');
    }

    /**
     * @return HasMany<B2bApplicationContact, $this>
     */
    public function contacts(): HasMany
    {
        return $this->hasMany(B2bApplicationContact::class);
    }

    /**
     * @return HasMany<B2bApplicationLocation, $this>
     */
    public function locations(): HasMany
    {
        return $this->hasMany(B2bApplicationLocation::class);
    }

    /**
     * @return HasMany<KycDocument, $this>
     */
    public function documents(): HasMany
    {
        return $this->hasMany(KycDocument::class);
    }

    /**
     * @return HasMany<B2bAgreement, $this>
     */
    public function agreements(): HasMany
    {
        return $this->hasMany(B2bAgreement::class);
    }
}
