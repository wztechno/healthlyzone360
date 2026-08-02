<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Recipes\Database\Factories\RecipeFactory;
use Healthy360\Recipes\Enums\RecipeConfidentiality;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The stable identity of a recipe. Everything that changes lives on a version.
 *
 * Classified `Confidential`, not `Internal` like an ingredient: even the name
 * of a formulation is commercial information, and there is no platform library
 * of recipes for the classification to have to straddle — a recipe belongs to
 * exactly one organisation, always.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $branch_id
 * @property string $slug
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $recipe_category
 * @property string|null $source_kind
 * @property RecipeConfidentiality $confidentiality
 * @property RecipeStatus $status
 * @property string|null $notes
 * @property string|null $source_system
 * @property string|null $source_ref
 * @property CarbonImmutable|null $seeded_at
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'slug', 'name_en', 'name_ar', 'notes', 'recipe_category', 'source_kind', 'source_system', 'source_ref')]
class Recipe extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<RecipeFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'confidentiality' => RecipeConfidentiality::class,
            'status' => RecipeStatus::class,
            'seeded_at' => 'immutable_datetime',
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return HasMany<RecipeVersion, $this>
     */
    public function versions(): HasMany
    {
        return $this->hasMany(RecipeVersion::class);
    }

    /**
     * The published version, if there is one.
     *
     * A query rather than a `current_version_id` column on purpose: the
     * partial unique index guarantees at most one row satisfies this, so the
     * question always has exactly one answer and there is no pointer to fall
     * out of step with the versions themselves.
     *
     * @return HasMany<RecipeVersion, $this>
     */
    public function publishedVersions(): HasMany
    {
        return $this->versions()->where('status', RecipeVersionStatus::Published->value);
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
