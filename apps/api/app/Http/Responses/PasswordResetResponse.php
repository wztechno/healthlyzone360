<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\PasswordResetResponse as PasswordResetResponseContract;

/**
 * The password was replaced. No session is established: the client signs in
 * again with the new password, which also proves it was received.
 *
 * Fortify resolves this response with the broker status; it adds nothing to a
 * success envelope, so the constructor parameter is deliberately not
 * declared. Extra container overrides are ignored.
 */
class PasswordResetResponse implements PasswordResetResponseContract
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        return ApiResponse::data(['password_reset' => true]);
    }
}
