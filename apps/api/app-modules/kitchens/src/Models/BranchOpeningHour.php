<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Models;

use Carbon\CarbonImmutable;
use Healthy360\Kitchens\Database\Factories\BranchOpeningHourFactory;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One weekday of one branch's operating week.
 *
 * A **closed day is a row** with both times null, not a missing row: "we are
 * shut on Sunday" and "nobody has filled in Sunday" are different facts, and a
 * checkout that cannot tell them apart cannot explain why it refused a date.
 *
 * Times are clock faces held as `H:i:s` strings, read in the branch's own
 * timezone. Casting them to datetimes would attach today's date and the
 * application timezone to a value whose whole point is that it has neither.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property int $weekday
 * @property string|null $opens_at
 * @property string|null $closes_at
 * @property string|null $order_cut_off_at
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'weekday', 'opens_at', 'closes_at')]
class BranchOpeningHour extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<BranchOpeningHourFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'weekday' => 'integer',
        ];
    }

    /**
     * Whether the branch trades at all on this day. The one place the
     * "both null means closed" convention is read.
     */
    public function isOpen(): bool
    {
        return $this->opens_at !== null;
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }
}
