<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Database\Factories\QuotationFactory;
use Healthy360\B2b\Enums\QuotationStatus;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One round of "what would this cost" against a corporate programme (B3, B5)
 * — see the migration for the state machine and the isolation strategy.
 *
 * @property string $id
 * @property string $organisation_id the buyer
 * @property string $corporate_programme_id
 * @property string $reference
 * @property QuotationStatus $status
 * @property string $currency_code
 * @property string|null $notes
 * @property string|null $decline_reason
 * @property CarbonImmutable|null $submitted_at
 * @property CarbonImmutable|null $quoted_at
 * @property CarbonImmutable|null $expires_at
 * @property CarbonImmutable|null $decided_at
 * @property string|null $submitted_by
 * @property string|null $quoted_by
 * @property string|null $decided_by
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class Quotation extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<QuotationFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => QuotationStatus::class,
            'lock_version' => 'integer',
            'submitted_at' => 'immutable_datetime',
            'quoted_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'decided_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<CorporateProgramme, $this>
     */
    public function programme(): BelongsTo
    {
        return $this->belongsTo(CorporateProgramme::class, 'corporate_programme_id');
    }

    /**
     * @return HasMany<QuotationLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(QuotationLine::class)->orderBy('line_number');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function submitter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function quoter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'quoted_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function decider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by');
    }
}
