<?php

declare(strict_types=1);

namespace Healthy360\Support\Api\Contracts;

use Healthy360\Support\Api\ApiError;

/**
 * A throwable that knows its own wire shape.
 *
 * The integration wave's answer to a real tension. Domain exceptions —
 * `OtpIssueRefused`, `AreaNotServed`, `GuestSessionRejected` — were built
 * ahead of their HTTP surface and carry stable *reason strings* rather than
 * wire codes, so that the domain never had to guess at a vocabulary it did not
 * own. Something must now map those reasons onto `ErrorCode`, and there were
 * only two honest places to put it.
 *
 * Putting it in `ApiExceptionRenderer` would make Support import Verification,
 * Customers and B2B — inverting the dependency that every other module
 * respects, and making the one class every failure passes through depend on
 * every domain that can fail.
 *
 * So the mapping lives with the exception, behind this interface, and the
 * renderer asks rather than knows. A module that adds a refusal declares what
 * it means on the wire in the same file, and Support keeps pointing only
 * downwards.
 *
 * Implementing this is *not* a licence to build an error body: the return
 * value is an `ApiError`, so the code still comes from the shared enum, the
 * status still comes from the code, and the correlation identifier is still
 * added by `ApiResponse` where it cannot be forgotten.
 */
interface ProvidesApiError
{
    public function toApiError(): ApiError;
}
