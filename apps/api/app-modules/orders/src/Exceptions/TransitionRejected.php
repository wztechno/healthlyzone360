<?php

declare(strict_types=1);

namespace Healthy360\Orders\Exceptions;

use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * An order was asked to move somewhere it cannot go.
 *
 * Names both ends, because the caller usually knows only one of them: a client
 * that sends "confirm" is working from a screen that may be seconds stale, and
 * "this order is already fulfilled" is the answer, not "confirm is invalid".
 *
 * A 409 rather than a 422 for the same reason `PlacementRefused` is one: the
 * request was well formed and reasonable, and the state underneath it moved.
 */
final class TransitionRejected extends ApiException
{
    public function __construct(OrderStatus $from, OrderStatus $to)
    {
        parent::__construct(
            ErrorCode::ResourceConflict,
            sprintf('An order that is %s cannot be moved to %s.', $from->value, $to->value),
            [
                'transition' => [
                    'from' => $from->value,
                    'to' => $to->value,
                    'allowed' => array_map(static fn (OrderStatus $status): string => $status->value, $from->allowedTransitions()),
                ],
            ],
        );
    }
}
