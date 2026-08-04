<?php

declare(strict_types=1);

namespace Healthy360\POS\Models;

use Healthy360\Support\Models\BaseModel;

class PosShift extends BaseModel
{
    protected function casts(): array
    {
        return [
            'opened_at' => 'immutable_datetime',
            'closed_at' => 'immutable_datetime',
        ];
    }
}
