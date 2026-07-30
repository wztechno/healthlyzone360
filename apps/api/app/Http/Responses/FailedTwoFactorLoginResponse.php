<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\FailedTwoFactorLoginResponse as FailedTwoFactorLoginResponseContract;

/**
 * A rejected two-factor challenge, or a challenge with no pending login in
 * the session. Reported as auth.two_factor_invalid rather than a field-level
 * validation error so the client can distinguish "wrong code" from "malformed
 * request" without inspecting details.
 */
class FailedTwoFactorLoginResponse implements FailedTwoFactorLoginResponseContract
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        return ApiResponse::error(ApiError::make(
            ErrorCode::AuthTwoFactorInvalid,
            details: ['field' => $request->filled('recovery_code') ? 'recovery_code' : 'code'],
        ));
    }
}
