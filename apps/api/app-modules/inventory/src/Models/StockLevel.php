<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A branch's running quantity of one stock item.
 *
 * Organisation-scoped since INV1.0: the table used to carry no organisation at
 * all, so a query that forgot its branch filter could read another kitchen's
 * quantities. `BelongsToOrganisation` fails closed like every other scoped
 * model, and the balance read-modify-write in `InventoryService` runs under a
 * row lock so two concurrent movements cannot lose each other's delta.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string $stock_item_id
 * @property numeric-string $quantity
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class StockLevel extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return ['quantity' => 'decimal:4'];
    }

    /**
     * @return BelongsTo<StockItem, $this>
     */
    public function stockItem(): BelongsTo
    {
        return $this->belongsTo(StockItem::class);
    }
}
