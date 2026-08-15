<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Database\Factories\IngredientCategoryFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A node of the two-level ingredient classification. Rows with
 * organisation_id NULL are the platform library and stay visible in every
 * tenant context — the `roles` pattern.
 *
 * @property string $id
 * @property string|null $organisation_id null = platform library
 * @property string|null $parent_id null = top level
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property int $display_order
 * @property bool $is_active
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'code', 'name_en', 'name_ar')]
class IngredientCategory extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<IngredientCategoryFactory> */
    use HasFactory;

    public function organisationScopeAllowsNull(): bool
    {
        return true;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'display_order' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<IngredientCategory, $this>
     */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /**
     * @return HasMany<IngredientCategory, $this>
     */
    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isPlatformRow(): bool
    {
        return $this->organisation_id === null;
    }
}
