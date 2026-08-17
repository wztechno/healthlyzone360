<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One "we buy this from them" (§3.3) — a supplier and a shelf, and which of a
 * shelf's suppliers is the preferred one.
 *
 * Organisation-scoped in its own right rather than only through its supplier,
 * on the same terms as {@see SupplierContact}: the supplied-items section reads
 * these rows by supplier and slice 3's proposal will read them by stock item
 * across every supplier, so the column is carried rather than joined for.
 *
 * `supplier_item_ref` is the supplier's own catalogue reference, not this
 * kitchen's code — the string a purchase order quotes back so the person
 * picking the order recognises what was asked for.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $supplier_id
 * @property string $stock_item_id
 * @property bool $is_preferred
 * @property string|null $supplier_item_ref
 */
class SupplierStockItem extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'is_preferred' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Supplier, $this>
     */
    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    /**
     * @return BelongsTo<StockItem, $this>
     */
    public function stockItem(): BelongsTo
    {
        return $this->belongsTo(StockItem::class);
    }
}
