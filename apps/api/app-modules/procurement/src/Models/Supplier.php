<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * @property string $id
 * @property string $organisation_id
 * @property string $code
 * @property string $name_en
 * @property string|null $currency_code
 * @property string|null $contact_email
 * @property string|null $contact_phone
 */
class Supplier extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
