<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Nutrition;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

final class ReferenceUnsuitable extends ApiException
{
    /** @param list<string> $reasons */
    public function __construct(array $reasons)
    {
        parent::__construct(ErrorCode::ValidationFailed, details: ['fields' => ['nutrition_reference' => $reasons]]);
    }
}
