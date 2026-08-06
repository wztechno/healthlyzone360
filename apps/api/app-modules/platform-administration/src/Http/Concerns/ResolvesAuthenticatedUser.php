<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Concerns;

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
 * This module needs the actor more than most surfaces do, and for a sharper
 * reason than B2B's. Every service here takes an **explicit** actor, because
 * the organisation in context is the *platform operator* and the organisation
 * being written to is somebody else's. Inferring an actor from the tenant
 * context would infer the wrong one, and an audit entry naming the platform
 * organisation instead of the person who clicked suspend is an audit entry
 * that answers no question anybody asks.
 *
 * A copy of the identity module's trait, not an import — the same rule the
 * B2B and catalogues modules state about their own copies. Reaching across a
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
