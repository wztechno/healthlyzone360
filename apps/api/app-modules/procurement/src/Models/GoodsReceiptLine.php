<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Healthy360\Support\Models\BaseModel;

class GoodsReceiptLine extends BaseModel
{
    protected function casts(): array
    {
        return ['quantity' => 'decimal:4'];
    }
}
