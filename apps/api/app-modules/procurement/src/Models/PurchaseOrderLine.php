<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One shelf on one purchase order, with everything the sheet prints frozen onto
 * it (§3.5).
 *
 * **Not `OrganisationScoped`, and that is the ADR-0007 decision rather than an
 * omission.** A line has no `organisation_id` column: it is never read on its
 * own, every query for one starts from its purchase order, and the order carries
 * the explicit column. Scoping through the parent is the same choice
 * `goods_receipt_lines` made — and the opposite of `SupplierStockItem`, which is
 * read directly and in bulk by stock item and therefore carries its own. Every
 * service reading these rows must reach them through a `PurchaseOrder` that has
 * already passed the tenant scope; a `PurchaseOrderLine::find($id)` is a tenancy
 * hole and there is deliberately no relation or query helper that invites one.
 *
 * `item_code`, `item_name_en`, `item_name_ar` and `unit_code` are **snapshots**,
 * not projections of the shelf: they are what the supplier was handed, and they
 * stay what the supplier was handed after somebody renames the ingredient. The
 * `stockItem()` relation below is a pointer for slice 5's receipt matching,
 * never the source of a displayed label.
 *
 * No price, no amount, no currency — §3.5, and a structural test keeps it that
 * way.
 *
 * @property string $id
 * @property string $purchase_order_id
 * @property string $stock_item_id
 * @property string $quantity a decimal string at scale 4, never a float
 * @property string|null $unit_id
 * @property string $unit_code
 * @property string $item_code
 * @property string $item_name_en
 * @property string|null $item_name_ar
 * @property string|null $supplier_item_ref
 * @property string|null $notes
 * @property int $display_order
 * @property-read PurchaseOrder|null $purchaseOrder
 */
class PurchaseOrderLine extends BaseModel
{
    protected function casts(): array
    {
        return [
            'display_order' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<PurchaseOrder, $this>
     */
    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class);
    }

    /**
     * The shelf this line points at — a pointer, not the label's source.
     *
     * Slice 5 matches a receipt line to an order line through it. Nothing that
     * renders reads it: the four display columns beside it are the frozen truth
     * of the document.
     *
     * @return BelongsTo<StockItem, $this>
     */
    public function stockItem(): BelongsTo
    {
        return $this->belongsTo(StockItem::class);
    }
}
