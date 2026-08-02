<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\MealCombinationOptionFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Which meals of the day a plan delivers. A kitchen's own vocabulary — there is
 * no platform library, because "full board" means what each kitchen sells.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property bool $includes_breakfast
 * @property bool $includes_lunch
 * @property bool $includes_dinner
 * @property int $meals_per_day
 * @property int $display_order
 * @property bool $is_active
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'code', 'name_en', 'name_ar')]
class MealCombinationOption extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<MealCombinationOptionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'includes_breakfast' => 'boolean',
            'includes_lunch' => 'boolean',
            'includes_dinner' => 'boolean',
            'meals_per_day' => 'integer',
            'display_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
