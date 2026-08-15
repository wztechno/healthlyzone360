<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\PlanDurationFactory;
use Healthy360\Catalogues\Enums\PlanDurationKind;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * How long a subscription runs for — or that it does not, because the customer
 * is buying it once.
 *
 * `duration_days` is NULL exactly when `duration_kind` is `one_off`, and the
 * database enforces the correspondence in both directions (§4.3). Nothing here
 * treats NULL as zero.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $code
 * @property PlanDurationKind $duration_kind
 * @property int|null $duration_days
 * @property string $name_en
 * @property string $name_ar
 * @property int $display_order
 * @property bool $is_active
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'code', 'name_en', 'name_ar', 'duration_days')]
class PlanDuration extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<PlanDurationFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'duration_kind' => PlanDurationKind::class,
            'duration_days' => 'integer',
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
