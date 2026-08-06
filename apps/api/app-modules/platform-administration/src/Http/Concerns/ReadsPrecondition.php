<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Concerns;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Http\Middleware\RequirePrecondition;
use Illuminate\Http\Request;

/**
 * The `If-Match` half of the optimistic-concurrency contract, as the B2B
 * controllers see it.
 *
 * By the time a controller runs, the `precondition` middleware has guaranteed
 * the header is *present* (428 otherwise). What it cannot guarantee is that
 * the value is a Healthy360 validator: a client may send `If-Match: "abc"`,
 * and that is a malformed request rather than a lost race, so it is **400**
 * rather than 409. Whether the validator is *current* is decided at the
 * service layer, inside the same statement as the write —
 * `KitchenLifecycle::compareAndSwap()` runs a conditional `UPDATE ... WHERE
 * lock_version = ?` and raises `StaleLockVersion` when it affects no rows.
 *
 * Suspension in particular has to be lock-versioned. Two operators reading the
 * same kitchen and one of them reactivating while the other suspends is not a
 * hypothetical on a console two people share, and last-write-wins would decide
 * it silently.
 *
 * A near-twin of the b2b, catalogues and recipes traits, and deliberately
 * copied rather than imported, for the reason each of those states. The
 * `StaleLockVersion` exception, a *type* several modules must agree on, is the
 * thing that did earn a home in `Support`.
 */
trait ReadsPrecondition
{
    /**
     * @throws ApiException
     */
    protected function requiredLockVersion(Request $request): int
    {
        $expected = RequirePrecondition::lockVersion($request);

        if ($expected === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The If-Match header must carry the ETag this resource was last served with.',
                ['required_headers' => ['If-Match']],
            );
        }

        return $expected;
    }
}
