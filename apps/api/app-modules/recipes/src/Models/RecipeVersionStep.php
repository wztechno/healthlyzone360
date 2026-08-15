<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Models;

use Carbon\CarbonImmutable;
use Healthy360\Recipes\Database\Factories\RecipeVersionStepFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One instruction of a version's method.
 *
 * `UPDATED_AT` is null: the set is replaced wholesale by `setSteps`, so a step
 * row never changes after it is written.
 *
 * @property string $id
 * @property string $recipe_version_id
 * @property string $organisation_id
 * @property int $step_number
 * @property string $instruction_en
 * @property string|null $instruction_ar
 * @property int|null $minutes
 * @property CarbonImmutable|null $created_at
 */
#[Classified(DataClassification::Confidential, 'instruction_en', 'instruction_ar')]
class RecipeVersionStep extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<RecipeVersionStepFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'step_number' => 'integer',
            'minutes' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<RecipeVersion, $this>
     */
    public function version(): BelongsTo
    {
        return $this->belongsTo(RecipeVersion::class, 'recipe_version_id');
    }
}
