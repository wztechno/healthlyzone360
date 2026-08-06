<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockLevel extends BaseModel
{
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
