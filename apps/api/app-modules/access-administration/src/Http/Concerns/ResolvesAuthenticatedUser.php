<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Concerns;

use App\Models\User;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * Narrows the guard's `Authenticatable` to the concrete Healthy360 identity.
 *
 * Every route using this is already behind `auth:sanctum`, so the failure
 * branch is unreachable in practice — it exists so a routing mistake fails
 * closed with `auth.unauthenticated` instead of a type error.
 *
 * This module needs the actor for a reason no other tenant surface has: it is
 * the only one where the caller is inside the thing being changed. Removing a
 * permission from a role can remove it from the person doing the removing, and
 * ending a membership can end the caller's own. Both refusals are computed
 * against *this* user, so an actor inferred from anything other than the guard
 * would be the wrong one at exactly the moment it mattered.
 *
 * A copy of the platform-administration and identity traits rather than an
 * import — the rule each of them states about its own copy. Reaching across a
 * module boundary for eight lines buys a dependency edge rather than removing
 * duplication.
 */
trait ResolvesAuthenticatedUser
{
    /**
     * @throws ApiException
     */
    protected function currentUser(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $user;
    }
}
