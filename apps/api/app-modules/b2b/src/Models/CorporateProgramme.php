<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Database\Factories\CorporateProgrammeFactory;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A corporate buyer's standing arrangement with one seller kitchen (B1) — see
 * the migration for the isolation strategy and why `kitchen_organisation_id`
 * is denormalised.
 *
 * @property string $id
 * @property string $organisation_id the buyer
 * @property string $kitchen_organisation_id the single seller kitchen
 * @property string $b2b_agreement_id
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $description
 * @property string $status active | archived
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class CorporateProgramme extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<CorporateProgrammeFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'lock_version' => 'integer',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    /**
     * @return BelongsTo<Organisation, $this>
     */
    public function kitchenOrganisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class, 'kitchen_organisation_id');
    }

    /**
     * @return BelongsTo<B2bAgreement, $this>
     */
    public function agreement(): BelongsTo
    {
        return $this->belongsTo(B2bAgreement::class, 'b2b_agreement_id');
    }

    /**
     * @return HasMany<Quotation, $this>
     */
    public function quotations(): HasMany
    {
        return $this->hasMany(Quotation::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
