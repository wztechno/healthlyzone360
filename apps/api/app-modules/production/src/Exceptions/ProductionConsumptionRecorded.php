<?php

declare(strict_types=1);

namespace Healthy360\Production\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A cancellation was asked for on a batch that has already taken stock off a
 * shelf (PROD1). The route is `abandon`, and this says so.
 *
 * `cancelled` never carries stock movements and `abandoned` always may. That is
 * what lets anybody reading a production order trust its status without opening
 * the movement ledger to check, and it is only true if this refusal exists.
 */
final class ProductionConsumptionRecorded extends ApiException
{
    public function __construct(string $productionOrderId, int $movementCount)
    {
        parent::__construct(
            ErrorCode::ProductionConsumptionRecorded,
            'This batch has already recorded '.$movementCount.' stock movements, so it cannot be cancelled. Abandon it instead, which records what was used and what was lost.',
            [
                'production_order_id' => $productionOrderId,
                'movement_count' => $movementCount,
                'use_instead' => 'abandon',
            ],
        );
    }
}
