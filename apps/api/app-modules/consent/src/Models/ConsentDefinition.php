<?php

declare(strict_types=1);

namespace Healthy360\Consent\Models;

use Carbon\CarbonImmutable;
use Healthy360\Consent\Database\Factories\ConsentDefinitionFactory;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Versioned consent text; each (code, version) pair is immutable once
 * granted against.
 *
 * @property string $id
 * @property string $code
 * @property int $version
 * @property string $purpose
 * @property string $audience
 * @property bool $is_required
 * @property int $display_order
 * @property string $body_en
 * @property string $body_ar
 * @property bool $is_active
 * @property CarbonImmutable|null $created_at
 */
class ConsentDefinition extends BaseModel
{
    /** @use HasFactory<ConsentDefinitionFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'is_active' => 'boolean',
            'is_required' => 'boolean',
            'display_order' => 'integer',
        ];
    }

    /**
     * @return HasMany<ConsentGrant, $this>
     */
    public function grants(): HasMany
    {
        return $this->hasMany(ConsentGrant::class);
    }
}
