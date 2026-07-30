<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\LoginResponse as LoginResponseContract;

/**
 * A completed first-party session login. The two-factor flag is always
 * present so a client can branch on one field: the challenge branch returns
 * the same shape with `two_factor_required: true` and no session.
 */
class LoginResponse implements LoginResponseContract
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        return ApiResponse::data(['two_factor_required' => false]);
    }
}
