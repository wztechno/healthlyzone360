<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * One order an accepted quotation placed — see the table's migration.
 *
 * @property string $id
 * @property string $organisation_id the buyer
 * @property string $quotation_id
 * @property string $order_id
 * @property int $sequence
 * @property CarbonImmutable $delivery_date
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class QuotationOrder extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'sequence' => 'integer',
            'delivery_date' => 'immutable_date',
        ];
    }
}
