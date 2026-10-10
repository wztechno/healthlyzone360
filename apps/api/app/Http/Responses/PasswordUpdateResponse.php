<?php

declare(strict_types=1);

namespace App\Http\Responses;

use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\PasswordUpdateResponse as PasswordUpdateResponseContract;

/**
 * The password was replaced by somebody who knew the old one.
 *
 * The session survives — unlike a reset, where the person proved themselves
 * through a mailed link and has to sign in with what they just chose. Here they
 * were already signed in and stay so, which is what lets a forced first change
 * flow straight into the workspace instead of bouncing back to a login form.
 *
 * `must_change_password` comes back because it is the flag the client was
 * holding them on, and reporting it rather than assuming it saves the screen a
 * refetch of `/me` before it can let go.
 */
class PasswordUpdateResponse implements PasswordUpdateResponseContract
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        return ApiResponse::data([
            'password_updated' => true,
            'must_change_password' => false,
        ]);
    }
}
