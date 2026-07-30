<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse as SuccessfulPasswordResetLinkRequestResponseContract;

/**
 * A password-reset link was queued. 202: the mail has been accepted for
 * delivery, not delivered.
 *
 * Fortify resolves this response with the broker status. It is deliberately
 * not declared as a constructor parameter: the status distinguishes "sent"
 * from "no such user", and must never reach the client.
 */
class SuccessfulPasswordResetLinkRequestResponse implements SuccessfulPasswordResetLinkRequestResponseContract
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        return ApiResponse::data(['sent' => true], status: 202);
    }
}
