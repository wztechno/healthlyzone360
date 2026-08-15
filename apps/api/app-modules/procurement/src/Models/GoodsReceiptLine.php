<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $goods_receipt_id
 * @property string $stock_item_id
 * @property numeric-string $quantity
 * @property string|null $unit_id the unit the price is quoted per
 * @property numeric-string|null $unit_price_amount major currency units per unit_id (INV1.1)
 * @property numeric-string|null $line_total_amount major currency units (INV1.1)
 * @property string|null $cost_currency_code
 */
class GoodsReceiptLine extends BaseModel
{
    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:4',
            'unit_price_amount' => 'decimal:6',
            'line_total_amount' => 'decimal:6',
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
