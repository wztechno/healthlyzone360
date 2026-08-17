<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Concerns;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;

/**
 * An `Idempotency-Key` the endpoint will not proceed without.
 *
 * The `idempotency` middleware enforces *semantics* when a key is present and
 * lets a keyless request straight through, which is the right default for the
 * many endpoints where a key is a client's own precaution. On the desk's two
 * creating endpoints it is the wrong one, and for the same reason on both:
 * **there is no other guard.** A customer's double-tapped checkout finds its
 * cart already converted and refuses, because `carts` carries a partial unique
 * index. A desk sale has no cart, and a desk-provisioned customer has no unique
 * index either — `customer_accounts_b2c_user_unique` is partial on `user_id`,
 * and a staff-provisioned row has none, so two identical taps are two perfectly
 * legal customers with no row anywhere saying which one was the mistake.
 *
 * So an absent or blank header is `400 request.invalid` with `details.header`,
 * before anything runs — the refusal `PlatformB2bApplicationProvisionController`
 * established. Both halves still do their job: the middleware answers a replay
 * with the stored envelope, which a service cannot do because by then the
 * response is gone.
 *
 * A trait rather than a base controller, on `ResolvesDeskParty`'s argument: it
 * is behaviour about the *request*, shared by endpoints that otherwise have
 * nothing in common, and `ReadsPrecondition` is the module's existing precedent
 * for exactly that.
 */
trait RequiresIdempotencyKey
{
    /**
     * @param  string  $because  What a retry would create twice, in the refusal
     *                           message. The header is the same on every
     *                           endpoint; the consequence of omitting it is not,
     *                           and a caller reading "send a key" learns less
     *                           than one reading what happens if they do not.
     *
     * @throws ApiException
     */
    protected function requiredIdempotencyKey(Request $request, string $because): string
    {
        $key = $request->header('Idempotency-Key');

        if (! is_string($key) || trim($key) === '') {
            throw new ApiException(ErrorCode::RequestInvalid, $because, ['header' => 'Idempotency-Key']);
        }

        return trim($key);
    }
}
