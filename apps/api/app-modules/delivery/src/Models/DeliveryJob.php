<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

class DeliveryJob extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'assigned_at' => 'immutable_datetime',
            'delivered_at' => 'immutable_datetime',
        ];
    }
}
