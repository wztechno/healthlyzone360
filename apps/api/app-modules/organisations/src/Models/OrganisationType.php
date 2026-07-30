<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Models;

use Carbon\CarbonImmutable;
use Healthy360\Organisations\Database\Factories\OrganisationTypeFactory;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Platform-defined classification of organisations (clinic, kitchen, ...).
 *
 * @property string $id
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property bool $is_active
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class OrganisationType extends BaseModel
{
    /** @use HasFactory<OrganisationTypeFactory> */
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
     * @return HasMany<Organisation, $this>
     */
    public function organisations(): HasMany
    {
        return $this->hasMany(Organisation::class);
    }
}
