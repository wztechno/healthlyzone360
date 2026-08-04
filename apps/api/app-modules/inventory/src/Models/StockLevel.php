<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Models;

use Healthy360\Support\Models\BaseModel;

class StockLevel extends BaseModel
{
    protected function casts(): array
    {
        return ['quantity' => 'decimal:4'];
    }
}
