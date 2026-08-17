<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Carbon\CarbonImmutable;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One shelf on one delivery, with what it actually cost (§3.6).
 *
 * **`costed_at` is the guard against costing a quantity twice.** It is stamped
 * when the line's money is settled — the blend went through, or there was no
 * ingredient for it to blend into — and price completion acts only on lines
 * where it is still null. `valuation_pending_fx` is the third state: the price
 * is recorded exactly as the supplier wrote it, and the blend was refused
 * because the ingredient's valuation is held in another currency. Receiving is
 * never lost to that; the flag is what stops the system claiming a valuation it
 * did not perform.
 *
 * `purchase_order_line_id` is how a partial delivery accumulates against the
 * right ordered line. Null for a direct purchase and for an unplanned extra item
 * on an ordered delivery, both of which §4 treats as ordinary.
 *
 * Not `OrganisationScoped`, unchanged: a line is reached through its receipt,
 * which carries the explicit column.
 *
 * @property string $id
 * @property string $goods_receipt_id
 * @property string $stock_item_id
 * @property string|null $purchase_order_line_id the ordered line this delivery fulfils, when there was one
 * @property numeric-string $quantity
 * @property string|null $unit_id the unit the price is quoted per
 * @property numeric-string|null $unit_price_amount major currency units per unit_id (INV1.1)
 * @property numeric-string|null $line_total_amount major currency units (INV1.1)
 * @property string|null $cost_currency_code
 * @property CarbonImmutable|null $costed_at null means the costing path has not run for this line (§3.6)
 * @property bool $valuation_pending_fx
 * @property CarbonImmutable|null $created_at
 * @property-read GoodsReceipt|null $goodsReceipt
 * @property-read StockItem|null $stockItem
 */
class GoodsReceiptLine extends BaseModel
{
    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:4',
            'unit_price_amount' => 'decimal:6',
            'line_total_amount' => 'decimal:6',
            'costed_at' => 'immutable_datetime',
            'valuation_pending_fx' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<GoodsReceipt, $this>
     */
    public function goodsReceipt(): BelongsTo
    {
        return $this->belongsTo(GoodsReceipt::class);
    }

    /**
     * @return BelongsTo<StockItem, $this>
     */
    public function stockItem(): BelongsTo
    {
        return $this->belongsTo(StockItem::class);
    }
}
