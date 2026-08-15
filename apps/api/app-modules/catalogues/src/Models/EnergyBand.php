<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\EnergyBandFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The calorie bracket a plan configuration is portioned to.
 *
 * A bracket, never a per-person target: a single number would imply an energy
 * calculation this programme does not do and will not fabricate (§2.4).
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property int $min_kcal
 * @property int $max_kcal
 * @property int $display_order
 * @property bool $is_active
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'code', 'name_en', 'name_ar', 'min_kcal', 'max_kcal')]
class EnergyBand extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<EnergyBandFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'min_kcal' => 'integer',
            'max_kcal' => 'integer',
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
