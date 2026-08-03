<?php

declare(strict_types=1);

namespace Healthy360\Orders\Http\Concerns;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Http\Middleware\RequirePrecondition;
use Illuminate\Http\Request;

/**
 * The `If-Match` half of the optimistic-concurrency contract, as the order
 * lifecycle controllers see it.
 *
 * By the time a controller runs, the `precondition` middleware has guaranteed
 * the header is *present* (428 otherwise). What it cannot guarantee is that
 * the value is a Healthy360 validator: a client may send `If-Match: "abc"`,
 * and that is a malformed request rather than a lost race, so it is **400**
 * rather than 409. Whether the validator is *current* is decided at the
 * service layer, inside the same statement as the write — `OrderLifecycle`
 * folds it into the conditional `UPDATE`, so there is no window between the
 * check and the write.
 *
 * A near-twin of the catalogues and recipes traits, and deliberately copied
 * rather than imported: a trait is a copied implementation either way, and
 * reaching across a module boundary for eight lines would buy a dependency
 * edge rather than remove duplication. The `StaleLockVersion` exception — a
 * *type* several modules must agree on — did earn a home in `Support`; this
 * does not.
 *
 * The header matters more here than anywhere else it is used. A kitchen screen
 * showing an order list is stale the moment it renders, and two staff members
 * confirming the same order at once is an ordinary Tuesday.
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
