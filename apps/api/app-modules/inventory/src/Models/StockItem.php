<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Healthy360\Inventory\Services\StockItemDerivationService;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Support\Carbon;

/**
 * A warehouse item a kitchen stocks.
 *
 * Derived, not declared (INV2.0): one row per ingredient in the library and one
 * per bought-in product, kept in step by
 * {@see StockItemDerivationService}. Nothing
 * hand-creates a stock item any more.
 *
 * `ingredient_id` is what the row costs itself by and is always set on a derived
 * row; `catalogue_item_id` is set as well when the thing on the shelf is a
 * product the kitchen resells, and is what tells the two books apart.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $code
 * @property string $name_en
 * @property string $unit_code free-text, kept alongside the real `unit_id` until a later slice reworks the write surface
 * @property string|null $unit_id FK to measurement_units (INV1.0)
 * @property string|null $ingredient_id the cost anchor — set on every derived row, resold products included
 * @property string|null $catalogue_item_id set when this shelf is a resold product (INV2.0)
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class StockItem extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
