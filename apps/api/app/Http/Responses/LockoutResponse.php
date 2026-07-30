<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\LockoutResponse as LockoutResponseContract;
use Laravel\Fortify\LoginRateLimiter;

/**
 * Too many failed sign-in attempts for this email and IP address.
 *
 * Fortify's own lockout response raises a validation error carrying a 429
 * status, which would reach clients as validation.failed. Throttling is its
 * own concern with its own code (docs/api/conventions.md), and the caller
 * needs Retry-After to know when to try again.
 */
class LockoutResponse implements LockoutResponseContract
{
    public function __construct(private readonly LoginRateLimiter $limiter) {}

    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        $seconds = $this->limiter->availableIn($request);

        return ApiResponse::error(ApiError::make(
            ErrorCode::RateLimitExceeded,
            details: ['retry_after_seconds' => $seconds],
        ))->withHeaders(['Retry-After' => (string) $seconds]);
    }
}
