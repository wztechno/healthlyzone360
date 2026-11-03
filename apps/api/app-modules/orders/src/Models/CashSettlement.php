<?php

declare(strict_types=1);

namespace Healthy360\Orders\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * One hand-in of cash from the road. Written through `CashSettlements`; the
 * migration explains why one table serves drivers and couriers.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $kind `driver` | `courier`
 * @property string|null $driver_user_id
 * @property string|null $courier_name
 * @property string|null $branch_id the till it went into; null before tills were per branch
 * @property string $currency_code
 * @property int $expected_minor
 * @property int $fee_minor
 * @property int $expense_minor couriers' fees on prepaid runs, a kitchen expense
 * @property int $handed_in_minor
 * @property int $short_minor
 * @property string|null $short_reason
 * @property string $recorded_by
 * @property CarbonImmutable $recorded_at
 * @property string|null $signed_off_by
 * @property CarbonImmutable|null $signed_off_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'short_reason')]
#[Classified(DataClassification::Internal, 'kind', 'driver_user_id', 'courier_name', 'branch_id', 'currency_code', 'expected_minor', 'fee_minor', 'expense_minor', 'handed_in_minor', 'short_minor', 'recorded_by', 'recorded_at', 'signed_off_by', 'signed_off_at')]
class CashSettlement extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expected_minor' => 'integer',
            'fee_minor' => 'integer',
            'expense_minor' => 'integer',
            'handed_in_minor' => 'integer',
            'short_minor' => 'integer',
            'recorded_at' => 'immutable_datetime',
            'signed_off_at' => 'immutable_datetime',
        ];
    }
}
