<?php

declare(strict_types=1);

namespace Healthy360\POS\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

class PosRegister extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
