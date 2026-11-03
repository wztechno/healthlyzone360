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
 * One shift's till count. Written through `DailyCloses`; the migration explains
 * what a shift is here.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $branch_id the till counted; null before tills were per branch
 * @property string $currency_code
 * @property CarbonImmutable $business_date
 * @property CarbonImmutable $opened_at
 * @property CarbonImmutable $closed_at
 * @property int $opening_float_minor
 * @property int $counter_cash_minor
 * @property int $handed_in_minor
 * @property int $cash_refunds_minor
 * @property int $expected_minor
 * @property int $counted_minor
 * @property int $variance_minor negative is short
 * @property string|null $variance_reason
 * @property string $recorded_by
 * @property string|null $signed_off_by
 * @property CarbonImmutable|null $signed_off_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'variance_reason')]
#[Classified(DataClassification::Internal, 'branch_id', 'currency_code', 'business_date', 'opened_at', 'closed_at', 'opening_float_minor', 'counter_cash_minor', 'handed_in_minor', 'cash_refunds_minor', 'expected_minor', 'counted_minor', 'variance_minor', 'recorded_by', 'signed_off_by', 'signed_off_at')]
class DailyClose extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'business_date' => 'immutable_date',
            'opened_at' => 'immutable_datetime',
            'closed_at' => 'immutable_datetime',
            'opening_float_minor' => 'integer',
            'counter_cash_minor' => 'integer',
            'handed_in_minor' => 'integer',
            'cash_refunds_minor' => 'integer',
            'expected_minor' => 'integer',
            'counted_minor' => 'integer',
            'variance_minor' => 'integer',
            'signed_off_at' => 'immutable_datetime',
        ];
    }
}
