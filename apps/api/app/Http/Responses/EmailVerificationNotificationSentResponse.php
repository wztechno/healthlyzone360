<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\EmailVerificationNotificationSentResponse as EmailVerificationNotificationSentResponseContract;

/**
 * A fresh verification mail was queued. 202: accepted for delivery, not
 * delivered. An already-verified caller receives 204 from Fortify's
 * controller instead — a documented envelope exception.
 */
class EmailVerificationNotificationSentResponse implements EmailVerificationNotificationSentResponseContract
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        return ApiResponse::data(['sent' => true], status: 202);
    }
}
