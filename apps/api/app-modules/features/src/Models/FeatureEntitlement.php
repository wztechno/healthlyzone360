<?php

declare(strict_types=1);

namespace Healthy360\Features\Models;

use Carbon\CarbonImmutable;
use Healthy360\Features\Database\Factories\FeatureEntitlementFactory;
use Healthy360\Features\Enums\EntitlementStatus;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An organisation's entitlement to a feature, optionally time-bound.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $feature_definition_id
 * @property EntitlementStatus $status
 * @property CarbonImmutable|null $starts_at
 * @property CarbonImmutable|null $expires_at
 * @property string|null $created_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class FeatureEntitlement extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<FeatureEntitlementFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => EntitlementStatus::class,
            'starts_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<FeatureDefinition, $this>
     */
    public function definition(): BelongsTo
    {
        return $this->belongsTo(FeatureDefinition::class, 'feature_definition_id');
    }
}
