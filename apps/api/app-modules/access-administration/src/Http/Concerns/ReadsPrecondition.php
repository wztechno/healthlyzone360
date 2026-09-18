<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Http\Concerns;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Http\Middleware\RequirePrecondition;
use Illuminate\Http\Request;

/**
 * The `If-Match` half of the optimistic-concurrency contract.
 *
 * By the time a controller runs, the `precondition` middleware has guaranteed
 * the header is *present* (428 otherwise). What it cannot guarantee is that
 * the value is a Healthy360 validator: a client may send `If-Match: "abc"`,
 * and that is a malformed request rather than a lost race, so it is **400**
 * rather than 409. Whether the validator is *current* is decided at the
 * service layer, inside the same statement as the write — a conditional
 * `UPDATE ... WHERE lock_version = ?` that raises `StaleLockVersion` when it
 * affects no rows.
 *
 * A role is the record where last-write-wins is least defensible on this
 * platform, which is why `roles` gained a `lock_version` at all. Two
 * administrators on one console is the ordinary case: one removing
 * `order.manage_organisation` while the other adds a cost code is a coin flip,
 * and the write that loses is an authorisation somebody believes they revoked.
 *
 * A near-twin of the b2b, catalogues, recipes and platform-administration
 * traits, and deliberately copied rather than imported, for the reason each of
 * those states. The `StaleLockVersion` exception, a *type* several modules must
 * agree on, is the thing that did earn a home in `Support`.
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
