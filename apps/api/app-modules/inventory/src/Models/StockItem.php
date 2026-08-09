<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Support\Carbon;

/**
 * A warehouse item a kitchen stocks.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $code
 * @property string $name_en
 * @property string $unit_code free-text, kept alongside the real `unit_id` until a later slice reworks the write surface
 * @property string|null $unit_id FK to measurement_units (INV1.0)
 * @property string|null $ingredient_id
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class StockItem extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
