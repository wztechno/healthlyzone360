<?php

declare(strict_types=1);

namespace Healthy360\POS\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * @property string $id
 * @property string $organisation_id
 * @property string $pos_shift_id
 * @property string $currency_code
 * @property int $total_minor
 * @property string $payment_method_kind
 * @property string $status
 */
class PosTransaction extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return ['total_minor' => 'integer'];
    }
}
