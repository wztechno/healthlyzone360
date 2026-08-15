<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

class PurchaseOrder extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
