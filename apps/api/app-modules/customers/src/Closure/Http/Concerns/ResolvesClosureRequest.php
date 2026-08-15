<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Http\Concerns;

use App\Models\User;
use Healthy360\Customers\Closure\Models\AccountClosureRequest;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * How the `/me/closure-requests` endpoints find the request they are about.
 *
 * **Scoped to the authenticated identity, and the scope is the lookup.**
 * Somebody else's closure request is `resource.not_found`, never a 403: the row
 * says that a named person is leaving and why, which is about as sensitive as a
 * row on this platform gets, and a denial would confirm that a guessed
 * identifier names a real one.
 *
 * Keyed on `user_id` rather than on a customer account. A closure is about an
 * *identity* — a kitchen's staff login with memberships and no orders can close
 * too, and `account_closure_requests.customer_account_id` is nullable for
 * exactly that reason.
 */
trait ResolvesClosureRequest
{
    /**
     * Narrows the guard's Authenticatable to the concrete Healthy360 identity.
     *
     * @throws ApiException
     */
    protected function closingUser(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        return $user;
    }

    /**
     * One of this identity's own closure requests.
     *
     * @throws ApiException
     */
    protected function ownClosureRequest(User $user, string $requestId): AccountClosureRequest
    {
        $record = AccountClosureRequest::query()
            ->where('user_id', $user->getKey())
            ->whereKey($requestId)
            ->first();

        if (! $record instanceof AccountClosureRequest) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $record;
    }
}
