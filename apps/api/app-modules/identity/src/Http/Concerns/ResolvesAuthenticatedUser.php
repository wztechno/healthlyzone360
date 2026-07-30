<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Concerns;

use App\Models\User;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * Narrows the guard's Authenticatable to the concrete Healthy360 identity.
 *
 * Every route using this is already behind auth:sanctum, so the failure
 * branch is unreachable in practice — it exists so a routing mistake fails
 * closed with auth.unauthenticated instead of a type error.
 */
trait ResolvesAuthenticatedUser
{
    protected function currentUser(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $user;
    }
}
