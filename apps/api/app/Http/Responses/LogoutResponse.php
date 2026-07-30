<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\LogoutResponse as LogoutResponseContract;

/**
 * The session was destroyed. Deliberately not 204: a client that logs out
 * still receives the correlation identifier in a body it can log, and
 * logging out twice is not an error.
 */
class LogoutResponse implements LogoutResponseContract
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        return ApiResponse::data(['logged_out' => true]);
    }
}
