<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Concerns;

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
 * This module needs the actor more than most surfaces do. Every
 * `ApplicationService`, `KycDocumentService` and `AgreementService` method
 * takes an **explicit** actor rather than reading one from an ambient context,
 * because a B2B application is not tenant-scoped: it exists so that a tenant
 * may, so there is no organisation in context to infer anybody from.
 *
 * A copy of the identity module's trait, not an import. Reaching across a
 * module boundary for eight lines buys a dependency edge rather than removing
 * duplication — the rule the catalogues module states about its own copied
 * `ReadsPrecondition`, applied to the same shape of problem.
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
