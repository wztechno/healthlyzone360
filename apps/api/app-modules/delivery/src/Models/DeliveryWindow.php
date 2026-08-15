<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Delivery\Database\Factories\DeliveryWindowFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A named delivery slot — the thing a customer picks at checkout.
 *
 * `weekdays` is an ISO array (1 = Monday … 7 = Sunday) and **`[]` means every
 * day**. The empty array is the common case and is stored rather than
 * inferred, so nothing downstream has to distinguish "unset" from
 * "unrestricted".
 *
 * `starts_at` / `ends_at` are clock faces held as `H:i:s` strings rather than
 * cast to dates. A `time` column carried through Eloquent's datetime cast
 * would acquire today's date and a timezone on the way out, which is precisely
 * the confusion the column type exists to avoid: 18:00 means 18:00 wherever
 * the branch is.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $starts_at
 * @property string|null $ends_at
 * @property list<int> $weekdays
 * @property int $display_order
 * @property bool $is_active
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'code', 'name_en', 'name_ar')]
class DeliveryWindow extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<DeliveryWindowFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'weekdays' => 'array',
            'display_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    /**
     * Whether the window runs on the given ISO weekday. An empty `weekdays`
     * runs every day — the one place that convention is read, so nothing else
     * has to remember it.
     */
    public function runsOn(int $isoWeekday): bool
    {
        return $this->weekdays === [] || in_array($isoWeekday, $this->weekdays, true);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
