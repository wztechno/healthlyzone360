<?php

declare(strict_types=1);

namespace Healthy360\Features\Models;

use Carbon\CarbonImmutable;
use Healthy360\Features\Database\Factories\FeatureDefinitionFactory;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Platform-global feature catalogue entry.
 *
 * @property string $id
 * @property string $code e.g. feature.two_factor_enforcement
 * @property string $name_en
 * @property string $name_ar
 * @property string $description
 * @property bool $is_active
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class FeatureDefinition extends BaseModel
{
    /** @use HasFactory<FeatureDefinitionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return HasMany<FeatureEntitlement, $this>
     */
    public function entitlements(): HasMany
    {
        return $this->hasMany(FeatureEntitlement::class);
    }
}
