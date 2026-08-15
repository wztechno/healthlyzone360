<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\PlanVariantDurationFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Which runs one plan configuration may be bought for, and what the longer ones
 * take off the price.
 *
 * `discount_percent` is **not cast to a float and never defaulted to zero**: it
 * is a nullable decimal string, and NULL means nobody has stated a discount —
 * which is a different fact from stating that there is none.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_item_variant_id
 * @property string $plan_duration_id
 * @property string|null $discount_percent
 * @property bool $is_available
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'discount_percent')]
class PlanVariantDuration extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<PlanVariantDurationFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_available' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<CatalogueItemVariant, $this>
     */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(CatalogueItemVariant::class, 'catalogue_item_variant_id');
    }

    /**
     * @return BelongsTo<PlanDuration, $this>
     */
    public function duration(): BelongsTo
    {
        return $this->belongsTo(PlanDuration::class, 'plan_duration_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
