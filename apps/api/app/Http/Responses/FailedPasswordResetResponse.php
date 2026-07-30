<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Laravel\Fortify\Contracts\FailedPasswordResetResponse as FailedPasswordResetResponseContract;

/**
 * The reset could not be completed: an expired or forged token, or an email
 * that does not match it. Both are reported against the token, so a caller
 * cannot use this endpoint to probe which accounts exist.
 */
class FailedPasswordResetResponse implements FailedPasswordResetResponseContract
{
    public function __construct(private readonly string $status) {}

    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        $key = $this->status === Password::INVALID_USER ? 'passwords.token' : $this->status;
        $message = trans($key);

        return ApiResponse::error(ApiError::make(
            ErrorCode::ValidationFailed,
            details: ['fields' => ['token' => [is_string($message) ? $message : $key]]],
        ));
    }
}
