<?php

declare(strict_types=1);

namespace Healthy360\POS\Models;

use Healthy360\Support\Models\BaseModel;

class PosTransactionLine extends BaseModel
{
    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:4',
            'line_total_minor' => 'integer',
        ];
    }
}
