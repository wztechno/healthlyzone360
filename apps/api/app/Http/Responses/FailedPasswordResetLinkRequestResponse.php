<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse as FailedPasswordResetLinkRequestResponseContract;

/**
 * A reset link that could not be sent.
 *
 * "No such account" is answered exactly like a success: telling an anonymous
 * caller which email addresses exist is account enumeration. Only throttling
 * is reported honestly, because the caller must know to wait.
 */
class FailedPasswordResetLinkRequestResponse implements FailedPasswordResetLinkRequestResponseContract
{
    public function __construct(private readonly string $status) {}

    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        if ($this->status === Password::RESET_THROTTLED) {
            return ApiResponse::error(ApiError::make(ErrorCode::RateLimitExceeded));
        }

        return ApiResponse::data(['sent' => true], status: 202);
    }
}
