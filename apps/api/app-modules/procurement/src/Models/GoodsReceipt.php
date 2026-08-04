<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

class GoodsReceipt extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return ['received_at' => 'immutable_datetime'];
    }
}
