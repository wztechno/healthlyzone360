<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Nutrition;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

final class ProviderUnavailable extends ApiException
{
    public function __construct(bool $configuration = false)
    {
        parent::__construct(
            $configuration ? ErrorCode::NutritionProviderConfiguration : ErrorCode::NutritionProviderUnavailable,
            details: ['retryable' => ! $configuration],
        );
    }
}
