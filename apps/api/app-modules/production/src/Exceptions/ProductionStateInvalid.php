<?php

declare(strict_types=1);

namespace Healthy360\Production\Exceptions;

use Healthy360\Production\Enums\ProductionOrderStatus;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A batch was asked to do something its current state does not permit (PROD1).
 *
 * The details carry where the batch actually is and what was attempted, because
 * the common cause of this is not a bug: it is two people looking at the same
 * desk, and the one who pressed second needs their screen re-rendered rather
 * than an apology.
 */
final class ProductionStateInvalid extends ApiException
{
    public function __construct(ProductionOrderStatus $status, string $attempted)
    {
        parent::__construct(
            ErrorCode::ProductionStateInvalid,
            'This production order is '.$status->value.', so it cannot be '.$attempted.'.',
            [
                'status' => $status->value,
                'attempted' => $attempted,
                'allowed' => array_map(
                    static fn (ProductionOrderStatus $next): string => $next->value,
                    $status->allowedTransitions(),
                ),
            ],
        );
    }
}
