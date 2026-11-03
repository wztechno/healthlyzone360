<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse as FailedPasswordResetLinkRequestResponseContract;

/**
 * A reset link that could not be sent.
 *
 * Every failure is answered exactly like a success: telling an anonymous
 * caller which email addresses exist is account enumeration. That includes
 * the broker's RESET_THROTTLED, which only an address with an account can
 * reach — a 429 there would confirm the account. The route's
 * `forgot-password` limiter still answers 429, for known and unknown
 * addresses alike, so a caller is still told to wait.
 */
class FailedPasswordResetLinkRequestResponse implements FailedPasswordResetLinkRequestResponseContract
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        return ApiResponse::data(['sent' => true], status: 202);
    }
}
